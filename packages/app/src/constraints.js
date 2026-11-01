/**
 * 工具约束：情绪 → 工具策略。
 *  - guard：同步、单调拒绝（破坏性工具 + 低拒绝门槛）
 *  - tools/pre-execute：返回 { kind: 'ask', reason }（危险工具 + 高验证门槛）
 *
 * rc.5 契约（0.2.1-rc.5 起）：
 *   `guard` 的返回值里**只有 `undefined` 表示放行**——返回 null 会被当成
 *   "拒绝，理由 null"，整条工具调用变成 `Error: null`（真机上踩过：
 *   插件一启用所有工具全灭）。所以放行一律 return undefined。
 *
 * 审批策略是 never 时不能 ask（0.2.1-rc.5 实测）：宿主会把这次 ask 直接判成
 * rejected，工具结果写成 `Error: the user rejected tool "pwsh"`——鱼会以为是他拒的，
 * 甚至为此跟他争。没人能回答的确认，不如不问。
 *
 * 决策函数是纯函数，可独立测试；宿主回调一律 try/catch 并回退放行。
 */
import fs from 'node:fs'
import path from 'node:path'
import { homeDir } from '../../being/src/index.ts'

/** @param {import('../../affect/src/index.ts').Bias} bias */
export function verifyDecision(bias, toolName, cfg) {
  if (!toolName || !cfg.verifyTools.includes(toolName)) return null
  if (bias.thresholdVerify >= cfg.verifyThreshold) {
    return {
      kind: 'ask',
      reason: `fishbowl: 验证门槛 ${bias.thresholdVerify.toFixed(2)} ≥ ${cfg.verifyThreshold}，先确认再执行 ${toolName}`,
    }
  }
  return null
}

/** @param {import('../../affect/src/index.ts').Bias} bias */
export function refuseReason(bias, toolName, cfg) {
  if (!toolName || !cfg.refuseTools.includes(toolName)) return null
  if (bias.thresholdRefuse <= cfg.refuseThreshold) {
    return `fishbowl: 拒绝门槛 ${bias.thresholdRefuse.toFixed(2)} ≤ ${cfg.refuseThreshold}，当前状态拒绝执行 ${toolName}`
  }
  return null
}

/**
 * rc.5 契约：guard 只有返回 undefined 才是放行。
 * 纯函数给的 null（"没有意见"）必须归一成 undefined，否则会被当成拒绝理由。
 */
export function guardVerdict(reason) {
  return reason === null || reason === undefined ? undefined : reason
}

/**
 * 这次 ask 到底问不问得出来。
 * 审批策略是 never 时，宿主不弹窗、直接判 rejected——问了只会让工具被挡，
 * 而且结果写成「用户拒绝」，等于把一次策略拦截伪装成一次人际拒绝。
 */
export function askableDecision(decision, approvalPolicy) {
  if (!decision) return null
  if (approvalPolicy === 'never') return null
  return decision
}

/**
 * 每轮工具预算：一个回合被工具拉成十几步，对话就散了。
 * 超了直接拒——理由要写清楚：是她这一轮动手次数用完了，不是他拒绝。
 */
export function budgetVerdict(count, limit) {
  if (!limit || limit <= 0) return null
  if (count <= limit) return null
  return `fishbowl: 这一轮已经调了 ${limit} 次工具，先把手上的结果说完；还要查就下一轮。`
}

