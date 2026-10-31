/**
 * 收集器：会话事件 → 轮次转录 → 评价 → 情绪/偏置 → 注入。
 * 因果方向：本轮的偏置由上一轮及更早的事件算出（评价在 turn/end 后异步执行）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { CONSOLIDATION_SYSTEM_PROMPT, dedupeConsolidation, parseConsolidation, shouldConsolidate } from '../../../src/core/consolidation.ts'
import { BROKEN_SYSTEM_PROMPT, COMMITMENT_RE, COMMITMENT_SYSTEM_PROMPT, parseBroken, parseCommitment, REQUEST_RE } from '../../../src/core/commitment.ts'
import { salienceOf, toBias } from '../../../src/core/engine.ts'
import { dedupeSelf, parseSelf, SELF_SYSTEM_PROMPT, shouldSelfConsolidate } from '../../../src/core/selfmodel.ts'
import { createAppraiser } from './appraiser.js'
import { isFishbowlInjection, messageText, textOf, toolNameOf } from './extract.js'
import { IDENTITY_RE, IDENTITY_SYSTEM_PROMPT, parseIdentity } from './identity.js'
import { injectMessage, stateKey, summaryText } from './injector.js'
import { callLLM } from './llm.js'
import { voiceRulesFor } from './voice.js'

/** @param {import('./types.js').FishbowlConfig} cfg */
export function createCollector(ctx, binding, cfg) {
  const appraise = createAppraiser(cfg)
  const buffers = new Map() // sessionId -> { items: {role,text}[] }
  const lastKey = new Map() // sessionId -> stateKey（肉眼可见的变化才注入）
  const consolidating = new Map() // sessionId -> { episodesSince, salienceSince, sinceLast }
  const selfCounters = new Map() // sessionId -> { episodesSinceSelf, sinceLastSelf }
  const tracePath = path.join(binding.dir, 'trace.ndjson')
  const disposers = []

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

  /** 巩固：把最近的转录压成语义与教训，落盘为事件（带去重与冷却）。 */
  async function consolidate(sessionId, creature) {
    try {
      const events = creature.store.readEvents()
      const episodes = events.filter((e) => e.t === 'episode').slice(-8)
      if (episodes.length < 3) return
      const existing = creature.memorySummary(cfg.growth)
      const known = [
        '你已经记住的：',
        ...existing.semantics.map((c) => `- 事实: ${c}`),
        ...existing.procedures.map((c) => `- 教训: ${c}`),
      ].join('\n')
      const lines = episodes.map((e, i) => `[${i + 1}] ${(e.note ?? '').slice(0, 300)}`).join('\n')
      const raw = await callLLM(cfg, CONSOLIDATION_SYSTEM_PROMPT, `${known}\n\n最近对话：\n${lines}`, { maxTokens: 600 })
      const parsed = dedupeConsolidation(parseConsolidation(raw), existing)
      const ts = Date.now()
      for (const s of parsed.semantics) creature.recordSemantic(s.claim, s.evidence, s.confidence, ts)
      for (const p of parsed.procedures) creature.recordProcedure(p.trigger, p.action, p.evidence, p.confidence, ts)
      if (parsed.semantics.length || parsed.procedures.length) {
        trace({ ts, sessionId, event: 'consolidated', semantics: parsed.semantics, procedures: parsed.procedures })
      }
    } catch (err) {
      trace({ ts: Date.now(), sessionId, warn: `consolidate failed: ${String(err && err.message || err)}` })
    }
  }

  /** 身份：用户起名 → identity 事件 + meta.name。 */
  async function detectIdentity(sessionId, creature, transcript) {
    try {
      const raw = await callLLM(cfg, IDENTITY_SYSTEM_PROMPT, transcript.slice(-800), { maxTokens: 60 })
      const name = parseIdentity(raw)
      if (name && name !== creature.meta.name) {
        creature.recordIdentity(name)
        trace({ ts: Date.now(), sessionId, event: 'named', name })
      }
    } catch (err) {
      trace({ ts: Date.now(), sessionId, warn: `identity failed: ${String(err && err.message || err)}` })
    }
  }

  /** 自我认知：比巩固稀有得多；证据不足的部分直接丢弃。 */
  async function selfConsolidate(sessionId, creature) {
    try {
      const events = creature.store.readEvents()
      const episodes = events.filter((e) => e.t === 'episode').slice(-14)
      if (episodes.length < 4) return
      const existing = creature.memorySummary(cfg.growth)
      const known = [
        '你已经认定的自我描述：',
        ...existing.self.map((c) => `- ${c}`),
      ].join('\n')
      const lines = episodes.map((e, i) => `[${i + 1}] ${(e.note ?? '').slice(0, 300)}`).join('\n')
      const raw = await callLLM(cfg, SELF_SYSTEM_PROMPT, `${known}\n\n最近对话：\n${lines}`, { maxTokens: 500 })
      const parsed = dedupeSelf(parseSelf(raw), existing.self)
      const ts = Date.now()
      for (const s of parsed) creature.recordSelf(s.claim, s.evidence, s.confidence, ts)
      if (parsed.length) trace({ ts, sessionId, event: 'self-consolidated', self: parsed })
    } catch (err) {
      trace({ ts: Date.now(), sessionId, warn: `self-consolidate failed: ${String(err && err.message || err)}` })
    }
  }

  /** 承诺（M2.4）：她的话里出现"我会/我保证"类措辞 → LLM 提取 → 落盘。 */
  async function detectCommitment(sessionId, creature, herText) {
    try {
      const raw = await callLLM(cfg, COMMITMENT_SYSTEM_PROMPT, herText.slice(-600), { maxTokens: 100 })
      const text = parseCommitment(raw)
      if (text) {
        creature.recordCommitment(text)
        trace({ ts: Date.now(), sessionId, event: 'committed', text })
      }
    } catch (err) {
      trace({ ts: Date.now(), sessionId, warn: `commitment failed: ${String(err && err.message || err)}` })
    }
  }

  /** 违诺检测（M2.4）：用户抱怨 + 评价器给出 norm_violation → 判定哪个承诺没兑现。 */
  async function checkBroken(sessionId, creature, transcript) {
    try {
      const open = creature.openCommitments(cfg.growth).filter(c => !c.broken)
      if (open.length === 0) return
      const lines = open.map((c, i) => `${i}. ${c.text}`).join('\n')
      const raw = await callLLM(cfg, BROKEN_SYSTEM_PROMPT, `未完成承诺：\n${lines}\n\n最近对话：\n${transcript.slice(-800)}`, { maxTokens: 60 })
      const idx = parseBroken(raw, open.length)
      if (idx !== null) {
        creature.resolveCommitment(open[idx].id, 'broken')
        trace({ ts: Date.now(), sessionId, event: 'commitment-broken', text: open[idx].text })
      }
    } catch (err) {
      trace({ ts: Date.now(), sessionId, warn: `commitment-broken failed: ${String(err && err.message || err)}` })
    }
  }

  async function finishTurn(session) {
    try {
      const buf = buffers.get(session.id)
      if (!buf || buf.items.length === 0) return
      const transcript = buf.items
        .slice(-Math.ceil(cfg.transcriptLimit / 60))
        .map(i => `${i.role}: ${i.text}`)
        .join('\n')
        .slice(-cfg.transcriptLimit)

      const creature = binding.creatureFor(session.id)
      const a = await appraise(transcript)
      const ts = Date.now()
      creature.recordEpisode('turn', a, transcript.slice(0, 400), ts)
      const affect = creature.fold().affect
      const bias = toBias(affect, creature.temperament)
      const memory = creature.memorySummary(cfg.growth)

      trace({
        ts, sessionId: session.id, creatureId: creature.meta.creatureId,
        appraisal: a,
        affect: { v: affect.valence, a: affect.arousal, guilt: affect.guilt, longing: affect.longing },
        bias,
      })

      // —— M2：巩固与身份（异步，失败不影响主流程） ——
      const cnt = consolidating.get(session.id) ?? { episodesSince: 0, salienceSince: 0, sinceLast: 99 }
      cnt.episodesSince += 1
      cnt.salienceSince += salienceOf(a)
      cnt.sinceLast += 1
      consolidating.set(session.id, cnt)
      if (cfg.appraiser.kind === 'deepseek') {
        if (shouldConsolidate({ episodesSince: cnt.episodesSince, salienceSince: cnt.salienceSince, sinceLast: cnt.sinceLast, g: cfg.growth })) {
          consolidating.set(session.id, { episodesSince: 0, salienceSince: 0, sinceLast: 0 })
          void consolidate(session.id, creature)
        }
        if (IDENTITY_RE.test(transcript)) {
          void detectIdentity(session.id, creature, transcript)
        }
        // —— M2.4：承诺与违诺 ——
        const herText = buf.items.filter(i => i.role === 'assistant').map(i => i.text).join(' ')
        const lastUserText = buf.items.filter(i => i.role === 'user').slice(-1).map(i => i.text).join(' ')
        if (herText && COMMITMENT_RE.test(herText) && REQUEST_RE.test(lastUserText)) {
          void detectCommitment(session.id, creature, herText)
        }
        if (a.normViolation >= 0.2) {
          void checkBroken(session.id, creature, transcript)
        }
        // —— M2.2：自我认知（稀有触发 + 冷却） ——
        const scnt = selfCounters.get(session.id) ?? { episodesSinceSelf: 0, sinceLastSelf: 99 }
        scnt.episodesSinceSelf += 1
        scnt.sinceLastSelf += 1
        selfCounters.set(session.id, scnt)
        if (shouldSelfConsolidate({ episodesSince: scnt.episodesSinceSelf, sinceLast: scnt.sinceLastSelf, g: cfg.growth })) {
          selfCounters.set(session.id, { episodesSinceSelf: 0, sinceLastSelf: 0 })
          void selfConsolidate(session.id, creature)
        }
      }

      if (!cfg.control && cfg.injectBias) {
        const key = stateKey(bias, affect, memory)
        // 数值每轮都因衰减漂移 0.001，直接比文本永远不相等；
        // 量化到 0.1 的指纹只在肉眼可见的变化时触发注入。
        if (key !== lastKey.get(session.id)) {
          lastKey.set(session.id, key)
          const agent = findAgent(ctx, session.id)
          if (agent) {
            try {
              await agent.inject(injectMessage(summaryText(bias, affect, memory)))
            } catch (err) {
              trace({ ts: Date.now(), sessionId: session.id, warn: `inject failed: ${String(err && err.message || err)}` })
            }
          }
        }
      }
      buffers.delete(session.id)
    } catch (err) {
      trace({ ts: Date.now(), sessionId: session.id, warn: `collect failed: ${String(err && err.message || err)}` })
    }
  }

  const offEvent = ctx.on('session/event', (session, event) => {
    try {
      if (!session || !event || typeof event.type !== 'string') return
      if (!binding.manages(session.id)) return
      const t = event.type
      if (t === 'user/message') {
        if (isFishbowlInjection(event)) return // 自己注入的状态块不算对话内容
        pushItem(session.id, 'user', textOf(event))
      } else if (t === 'assistant/message') {
        pushItem(session.id, 'assistant', textOf(event))
      } else if (t === 'tool/result') {
        const name = toolNameOf(event)
        const err = event?.data?.message?.isError || event?.data?.isError || event?.data?.error
        const text = messageText(event?.data?.message ?? event?.data)
        pushItem(session.id, 'tool', [name, err ? '（出错）' : '', text ? text.slice(0, 200) : ''].filter(Boolean).join(' '))
      } else if (t === 'turn/end') {
        finishTurn(session)
      }
    } catch { /* 宿主事件处理绝不外抛 */ }
  })
  if (offEvent) disposers.push(offEvent)

  // agent 建立时：注入一次基线状态 + 注册该 agent 的声音规则（scoped，不影响其他会话）
  const offCreated = ctx.on('agent/created', (payload) => {
    try {
      const agent = payload?.agent ?? payload
      const sid = agent?.session?.id ?? agent?.id
      if (!sid || !binding.manages(sid)) return

      // 声音：注册到 agent.ctx 只作用于这个 agent（dsh-system-prompt 的 scoped 贡献）
      try {
        agent.ctx?.systemPrompt?.section?.({ name: 'fishbowl-voice', order: 400, text: voiceRulesFor(cfg.relation?.kind) })
      } catch { /* 声音注册失败不影响功能 */ }

      if (cfg.control || !cfg.injectBias) return
      const creature = binding.creatureFor(sid)
      const affect = creature.fold().affect
      const bias = toBias(affect, creature.temperament)
      const memory = creature.memorySummary(cfg.growth)
      const text = summaryText(bias, affect, memory)
      Promise.resolve()
        .then(() => agent.inject(injectMessage(text)))
        .catch(() => { /* agent 可能在注入前被销毁 */ })
    } catch { /* 同上，绝不外抛 */ }
  })
  if (offCreated) disposers.push(offCreated)

  return () => {
    for (const d of disposers) { try { d() } catch { /* 尽力清理 */ } }
  }
}

function findAgent(ctx, sessionId) {
  const reg = ctx.agents
  if (!reg) return null
  try {
    if (typeof reg.get === 'function') {
      const a = reg.get(sessionId)
      if (a) return a
    }
  } catch { /* 形状不同则继续 */ }
  try {
    const list = typeof reg.list === 'function' ? reg.list() : []
    for (const a of list) {
      if (a && (a.id === sessionId || a.session?.id === sessionId)) return a
    }
  } catch { /* 同上 */ }
  return null
}
