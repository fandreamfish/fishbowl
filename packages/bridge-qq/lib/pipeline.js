/**
 * QQ 通道的回复管线：与 DSH 插件共用同一套内核与评价器。
 * register 决定注入多少记忆：私聊 intimate 全给，群聊 public 零记忆。
 */
import { toBias } from '../../src/core/engine.ts'
import { memoryForChannel } from '../../src/core/channels.ts'
import { createAppraiser } from '../plugin/lib/appraiser.js'
import { summaryText } from '../plugin/lib/injector.js'
import { callLLM } from '../plugin/lib/llm.js'
import { voiceRulesFor } from '../plugin/lib/voice.js'

/**
 * @param {object} args { cfg, creature, userText, register }
 * @returns {Promise<string>}
 */
export async function reply({ cfg, creature, userText, register }) {
  const appraise = createAppraiser(cfg)
  const a = await appraise(`user: ${userText}\nassistant: `)
  creature.recordEpisode('qq', a, userText.slice(0, 300))
  const affect = creature.fold().affect
  const bias = toBias(affect, creature.temperament)
  const memory = memoryForChannel(creature.memorySummary(cfg.growth), register)

  const system = `${voiceRulesFor(cfg.relation?.kind)}\n\n${summaryText(bias, affect, memory)}`
  const text = await callLLM(cfg, system, userText, { json: false, maxTokens: 300 })
  return String(text ?? '').trim().slice(0, 500)
}
