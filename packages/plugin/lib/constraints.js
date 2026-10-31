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
 * 决策函数是纯函数，可独立测试；宿主回调一律 try/catch 并回退放行。
 */

/** @param {import('../../src/core/types.ts').Bias} bias */
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

/** @param {import('../../src/core/types.ts').Bias} bias */
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

/** @param {import('./types.js').FishbowlConfig} cfg */
export function createConstraints(ctx, binding, cfg) {
  const disposers = []

  if (typeof ctx.tools?.guard === 'function') {
    const off = ctx.tools.guard((exec) => {
      try {
        // rc.5：只有 undefined 是放行；null/false 都会被当成拒绝理由
        if (cfg.control || cfg.refuseTools.length === 0) return undefined
        const sid = sessionIdOf(exec)
        if (!sid || !binding.manages(sid)) return undefined
        const reason = refuseReason(binding.biasFor(sid, 5000, workspaceOfExec(exec)), toolNameOf(exec), cfg)
        return guardVerdict(reason)
      } catch {
        return undefined
      }
    })
    if (off) disposers.push(off)
  }

  const off = ctx.on('tools/pre-execute', (exec, next) => {
    try {
      if (typeof next !== 'function') return undefined
      if (cfg.control) return next()
      const sid = sessionIdOf(exec)
      if (!sid || !binding.manages(sid)) return next()
      const name = toolNameOf(exec)
      if (!name) return next()
      const dec = verifyDecision(binding.biasFor(sid, 5000, workspaceOfExec(exec)), name, cfg)
      if (!dec) return next()
      return dec
    } catch {
      return typeof next === 'function' ? next() : undefined
    }
  })
  if (off) disposers.push(off)

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
  return exec?.toolName || exec?.name || exec?.tool?.name || ''
}
