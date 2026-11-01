/**
 * QQ 通道的回复管线：与 DSH 插件共用同一套内核、评价器与记忆模块。
 * register 决定注入多少记忆：私聊 intimate 给全部记忆，群聊 public 一条都不给。
 *
 * 顺序很重要（因果方向）：先用上一轮的偏置生成回复，再把这一轮落进账本。
 * 这一轮的情绪不参与这一轮的判断。
 */
import path from 'node:path'
import { applyAppraisal, salienceOf, toBias } from '../../../src/core/engine.ts'
import { Memory } from '../../memory/src/memory.ts'
import { createAppraiser } from '../../app/src/appraiser.js'
import { configFor } from '../../app/src/fishcfg.js'
import { summaryText } from '../../app/src/injector.js'
import { callLLM } from '../../app/src/llm.js'
import { voiceRulesFor } from '../../voice/src/voice.js'

/**
 * 把一轮 QQ 对话记进她的账本（与 DSH 那边同一种 turn 事件）。
 * 单独抽出来是为了可测：回复内容不必真调模型。
 */
export function rememberTurn({ cfg, creature, userText, text, appraisal, peak, now = Date.now() }) {
  const fcfg = configFor(cfg, creature)
  const m = new Memory({ dir: path.join(cfg.stateDir, creature.meta.creatureId), lock: fcfg.memory?.singleWriter ?? 'warn' })
  try {
    m.setConfig(fcfg.memory)
    m.observe({
      note: '用户: ' + userText + '\n助手: ' + text,
      scope: { kind: 'channel', id: 'qq' },
      appraisal,
      salience: salienceOf(appraisal),
      affect: peak,
      injected: [],
      ts: now,
    })
  } finally { try { m.close() } catch { /* 尽力 */ } }
  return true
}

/**
 * @param {object} args { cfg, creature, userText, register }
 * @returns {Promise<string>}
 */
export async function reply({ cfg, creature, userText, register }) {
  const fcfg = configFor(cfg, creature)
  const appraise = createAppraiser(fcfg)

  // 1) 这一轮的评价（算峰值，但先不改变量）
  const a = await appraise(`user: ${userText}\nassistant: `)
  const peak = { ...JSON.parse(JSON.stringify(creature.fold().affect)) }
  applyAppraisal(peak, a, creature.temperament)

  // 2) 用"这一轮之前"的状态生成回复
  const affect = creature.fold().affect
  const bias = toBias(affect, creature.temperament)
  let block = ''
  const intimate = register === 'intimate'
  let mem = null

  if (intimate) {
    try {
      mem = new Memory({
        dir: path.join(cfg.stateDir, creature.meta.creatureId),
        lock: fcfg.memory?.singleWriter ?? 'warn',
      })
      mem.setConfig(fcfg.memory)
      const commitments = creature
        .openCommitments(fcfg.growth)
        .slice(-2)
        .map((x) => (x.broken ? '⚠ ' : '') + x.text)
      block = mem.render({ affect, bias, name: creature.meta.name, commitments }).text
    } catch {
      mem = null
    }
  }
  // 公开场合（或渲染失败）：一条私事都不带，只留状态
  if (!block) block = summaryText(bias, affect, { name: null, semantics: [], procedures: [], self: [] })

  const system = `${voiceRulesFor(fcfg.relation?.kind)}\n\n${block}`
  const text = String((await callLLM(fcfg, system, userText, { json: false, maxTokens: 300 })) ?? '').trim().slice(0, 500)

  // 3) 这一轮落进同一本账（新记忆模块认 turn 事件）
  try { rememberTurn({ cfg, creature, userText, text, appraisal: a, peak, now: Date.now() }) } catch { /* 记账失败不影响这次回复 */ }
  try { mem?.close() } catch { /* 尽力 */ }

  return text
}
