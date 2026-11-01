/**
 * 收集器：会话事件 → 轮次转录 → 评价 → 情绪/偏置 → 注入。
 * 因果方向：本轮的偏置由上一轮及更早的事件算出（评价在 turn/end 后异步执行）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { ACTIVITY_RE, ACTIVITY_SYSTEM_PROMPT, mergePendingText, parseActivity } from '../../../src/core/activity.ts'
import { BROKEN_SYSTEM_PROMPT, COMMITMENT_RE, COMMITMENT_SYSTEM_PROMPT, parseBroken, parseCommitment, REQUEST_RE } from '../../../src/core/commitment.ts'
import { applyAppraisal, salienceOf, toBias } from '../../../src/core/engine.ts'
import { createMemoryStore } from '../memory/store.js'
import { configFor } from './fishcfg.js'
import { createAppraiser } from './appraiser.js'
import { isFishbowlInjection, messageText, textOf, toolNameOf, wakeOf, workspaceOf } from './extract.js'
import { IDENTITY_RE, IDENTITY_SYSTEM_PROMPT, parseIdentity } from './identity.js'
import { buildDiaryPrompt, canAsk, DIARY_SYSTEM_PROMPT, localDate, NOTE_SYSTEM_PROMPT, parseDiary, parseNote, parseRequest, REQUEST_SYSTEM_PROMPT } from './journal.js'
import { renameScopeAsync, restoreOriginalAsync } from './rename.js'
import { todayItems } from './browse/store.js'
import { browseDayKey } from '../../../src/core/browse.ts'
import { activeGrants, recordGrant, recentDialog } from '../../../src/core/signals.ts'
import { createDshHost } from '../host/dsh.js'
import { injectMessage, recallBlock, recentBlock } from './injector.js'
import { callLLM } from './llm.js'
import { voiceRulesFor } from './voice.js'
import { detectGrant, grantLine } from './grant.js'

/** 请求预筛：出现这些词才值得一次 LLM 调用。 */
const REQUEST_CUE = /可以吗|行不行|能不能|要不要|同意|允许|准不准|我想(?:去|要|做|试)|帮我|拜托|征求/

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

