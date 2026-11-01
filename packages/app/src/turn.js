/**
 * 收集器：会话事件 → 轮次转录 → 评价 → 情绪/偏置 → 注入。
 * 因果方向：本轮的偏置由上一轮及更早的事件算出（评价在 turn/end 后异步执行）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { ACTIVITY_RE, breachLine, homeDir, mergePendingText, permitLine } from '../../being/src/index.ts'
import { COMMITMENT_RE, REQUEST_RE } from '../../being/src/index.ts'
import { applyAppraisal, salienceOf, toBias } from '../../affect/src/index.ts'
import { createMemoryStore } from './memory-store.js'
import { configFor } from './fishcfg.js'
import { createAppraiser } from './appraiser.js'
import { isFishbowlInjection, messageText, textOf, toolNameOf, wakeOf, workspaceOf } from './extract.js'
import { IDENTITY_RE } from './identity.js'
import { renameScopeAsync, restoreOriginalAsync } from './rename.js'
import { recentDialog } from '../../being/src/index.ts'
import { injectMessage, recallBlock, recentBlock } from './injector.js'
import { callLLM } from './llm.js'
import { voiceRulesFor } from '../../voice/src/index.js'
import { grantLine } from './grant.js'
import { createAfterTurn, forgivenessOf } from './turn/after.js'
export { forgivenessOf } from './turn/after.js'

/**
 * 把这一轮缓存拼成转录。
 *
 * role 只有四种：
 *   user       他说的话
 *   assistant  她说的话（含 her reasoning，宿主把它一起给出来了）
 *   tool       工具结果
 *   situation  她刚醒来时的处境（来自唤醒消息；不是他说的话）
 *
 * `situation` 必须进转录：以前唤醒消息被整条跳过，只剩 assistant，
 * 记忆总结就会替她编一个"对方说……"——这是实际发生过的污染。
 */
export function buildTranscript(items, limit = 2400) {
  const list = Array.isArray(items) ? items : []
  return list
    .slice(-Math.max(1, Math.ceil(Number(limit || 2400) / 60)))
    .map((i) => `${i?.role ?? 'user'}: ${i?.text ?? ''}`)
    .join('\n')
    .slice(-Number(limit || 2400))
}

