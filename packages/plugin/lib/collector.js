/**
 * 收集器：会话事件 → 轮次转录 → 评价 → 情绪/偏置 → 注入。
 * 因果方向：本轮的偏置由上一轮及更早的事件算出（评价在 turn/end 后异步执行）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { toBias } from '../../../src/core/engine.ts'
import { createAppraiser } from './appraiser.js'
import { isFishbowlInjection, messageText, textOf, toolNameOf } from './extract.js'
import { injectMessage, stateKey, summaryText } from './injector.js'
import { VOICE_RULES } from './voice.js'

/** @param {import('./types.js').FishbowlConfig} cfg */
export function createCollector(ctx, binding, cfg) {
  const appraise = createAppraiser(cfg)
  const buffers = new Map() // sessionId -> { items: {role,text}[] }
  const lastKey = new Map() // sessionId -> stateKey（肉眼可见的变化才注入）
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

      trace({
        ts, sessionId: session.id, creatureId: creature.meta.creatureId,
        appraisal: a,
        affect: { v: affect.valence, a: affect.arousal, guilt: affect.guilt, longing: affect.longing },
        bias,
      })

      if (!cfg.control && cfg.injectBias) {
        const key = stateKey(bias, affect)
        // 数值每轮都因衰减漂移 0.001，直接比文本永远不相等；
        // 量化到 0.1 的指纹只在肉眼可见的变化时触发注入。
        if (key !== lastKey.get(session.id)) {
          lastKey.set(session.id, key)
          const agent = findAgent(ctx, session.id)
          if (agent) {
            try {
              await agent.inject(injectMessage(summaryText(bias, affect)))
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
        agent.ctx?.systemPrompt?.section?.({ name: 'fishbowl-voice', order: 400, text: VOICE_RULES })
      } catch { /* 声音注册失败不影响功能 */ }

      if (cfg.control || !cfg.injectBias) return
      const creature = binding.creatureFor(sid)
      const affect = creature.fold().affect
      const bias = toBias(affect, creature.temperament)
      const text = summaryText(bias, affect)
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
