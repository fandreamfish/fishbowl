/**
 * 一轮结束之后的"长尾"：许可、身份、承诺、违诺、共同活动、日记、小纸条、请求。
 *
 * 这些都不是对话主链路：慢、可失败、不影响回复本身。
 * 从 turn.js 拆出来，主链路只剩「缓冲 → 评价 → 情绪 → 记忆 → 注入」。
 */
import { ACTIVITY_RE, ACTIVITY_SYSTEM_PROMPT, parseActivity } from '../../../being/src/activity.ts'
import { BROKEN_SYSTEM_PROMPT, COMMITMENT_RE, COMMITMENT_SYSTEM_PROMPT, parseBroken, parseCommitment, REQUEST_RE } from '../../../being/src/commitment.ts'
import { activeGrants, recordGrant } from '../../../being/src/signals.ts'
import { buildDiaryPrompt, canAsk, DIARY_SYSTEM_PROMPT, inDiaryWindow, localDate, NOTE_SYSTEM_PROMPT, parseDiary, parseNote, parseRequest, REQUEST_SYSTEM_PROMPT } from '../../../journal/src/journal.js'
import { todayItems } from '../../../bilibili/src/store.js'
import { IDENTITY_SYSTEM_PROMPT, parseIdentity } from '../identity.js'
import { detectGrant } from '../grant.js'
import { workspaceOf } from '../extract.js'

/** 请求预筛：出现这些词才值得一次 LLM 调用。 */
const REQUEST_CUE = /可以吗|行不行|能不能|要不要|同意|允许|准不准|我想(?:去|要|做|试)|帮我|拜托|征求/

/** 被原谅：这些话说出来，愧疚才能真正降下去。 */
const REPAIR_RE = /(没事|不要紧|没关系|算了|原谅|别(?:往心里去|在意|自责)|不怪你|翻篇)/
export function forgivenessOf(text) {
  return REPAIR_RE.test(String(text ?? ''))
}

export { ACTIVITY_RE, COMMITMENT_RE, REQUEST_RE, IDENTITY_SYSTEM_PROMPT }

/**
 * @param {object} deps { cfg, binding, trace, callLLM, configFor }
 */
export function createAfterTurn({ cfg, binding, trace, callLLM, configFor }) {
  /** 某一天的聊天转录（从账本里取，不再只看当前这一轮）。 */
  function transcriptOfDay(creature, date) {
    const lines = []
    for (const e of creature.store.readEvents()) {
      if (e.t !== 'turn' && e.t !== 'episode') continue
      if (localDate(Number(e.ts), cfg.timezone) !== date) continue
      const note = String(e.note ?? '').replace(/situation:[^]*?(?=\n|$)/, '').trim()
      if (note) lines.push(note.slice(0, 400))
    }
    return lines.slice(-20).join('\n').slice(-4000)
  }

  async function writeDiary(sessionId, creature, date) {
    const transcript = transcriptOfDay(creature, date)
    if (!transcript) return
    const now = Date.now()
    const affect = creature.affectNow ? creature.affectNow() : creature.fold().affect
    const affectLine = `效价 ${affect.valence.toFixed(2)}，唤醒 ${affect.arousal.toFixed(2)}${affect.guilt > 0.05 ? `，愧疚 ${affect.guilt.toFixed(2)}` : ''}`
    const seen = todayItems(creature, date).slice(0, 6)
    const seenLine = seen.length
      ? '那天你自己在网上翻到过（只有标题和 UP，没有画面）：\n' + seen.map((x) => `- ${x.title}${x.up ? `（UP：${x.up}）` : ''}`).join('\n')
      : ''
    const raw = await callLLM(configFor(cfg, creature), DIARY_SYSTEM_PROMPT, buildDiaryPrompt(transcript, affectLine, seenLine), { json: false, maxTokens: 400 })
    const text = parseDiary(raw)
    if (!text) return
    creature.recordDiary(date, text, now)
    trace({ ts: now, sessionId, event: 'diary', date })
  }

  /**
   * 日记：当天的最后一件事。
   *   - 在写日记的时间窗里、今天还没写 → 写今天的
   *   - 不管几点，昨天的没写 → 先补昨天的（第二天第一件事）
   */
  async function runDiary(sessionId, creature) {
    try {
      const now = Date.now()
      const dcfg = configFor(cfg, creature).diary || {}
      if (dcfg.enabled === false) return
      const today = localDate(now, cfg.timezone)
      const yesterday = localDate(now - 86_400_000, cfg.timezone)
      if (dcfg.catchUp !== false && !creature.hasDiary(yesterday)) await writeDiary(sessionId, creature, yesterday)
      if (!creature.hasDiary(today) && inDiaryWindow(now, dcfg.start ?? '21:30', dcfg.end ?? '23:59', cfg.timezone)) {
        await writeDiary(sessionId, creature, today)
      }
    } catch (err) {
      trace({ ts: Date.now(), sessionId, warn: `diary failed: ${String(err && err.message || err)}` })
    }
  }

  /** 小纸条：一天最多一张；情绪够强才写。 */
  async function maybeNote(sessionId, creature, affect) {
    try {
      const now = Date.now()
      const today = localDate(now, cfg.timezone)
      if (creature.notes(1).some((n) => localDate(n.ts, cfg.timezone) === today)) return
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

  /** 请求：一天最多一次、一周最多三次；配额在 journal.js。 */
  async function maybeRequest(sessionId, creature, transcript) {
    try {
      if (!REQUEST_CUE.test(transcript)) return
      const now = Date.now()
      const ask = canAsk(now, creature.requests().map((r) => r.ts), cfg.timezone)
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

  /** 承诺：她的话里出现"我会/我保证"类措辞 → LLM 提取 → 落盘。 */
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

  /** 违诺检测：用户抱怨 + 评价器给出 norm_violation → 判定哪个承诺没兑现。 */
  async function checkBroken(sessionId, creature, transcript) {
    try {
      const open = creature.openCommitments(configFor(cfg, creature).growth).filter((c) => !c.broken)
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

  /** 共享活动：一起看/读/学 → activity 事件。 */
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

  /** 「你没事可以刷刷 B 站」是许可，不是命令。 */
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

  return { maybeGrant, detectIdentity, detectCommitment, checkBroken, detectActivity, runDiary, maybeNote, maybeRequest, transcriptOfDay, writeDiary }
}