export function createCollector(ctx, binding, cfg, host, memorySource) {
  const appraise = createAppraiser(cfg)
  const getMemory = memorySource ?? createMemoryStore(cfg)
  const buffers = new Map() // sessionId -> { items: {role,text}[] }
  const lastKey = new Map() // sessionId -> 指纹（肉眼可见的变化才注入）
  const injectedBy = new Map() // sessionId -> 这一轮上下文里注入过的记忆 id
  const tracePath = path.join(binding.dir, 'trace.ndjson')
  const disposers = []

  const after = createAfterTurn({ cfg, binding, trace, callLLM, configFor })

  function trace(line) {
    try { fs.appendFileSync(tracePath, JSON.stringify(line) + '\n') } catch { /* 轨迹失败不阻塞 */ }
  }

  function bufferFor(sessionId) {
    let buf = buffers.get(sessionId)
    if (!buf) {
      buf = { items: [] }
      buffers.set(sessionId, buf)
    }
    return buf
  }

  function pushItem(sessionId, role, text) {
    if (!text || text.trim() === '') return
    bufferFor(sessionId).items.push({ role, text })
  }

  /** 一个体一个记忆实例；设置页改了配置就顺手刷新。 */
  function memoryFor(creature) {
    return getMemory(creature)
  }

  /** 记忆系统的模型调用：吃 cfg.appraiser 那套配置；配额与优先级在 tick 里。 */
  function memLlm() {
    return (req) => callLLM(cfg, req.system, req.user, { maxTokens: req.maxTokens, json: true, model: req.model })
  }

  /** 空壳鱼（默认名 + 没轮次 + 没记忆）就别注入中性数字了，纯噪音。 */
  function isEmptyShell(creature, view) {
    try {
      const defaultName = /^fish-/.test(creature.meta.name)
      return defaultName && (view?.turns?.length ?? 0) === 0 && (view?.memories?.length ?? 0) === 0
    } catch {
      return false
    }
  }

  /**
   * 「你没事可以刷刷 B 站」是许可，不是命令。
  /** 用户这句话让她想起什么 → 注入一小段（同一条 10 分钟内不重复）。 */
  const recalledSeen = new Map() // creatureId -> Map(memoryId -> ts)
  function maybeRecall(session, text) {
    try {
      if (!text || text.trim().length < 2) return
      const creature = binding.resolve({ sessionId: session.id, workspace: workspaceOf(session) })
      if (!creature) return
      const mem = memoryFor(creature)
      const hits = mem.search(text, { limit: 2 })
      if (!hits.length) return
      const now = Date.now()
      const seen = recalledSeen.get(creature.meta.creatureId) ?? new Map()
      const fresh = hits.filter((h) => now - (seen.get(h.id) ?? 0) > 10 * 60_000)
      if (!fresh.length) return
      for (const h of fresh) seen.set(h.id, now)
      recalledSeen.set(creature.meta.creatureId, seen)
      // 记下这一轮注入过什么：下一轮她的总结要判断「真用到了没有」
      const inj = injectedBy.get(session.id) ?? []
      for (const h of fresh) if (!inj.includes(h.id)) inj.push(h.id)
      injectedBy.set(session.id, inj)
      const agent = host.agentFor(session.id)
      if (!agent) return
      const lines = fresh.map((h) => (h.kind === 'memory' ? h.text : '你说过：' + String(h.text || '').replace(/\s+/g, ' ').slice(0, 60)))
      host.inject(agent, injectMessage(recallBlock(lines.map((text) => ({ text }))))).catch(() => {})
    } catch { /* 回忆失败不影响主流程 */ }
  }

  async function finishTurn(session) {
    try {
      const buf = buffers.get(session.id)
      if (!buf || buf.items.length === 0) return
      const transcript = buildTranscript(buf.items, cfg.transcriptLimit)

      const creature = binding.resolve({ sessionId: session.id, workspace: workspaceOf(session) })
      if (!creature) { buffers.delete(session.id); return }
      const a = await appraise(transcript)
      const ts = Date.now()
      const mem = memoryFor(creature)

      // ① 先落盘（零 LLM，必然成功）：这一轮的转录 + 评价 + 当时的情绪峰值
      const ws = workspaceOf(session)
      const occ = creature.meta.occupancy
      const scope = occ
        ? { kind: occ.kind, id: occ.id, workspace: occ.workspace || ws }
        : (ws ? { kind: 'workspace', id: ws } : undefined)
      // 情绪峰值 = 这一轮评价之后的情绪。先算出来，免得事件写下去就改不了
      const peak = { ...JSON.parse(JSON.stringify(creature.affectNow ? creature.affectNow() : creature.fold().affect)) }
      applyAppraisal(peak, a, creature.temperament)

      const injected = injectedBy.get(session.id) ?? []
      injectedBy.delete(session.id)
      mem.observe({ note: transcript, scope, appraisal: a, salience: salienceOf(a), affect: peak, injected, ts })

      const affect = creature.affectNow ? creature.affectNow() : creature.fold().affect
      const bias = toBias(affect, creature.temperament)
      const commitments = creature.openCommitments(configFor(cfg, creature).growth).slice(-2).map((x) => (x.broken ? '⚠ ' : '') + x.text)
      const snap = mem.render({ affect, bias, name: creature.meta.name, commitments, now: ts })
      // 许可是一条稳定事实：他允许她没事时自己刷 B 站。不是命令，也不翻硬开关。
      const grant = grantLine(creature)
      const snapText = grant ? `${snap.text}\n他允许你的事: ${grant}` : snap.text
      const snapFingerprint = grant ? `${snap.fingerprint}|g:${grant}` : snap.fingerprint
      // 这一轮注入过哪些记忆 → 下一轮她的总结用来判定「真用到了没有」
      injectedBy.set(session.id, snap.picked)

      trace({
        ts, sessionId: session.id, creatureId: creature.meta.creatureId,
        appraisal: a,
        affect: { v: affect.valence, a: affect.arousal, guilt: affect.guilt, longing: affect.longing },
        bias,
      })

      if (cfg.appraiser.kind === 'deepseek') {
        // 双总结 + 到点整理：异步、有预算、失败可重试；绝不阻塞对话
        void mem.tick({ llm: memLlm(), by: { model: cfg.appraiser.model }, maxCalls: 12 })
          .then((r) => {
            const bad = [...(r.errors ?? []), ...(r.rejected ?? [])]
            if (bad.length) trace({ ts: Date.now(), sessionId: session.id, warn: `memory tick: ${bad.slice(0, 3).join(' | ')}` })
          })
          .catch((err) => trace({ ts: Date.now(), sessionId: session.id, warn: `memory tick failed: ${String(err?.message || err)}` }))
        if (IDENTITY_RE.test(transcript)) {
          void after.detectIdentity(session.id, creature, transcript)
        }
        // —— M2.4：承诺与违诺 ——
        const herText = buf.items.filter(i => i.role === 'assistant').map(i => i.text).join(' ')
        const lastUserText = buf.items.filter(i => i.role === 'user').slice(-1).map(i => i.text).join(' ')
        if (herText && COMMITMENT_RE.test(herText) && REQUEST_RE.test(lastUserText)) {
          void after.detectCommitment(session.id, creature, herText)
        }
        if (a.normViolation >= 0.2) {
          void after.checkBroken(session.id, creature, transcript)
        }
        // 被原谅：愧疚才有出口（设计上只有 repair 能减）
        if (forgivenessOf(lastUserText) && (creature.affectNow ? creature.affectNow() : creature.fold().affect).guilt > 0.2) {
          creature.recordRepair(0.35)
          trace({ ts: Date.now(), sessionId: session.id, creatureId: creature.meta.creatureId, event: 'repair', amount: 0.35 })
        }
        // —— M3.2：共享活动 ——
        if (ACTIVITY_RE.test(transcript)) {
          void after.detectActivity(session.id, creature, transcript)
        }
        // —— M7：日记 / 小纸条 / 请求 ——
        void after.runDiary(session.id, creature)
        void after.maybeNote(session.id, creature, affect)
      }

      buffers.delete(session.id)
    } catch (err) {
      trace({ ts: Date.now(), sessionId: session.id, warn: `collect failed: ${String(err && err.message || err)}` })
    }
  }

  /**
   * 组装状态块文本：注册成 agent 的动态系统提示段，每次组装提示词时现算。
   * 同一轮内结果缓存：一轮多步时提示词不变，别让 DeepSeek 的缓存白白失效。
   */
  const stateCache = new Map()
  const turnKeys = new Map()
  function buildStateText(session) {
    try {
      if (cfg.control || !cfg.injectBias) return ''
      if (!session?.id) return ''
      const key = turnKeys.get(session.id) ?? 0
      const hit = stateCache.get(session.id)
      if (hit && hit.key === key) return hit.text
      const creature = binding.resolve({ sessionId: session.id, workspace: workspaceOf(session) })
      if (!creature) return ''
      const mem = memoryFor(creature)
      const affect = creature.affectNow ? creature.affectNow() : creature.fold().affect
      const bias = toBias(affect, creature.temperament)
      const commitments = creature.openCommitments(configFor(cfg, creature).growth).slice(-2).map((x) => (x.broken ? '⚠ ' : '') + x.text)
      const snap = mem.render({ affect, bias, name: creature.meta.name, commitments, now: Date.now() })
      injectedBy.set(session.id, snap.picked)
      const grant = grantLine(creature)
      const recent = recentBlock(recentDialog(creature, 6))
      const req = creature.requestDigest()
      const reqLines = []
      if (req.pending.length) reqLines.push(`还在等回音: ${req.pending.join('；')}`)
      if (req.answered.length) reqLines.push(`他答过的: ${req.answered.map((r) => `${r.text}（${r.answer === 'yes' ? '同意' : '不同意'}）`).join('；')}`)
      const reqText = reqLines.length ? '\n' + reqLines.join('\n') : ''
      const perm = permitLine(creature)
      const breach = breachLine(creature)
      const extra = (perm ? `\n你现在被允许: ${perm}` : '') + (breach ? `\n${breach}` : '')
      const out = snap.text + (grant ? `\n他允许你的事: ${grant}` : '') + reqText + extra + (recent ? '\n' + recent : '')
      stateCache.set(session?.id, { key, text: out })
      return out
    } catch (err) {
      trace({ ts: Date.now(), sessionId: session?.id, warn: `state build failed: ${String(err?.message || err)}` })
      return ''
    }
  }

  const offEvent = host.onSessionEvent((session, event) => {
    try {
      if (!session || !event || typeof event.type !== 'string') return
      if (!binding.manages(session.id)) return
      const t = event.type
      if (t === 'user/message') {
        // 唤醒消息不是"状态块"：它带着 wake 出处，要把处境记成 situation。
        // 其余 fishbowl 注入（基线 / 回忆 / 状态摘要）照旧跳过。
        if (isFishbowlInjection(event)) {
          const wake = wakeOf(event)
          if (wake) pushItem(session.id, 'situation', textOf(event))
          return
        }
        const userText = textOf(event)
        pushItem(session.id, 'user', userText)
        after.maybeGrant(session, userText)
        maybeRecall(session, userText)
      } else if (t === 'assistant/message') {
        pushItem(session.id, 'assistant', textOf(event))
      } else if (t === 'tool/result') {
        const name = toolNameOf(event)
        const err = event?.data?.message?.isError || event?.data?.isError || event?.data?.error
        const text = messageText(event?.data?.message ?? event?.data)
        pushItem(session.id, 'tool', [name, err ? '（出错）' : '', text ? text.slice(0, 200) : ''].filter(Boolean).join(' '))
      } else if (t === 'turn/start') {
        turnKeys.set(session.id, Date.now())
        stateCache.delete(session.id)
      } else if (t === 'turn/end') {
        finishTurn(session)
      }
    } catch { /* 宿主事件处理绝不外抛 */ }
  })
  if (offEvent) disposers.push(offEvent)

  // agent 建立时：注入一次基线状态 + 注册该 agent 的声音规则（scoped，不影响其他会话）
  const setupAgent = (agent, sid, ws, creature) => {
    // 声音：只给"有鱼住"的会话注册（scoped，只作用于这个 agent）
    try {
      const seedLine = cfg.seed?.background ? `\n\n你的来历：${cfg.seed.background}` : ''
      const dataLine = `\n\n你的家当都在 ${homeDir(creature)}：日记（diary/）、小纸条（notes/）。这个文件夹是你的，想写什么、存什么都放这里；别的地方可以看，但不要改。你的账本一开始是空的：不要从 .fishbowl\\\\trash、旧系统目录、或别人的房间文件里认领过去或日记。`
      host.voice(agent, voiceRulesFor(configFor(cfg, creature).relation?.kind) + seedLine + dataLine)
      host.stateSection?.(agent, (context) => buildStateText(context?.agent?.session ?? agent?.session ?? { id: sid }))
      // 打开房间时补一轮总结：积压不必等到下次对话或十分钟清扫
      try {
        const fcfg = configFor(cfg, creature)
        if (fcfg.appraiser?.kind === 'deepseek') {
          void memoryFor(creature).tick({ llm: memLlm(), by: { model: fcfg.appraiser.model }, maxCalls: 12 }).catch(() => {})
        }
      } catch { /* 补总结失败不影响对话 */ }
    } catch { /* 声音注册失败不影响功能 */ }

    // 第二天打开会话：先把昨天的日记补上
    void after.runDiary(sid, creature)

    // 入住时如果会话没开着就改不了名，开房时补一次（「<名字>的房间」）
    if (creature.meta.occupancy) renameScopeAsync(host, cfg.stateDir, creature.meta.occupancy, creature.meta.name)

    // M3.1：会话重开 → 先补投攒着的话（幂等，失败下轮再试；>3 条合并成一条不刷屏）
    Promise.resolve()
      .then(async () => {
        const pending = creature.store.readOutbox().filter(o => !o.delivered)
        const merged = mergePendingText(pending)
        if (merged.text !== null) {
          try {
            await host.wake(agent, injectMessage(merged.text, { mode: 'contact', reason: '补投攒着的话' }))
            for (const id of merged.ids) creature.store.markOutboxDelivered(id)
          } catch { /* 下轮再试 */ }
          return
        }
        for (const item of pending) {
          try {
            await host.wake(agent, injectMessage(item.text, item.wake ?? { mode: 'contact', reason: '补投攒着的话' }))
            creature.store.markOutboxDelivered(item.id)
          } catch { /* 单条失败不影响其余 */ }
        }
      })
      .catch(() => { /* 绝不外抛 */ })
  }


  const offCreated = host.onAgentCreated((payload) => {
    try {
      const agent = payload?.agent ?? payload
      const sid = agent?.session?.id ?? agent?.id
      if (!sid || !binding.manages(sid)) return

      const ws = workspaceOf(agent?.session) ?? workspaceOf(payload?.session)
      const creature = binding.resolve({ sessionId: sid, workspace: ws })
      if (creature) { setupAgent(agent, sid, ws, creature); return }

      // 鱼可能比会话晚一步"入住"（新建鱼时就是这样）：稍等再认领
      let tries = 0
      const retry = () => {
        tries++
        const c2 = binding.resolve({ sessionId: sid, workspace: ws })
        if (c2) { setupAgent(agent, sid, ws, c2); return }
        if (tries < 6) { setTimeout(retry, 400); return }
        trace({ ts: Date.now(), sessionId: sid, warn: `no-occupant workspace=${ws ?? 'unknown'}` })
        // 之前住过又搬走了：会话打开时把名字改回原来的
        restoreOriginalAsync(host, cfg.stateDir, { kind: 'session', id: sid })
      }
      setTimeout(retry, 400)
    } catch { /* 同上，绝不外抛 */ }
  })
  if (offCreated) disposers.push(offCreated)

  // 空闲整理：不聊天的时候也把攒着的轮次整理掉（否则新鱼一直"未总结"）
  const flushTimer = setInterval(() => {
    try {
      for (const c of binding.listCreatures()) {
        try {
          const fcfg = configFor(cfg, c)
          if (fcfg.appraiser?.kind !== 'deepseek') continue
          void memoryFor(c).tick({ llm: memLlm(), by: { model: fcfg.appraiser.model }, maxCalls: 12 })
            .then((r) => {
              const bad = [...(r.errors ?? []), ...(r.rejected ?? [])]
              if (bad.length) trace({ ts: Date.now(), sessionId: c.meta.occupancy?.id, creatureId: c.meta.creatureId, warn: `memory sweep: ${bad.slice(0, 3).join(' | ')}` })
            })
            .catch(() => { /* 下轮再试 */ })
        } catch { /* 单条失败不影响其它鱼 */ }
      }
    } catch { /* 绝不外抛 */ }
  }, 10 * 60_000)
  try { flushTimer.unref?.() } catch { /* 忽略 */ }
  disposers.push(() => clearInterval(flushTimer))

  return () => {
    for (const d of disposers) { try { d() } catch { /* 尽力清理 */ } }
  }
}