/** @param {import('./types.js').FishbowlConfig} cfg */
export function createConstraints(ctx, binding, cfg, host) {
  host = host ?? createDshHost(ctx, cfg)
  const disposers = []
  const perTurn = new Map() // sessionId -> 本轮已经调了几次

  // 新的一轮开始，预算归零
  const offTurn = typeof host.onSessionEvent === 'function'
    ? host.onSessionEvent((session, event) => {
      try {
        if (session && event && event.type === 'turn/start') perTurn.delete(session.id)
      } catch { /* 计数失败不该影响对话 */ }
    })
    : undefined
  if (offTurn) disposers.push(offTurn)

  const guardOff = host.guard?.((exec) => {
      try {
        // rc.5：只有 undefined 是放行；null/false 都会被当成拒绝理由
        if (cfg.control) return undefined
        const sid = sessionIdOf(exec)
        if (!sid || !binding.manages(sid)) return undefined
        const name = toolNameOf(exec)
        const ws = workspaceOfExec(exec)
        // 硬地板（很窄）：系统级破坏性命令一律不代她执行。不是安全边界，是保险丝。
        // 她的家：只有 home/ 可以改，别的地方可以看
        let home = ''
        try {
          const occ = typeof binding.occupantOf === 'function' ? binding.occupantOf({ sessionId: sid, workspace: ws }) : null
          if (occ?.store?.dir) home = homeDir(occ).replace(/[\\/]+$/, '').toLowerCase()
        } catch { home = '' }
        if (home) {
          let args = {}
          try {
            const raw = exec?.data?.arguments ?? exec?.data?.args ?? '{}'
            args = typeof raw === 'string' ? JSON.parse(raw) : (raw || {})
          } catch { args = {} }
          const inside = (p) => {
            const v = String(p ?? '').replace(/[\\/]+$/, '').toLowerCase()
            return !!v && (v === home || v.startsWith(home + '\\') || v.startsWith(home + '/'))
          }
          if (['write', 'edit', 'apply_patch', 'multi_edit', 'notebook_edit'].includes(name)) {
            const target = args.file_path ?? args.path
            if (target && !inside(target)) return 'fishbowl: 只能改你自己的文件夹（' + home + '）；别的地方可以看，但不要改。'
          }
          if (name === 'pwsh' || name === 'bash') {
            const cmd = String(args.command ?? '')
            const writey = /(set-content|add-content|out-file|new-item|remove-item|copy-item|move-item|rename-item|mkdir|del\s|rm\s|>\s)/i.test(cmd)
            if (writey) {
              // 相对路径写不出来（cwd 在房间里）：要么写 home 的绝对路径，要么别写
              if (!cmd.toLowerCase().includes(home)) return 'fishbowl: 写文件请用你自己文件夹里的绝对路径（' + home + '）；别的地方可以看，但不要改。'
              const paths = cmd.match(/[a-z]:[\\/][^\s'\"|;]+/gi) || []
              if (paths.some((p) => !inside(p))) return 'fishbowl: 只能改你自己的文件夹（' + home + '）；别的地方可以看，但不要改。'
            }
          }
        }
        if (name === 'pwsh' || name === 'bash') {
          let cmd = ''
          try {
            const raw = exec?.data?.arguments ?? exec?.data?.args ?? ""
            const o = typeof raw === 'string' ? JSON.parse(raw) : raw
            cmd = String(o?.command ?? raw ?? '')
          } catch { cmd = String(exec?.data?.arguments ?? '') }
          const FLOOR = /(?:^|[^\w-])(format|diskpart|shutdown|restart-computer|stop-computer|vssadmin)(?:\s|$)/i
          const ROOT_DEL = /remove-item\s+['"]?[a-z]:[\\/]['"]?[^\n]*-recurse|remove-item\s+['"]?(?:[a-z]:)?[\\/](windows|users|program files)[\\/]/i
          if (FLOOR.test(cmd) || ROOT_DEL.test(cmd)) {
            return 'fishbowl: 这条命令会动到房间之外的东西（系统或别的目录），我不替你执行。'
          }
        }

        // 只有住着鱼的会话才谈得上「她的预算」——别人的会话一概别管。
        // 预算默认关（0）：调用次数本身不是问题，嫌吵该改的是显示。
        if (cfg.maxToolCallsPerTurn > 0) {
          let occupant = null
          try {
            occupant = typeof binding.occupantOf === 'function' ? binding.occupantOf({ sessionId: sid, workspace: ws }) : null
          } catch { occupant = null }
          if (occupant) {
            const n = (perTurn.get(sid) ?? 0) + 1
            perTurn.set(sid, n)
            const budget = budgetVerdict(n, cfg.maxToolCallsPerTurn)
            if (budget) return budget
          }
        }

        if (cfg.refuseTools.length === 0) return undefined
        const reason = refuseReason(binding.biasFor(sid, 5000, ws), name, cfg)
        return guardVerdict(reason)
      } catch {
        return undefined
      }
    })
  if (guardOff) disposers.push(guardOff)

  const off = host.preExecute((exec, next) => {
    try {
      if (typeof next !== 'function') return undefined
      if (cfg.control) return next()
      const sid = sessionIdOf(exec)
      if (!sid || !binding.manages(sid)) return next()
      const name = toolNameOf(exec)
      if (!name) return next()
      const dec = verifyDecision(binding.biasFor(sid, 5000, workspaceOfExec(exec)), name, cfg)
      if (!dec) return next()
      const policy = typeof host.approvalPolicy === 'function' ? host.approvalPolicy(exec?.agent?.session) : null
      const ask = askableDecision(dec, policy)
      if (!ask) {
        // 没人能回答这次确认：不问了，让工具照常走（策略 never 本身就是"别问我"）
        if (policy === 'never') noteUnanswerableAsk(sid, name)
        return next()
      }
      return ask
    } catch {
      return typeof next === 'function' ? next() : undefined
    }
  })
  if (off) disposers.push(off)

  let warned = false
  /** 只记一次：策略关掉审批时，「先确认再动」这个倾向暂时失效。 */
  function noteUnanswerableAsk(sessionId, toolName) {
    if (warned) return
    warned = true
    try {
      fs.appendFileSync(path.join(cfg.stateDir, 'trace.ndjson'), JSON.stringify({
        ts: Date.now(), sessionId, warn: `ask skipped: approval policy is "never"（${toolName} 直接执行）`,
      }) + '\n')
    } catch { /* 记不下来也只能算 */ }
  }

  return () => {
    for (const d of disposers) { try { d() } catch { /* 尽力清理 */ } }
  }
}

function sessionIdOf(exec) {
  const a = exec?.agent
  return a?.session?.id || a?.id || exec?.sessionId || null
}

/** 会话所在工作区（住工作区的鱼也能被找到）。 */
function workspaceOfExec(exec) {
  const s = exec?.agent?.session ?? exec?.session
  const cwd = s?.header?.cwd ?? s?.cwd
  return typeof cwd === 'string' && cwd.length > 0 ? cwd : undefined
}

function toolNameOf(exec) {
  return exec?.toolName || exec?.name || exec?.tool?.name || exec?.data?.toolName || exec?.data?.name || ''
}