/** @param {import('./types.js').FishbowlConfig} cfg */
/** 被原谅：这些话说出来，愧疚才能真正降下去。 */
const REPAIR_RE = /(没事|不要紧|没关系|算了|原谅|别(?:往心里去|在意|自责)|不怪你|翻篇)/
export function forgivenessOf(text) {
  return REPAIR_RE.test(String(text ?? ''))
}
export function createCollector(ctx, binding, cfg, host, memorySource) {
  host = host ?? createDshHost(ctx, cfg)
  const appraise = createAppraiser(cfg)
  const getMemory = memorySource ?? createMemoryStore(cfg)
  const buffers = new Map() // sessionId -> { items: {role,text}[] }
  const lastKey = new Map() // sessionId -> 指纹（肉眼可见的变化才注入）
  const injectedBy = new Map() // sessionId -> 这一轮上下文里注入过的记忆 id
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
   * 只在用户消息里识别；重复说同一句不重复落盘。
   */
  function maybeGrant(session, text) {
    try {
      const creature = binding.resolve({ sessionId: session.id, workspace: workspaceOf(session) })
      if (!creature) return
      if (!configFor(cfg, creature).browse?.grantDetect) return
      const g = detectGrant(text)
      if (!g) return
      const active = activeGrants(creature, 'browse').length > 0
      if (g.allowed === active) return
      recordGrant(creature, g.topic, g.text, g.allowed)
      trace({ ts: Date.now(), sessionId: session.id, creatureId: creature.meta.creatureId, event: g.allowed ? 'grant' : 'grant-revoked', topic: g.topic, text: g.text })
    } catch { /* 许可识别失败不影响对话 */ }
  }

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
      const open = creature.openCommitments(configFor(cfg, creature).growth).filter(c => !c.broken)
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

  /** 共享活动（M3.2）：一起看/读/学 → activity 事件。 */
  async function detectActivity(sessionId, creature, transcript) {
    try {
      const raw = await callLLM(cfg, ACTIVITY_SYSTEM_PROMPT, transcript.slice(-800), { maxTokens: 60 })
      const parsed = parseActivity(raw)
      if (parsed) {
        creature.recordActivity(parsed.title, parsed.status)
        trace({ ts: Date.now(), sessionId, event: 'activity', ...parsed })
      }
    } catch (err) {
      trace({ ts: Date.now(), sessionId, warn: `activity failed: ${String(err && err.message || err)}` })
    }
  }

  /** 日记（M7）：一天一篇；只在今天还没写时生成。 */
  async function maybeDiary(sessionId, creature, transcript, affect) {
    try {
      const now = Date.now()
      const today = localDate(now, cfg.timezone)
      if (creature.hasDiary(today)) return
      const affectLine = `效价 ${affect.valence.toFixed(2)}，唤醒 ${affect.arousal.toFixed(2)}${affect.guilt > 0.05 ? `，愧疚 ${affect.guilt.toFixed(2)}` : ''}`
      const seen = todayItems(creature, browseDayKey(now, cfg.timezone)).slice(0, 6)
      const seenLine = seen.length
        ? '今天你自己在网上翻到过（只有标题和 UP，没有画面）：\n' + seen.map((x) => `- ${x.title}${x.up ? `（UP：${x.up}）` : ''}`).join('\n')
        : ''
      const raw = await callLLM(cfg, DIARY_SYSTEM_PROMPT, buildDiaryPrompt(transcript, affectLine, seenLine), { json: false, maxTokens: 400 })
      const text = parseDiary(raw)
      if (!text) return
      creature.recordDiary(today, text, now)
      trace({ ts: now, sessionId, event: 'diary', date: today })
    } catch (err) {
      trace({ ts: Date.now(), sessionId, warn: `diary failed: ${String(err && err.message || err)}` })
    }
  }

  /** 小纸条（M7）：一天最多一张；情绪够强或刚有新的记忆时才写。 */
  async function maybeNote(sessionId, creature, affect) {
    try {
      const now = Date.now()
      const today = localDate(now, cfg.timezone)
      if (creature.notes(1).some(n => localDate(n.ts, cfg.timezone) === today)) return
      const strong = Math.abs(affect.valence) > 0.5 || affect.guilt > 0.3 || affect.longing > 0.4
      if (!strong) return
      const stateLine = `效价 ${affect.valence.toFixed(2)}，唤醒 ${affect.arousal.toFixed(2)}，愧疚 ${affect.guilt.toFixed(2)}，想念 ${affect.longing.toFixed(2)}`
      const raw = await callLLM(cfg, NOTE_SYSTEM_PROMPT, stateLine, { json: false, maxTokens: 80 })
      const text = parseNote(raw)
      if (!text) return
      creature.recordNote(text, now)
      trace({ ts: now, sessionId, event: 'note' })
    } catch (err) {
      trace({ ts: Date.now(), sessionId, warn: `note failed: ${String(err && err.message || err)}` })
    }
  }

  /** 请求（M7）：一天最多一次、一周最多三次；配额在 journal.js。 */
  async function maybeRequest(sessionId, creature, transcript) {
    try {
      // 便宜的预筛：没有"征求同意"的迹象就不值得一次 LLM 调用（每轮都调会拖慢主对话）
      if (!REQUEST_CUE.test(transcript)) return
      const now = Date.now()
      const ask = canAsk(now, creature.requests().map(r => r.ts), cfg.timezone)
      if (!ask.ok) return
      const raw = await callLLM(cfg, REQUEST_SYSTEM_PROMPT, transcript.slice(-800), { maxTokens: 60 })
      const text = parseRequest(raw)
      if (!text) return
      creature.recordRequest(text, now)
      trace({ ts: now, sessionId, event: 'request', text })
    } catch (err) {
      trace({ ts: Date.now(), sessionId, warn: `request failed: ${String(err && err.message || err)}` })
    }
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
      const peak = { ...JSON.parse(JSON.stringify(creature.fold().affect)) }
      applyAppraisal(peak, a, creature.temperament)

      const injected = injectedBy.get(session.id) ?? []
      injectedBy.delete(session.id)
      mem.observe({ note: transcript, scope, appraisal: a, salience: salienceOf(a), affect: peak, injected, ts })

      const affect = creature.fold().affect
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
        void mem.tick({ llm: memLlm(), by: { model: cfg.appraiser.model } })
          .catch((err) => trace({ ts: Date.now(), sessionId: session.id, warn: `memory tick failed: ${String(err?.message || err)}` }))
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
        // 被原谅：愧疚才有出口（设计上只有 repair 能减）
        if (forgivenessOf(lastUserText) && creature.fold().affect.guilt > 0.2) {
          creature.recordRepair(0.35)
          trace({ ts: Date.now(), sessionId: session.id, creatureId: creature.meta.creatureId, event: 'repair', amount: 0.35 })
        }
        // —— M3.2：共享活动 ——
        if (ACTIVITY_RE.test(transcript)) {
          void detectActivity(session.id, creature, transcript)
        }
        // —— M7：日记 / 小纸条 / 请求 ——
        void maybeDiary(session.id, creature, transcript, affect)
        void maybeNote(session.id, creature, affect)
        void maybeRequest(session.id, creature, transcript)
      }

      if (!cfg.control && cfg.injectBias) {
        // 同一只鱼的其它会话：状态变了也同步过去（她要"在哪都一样"）
        try {
          const others = host.listAgents?.() ?? []
          for (const a of others) {
            const osid = a?.session?.id ?? a?.id
            if (!osid || osid === session.id) continue
            const oc = binding.resolve({ sessionId: osid, workspace: workspaceOf(a?.session) })
            if (!oc || oc.meta.creatureId !== creature.meta.creatureId) continue
            if (lastKey.get(osid) === snapFingerprint) continue
            lastKey.set(osid, snapFingerprint)
            await host.inject(a, injectMessage(snapText))
          }
        } catch { /* 同步失败不影响主流程 */ await Promise.resolve() }
        // 数值每轮都因衰减漂移 0.001，直接比文本永远不相等；
        // 量化到 0.1 的指纹只在肉眼可见的变化时触发注入。
        if (snapFingerprint !== lastKey.get(session.id)) {
          lastKey.set(session.id, snapFingerprint)
          const agent = host.agentFor(session.id)
          if (agent) {
            try {
              await host.inject(agent, injectMessage(snapText))
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
        maybeGrant(session, userText)
        maybeRecall(session, userText)
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
  const offCreated = host.onAgentCreated((payload) => {
    try {
      const agent = payload?.agent ?? payload
      const sid = agent?.session?.id ?? agent?.id
      if (!sid || !binding.manages(sid)) return

      const ws = workspaceOf(agent?.session) ?? workspaceOf(payload?.session)
      const creature = binding.resolve({ sessionId: sid, workspace: ws })
      if (!creature) {
        trace({ ts: Date.now(), sessionId: sid, warn: `no-occupant workspace=${ws ?? 'unknown'}` })
        // 之前住过又搬走了：会话打开时把名字改回原来的
        restoreOriginalAsync(host, cfg.stateDir, { kind: 'session', id: sid })
        return
      }

      // 声音：只给"有鱼住"的会话注册（scoped，只作用于这个 agent）
      try {
        const seedLine = cfg.seed?.background ? `\n\n你的来历：${cfg.seed.background}` : ''
        host.voice(agent, voiceRulesFor(configFor(cfg, creature).relation?.kind) + seedLine)
      } catch { /* 声音注册失败不影响功能 */ }

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

      if (cfg.control || !cfg.injectBias) return
      const mem = memoryFor(creature)
      const affect = creature.fold().affect
      const bias = toBias(affect, creature.temperament)
      const commitments = creature.openCommitments(configFor(cfg, creature).growth).slice(-2).map((x) => (x.broken ? '⚠ ' : '') + x.text)
      const snap = mem.render({ affect, bias, name: creature.meta.name, commitments })
      injectedBy.set(sid, snap.picked)
      // 基线里带上"你们之前说过的话"，新会话打开也能接上
      const recent = recentBlock(recentDialog(creature, 6))
      const grant = grantLine(creature)
      const text = snap.text + (grant ? `\n他允许你的事: ${grant}` : '') + (recent ? '\n' + recent : '')
      Promise.resolve()
        .then(() => {
          if (isEmptyShell(creature, snap.view)) return
          trace({ ts: Date.now(), sessionId: sid, event: 'inject', kind: 'baseline', name: creature.meta.name })
          return host.inject(agent, injectMessage(text))
        })
        .catch(() => { /* agent 可能在注入前被销毁 */ })
    } catch { /* 同上，绝不外抛 */ }
  })
  if (offCreated) disposers.push(offCreated)

  return () => {
    for (const d of disposers) { try { d() } catch { /* 尽力清理 */ } }
  }
}

