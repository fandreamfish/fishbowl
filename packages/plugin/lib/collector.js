/**
 * 收集器：会话事件 → 轮次转录 → 评价 → 情绪/偏置 → 注入。
 * 因果方向：本轮的偏置由上一轮及更早的事件算出（评价在 turn/end 后异步执行）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { toBias } from '../../../src/core/engine.ts'
import { createAppraiser } from './appraiser.js'
import { summaryText } from './injector.js'

/** @param {import('./types.js').FishbowlConfig} cfg */
export function createCollector(ctx, binding, cfg) {
  const appraise = createAppraiser(cfg)
  const buffers = new Map() // sessionId -> { items: {role,text}[] }
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

  async function finishTurn(session) {
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

    trace({
      ts, sessionId: session.id, creatureId: creature.meta.creatureId,
      appraisal: a,
      affect: { v: affect.valence, a: affect.arousal, guilt: affect.guilt, longing: affect.longing },
      bias,
    })

    if (!cfg.control && cfg.injectBias) {
      const agent = findAgent(ctx, session.id)
      if (agent) {
        try {
          await agent.inject({
            content: [{ type: 'text', text: summaryText(bias, affect) }],
            source: { kind: 'fishbowl' },
          })
        } catch (err) {
          trace({ ts: Date.now(), sessionId: session.id, warn: `inject failed: ${String(err && err.message || err)}` })
        }
      }
    }
    buffers.delete(session.id)
  }

  const offEvent = ctx.on('session/event', (session, event) => {
    if (!session || !event || typeof event.type !== 'string') return
    if (!binding.manages(session.id)) return
    const t = event.type
    if (t === 'user/message') bufferFor(session.id).items.push({ role: 'user', text: textOf(event) })
    else if (t === 'assistant/message') bufferFor(session.id).items.push({ role: 'assistant', text: textOf(event) })
    else if (t === 'tool/result') {
      const name = toolNameOf(event)
      const err = event?.data?.isError || event?.data?.error
      bufferFor(session.id).items.push({ role: 'tool', text: `${name || 'tool'}${err ? '（出错）' : ''}` })
    } else if (t === 'turn/end') {
      finishTurn(session)
    }
  })
  if (offEvent) disposers.push(offEvent)

  // agent 建立时注入一次基线状态：让第一轮就知道自己的倾向在哪儿
  const offCreated = ctx.on('agent/created', (payload) => {
    const agent = payload?.agent ?? payload
    const sid = agent?.session?.id ?? agent?.id
    if (!sid || !binding.manages(sid)) return
    if (cfg.control || !cfg.injectBias) return
    const creature = binding.creatureFor(sid)
    const affect = creature.fold().affect
    const bias = toBias(affect, creature.temperament)
    const text = summaryText(bias, affect)
    Promise.resolve()
      .then(() => agent.inject({ content: [{ type: 'text', text }], source: { kind: 'fishbowl' } }))
      .catch(() => { /* agent 可能在注入前被销毁 */ })
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

/** 事件形状防御性提取。TODO: cordis_inspect_query 复核后收紧。 */
function textOf(event) {
  const d = event?.data
  if (!d) return ''
  if (typeof d.text === 'string') return d.text
  if (typeof d.content === 'string') return d.content
  if (Array.isArray(d.content)) {
    return d.content.map(b => (typeof b === 'string' ? b : b?.text || '')).join(' ')
  }
  return ''
}

function toolNameOf(event) {
  return event?.data?.toolName || event?.data?.name || event?.data?.tool || ''
}
