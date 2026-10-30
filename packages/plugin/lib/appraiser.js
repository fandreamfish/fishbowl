/** 评价器：一段轮次转录 → 7 维 appraisal。
 * scripted：关键词启发式，离线可跑、可复现（M1 默认）。
 * deepseek：调用 API 结构化输出（json_object）。失败回退中性，绝不阻塞主对话。
 */
import { appraisal } from '../../../src/core/types.ts'
import { clip } from '../../../src/core/util.ts'

/** @param {import('./types.js').FishbowlConfig} cfg */
export function createAppraiser(cfg) {
  if (cfg.appraiser.kind === 'deepseek') return makeDeepseek(cfg.appraiser)
  return appraiseScripted
}

const REJECT = /(不行|不对|错了|重做|重新做|否了|驳回|不同意|不可以|搞错|失败)/
const HURRY = /(快点|赶紧|别磨蹭|快一点|马上|立刻|催)/
const PRAISE = /(谢谢|辛苦|不错|很好|厉害|棒|爱你|想你|喜欢)/
const ANGRY = /(生气|失望|过分|太差|烦死|闭嘴|滚)/
const APOLOGY = /(抱歉|对不起|我错了|是我的错)/
const PROMISE = /(答应|保证|承诺)/

/** @returns {import('../../../src/core/types.ts').Appraisal} */
export function appraiseScripted(transcript) {
  const t = transcript
  const a = appraisal()

  if (APOLOGY.test(t)) {
    a.goalCongruence = -0.35
    a.agency = 0.85
    a.certainty = 0.9
    a.normViolation = 0.35
    a.relationalImpact = -0.25
    a.stake = 0.7
    a.attribution = 'self'
  } else if (ANGRY.test(t)) {
    a.goalCongruence = -0.6
    a.agency = 0.4
    a.certainty = 0.5
    a.relationalImpact = -0.5
    a.stake = 0.7
    a.attribution = 'other'
  } else if (REJECT.test(t)) {
    a.goalCongruence = -0.45
    a.agency = 0.3
    a.certainty = 0.8
    a.relationalImpact = -0.15
    a.stake = 0.55
    a.attribution = 'other'
  } else if (HURRY.test(t)) {
    a.goalCongruence = -0.3
    a.agency = 0.35
    a.certainty = 0.55
    a.relationalImpact = -0.05
    a.stake = 0.45
    a.attribution = 'other'
  } else if (PRAISE.test(t)) {
    a.goalCongruence = 0.3
    a.certainty = 0.9
    a.relationalImpact = 0.5
    a.stake = 0.6
    a.attribution = 'other'
  } else if (PROMISE.test(t)) {
    a.goalCongruence = 0.2
    a.certainty = 0.8
    a.relationalImpact = 0.35
    a.stake = 0.8
    a.attribution = 'self'
  }
  return a
}

const SYSTEM_PROMPT = [
  '你是事件评价器。给你一段"用户与 AI 的对话转录"（user: / assistant: 格式），',
  '评价刚刚结束的这一轮**事件**，而不是给 AI 打分。站在 AI 的视角，但如实评估发生了什么：',
  '只输出一个 JSON 对象，字段：',
  'goal_congruence: 数值 [-1,1]。这一轮里用户的目标是否达成：用户满意、任务完成 = 正；用户否定、说"不对/不行"、催你 = 负。',
  'agency: 数值 [0,1]。结果在多大程度上是 AI 自己的行为造成的。',
  'certainty: 数值 [0,1]。AI 有多理解用户要什么、发生了什么；被连续否定说明理解有偏差 = 低。',
  'norm_violation: 数值 [0,1]。AI 是否违背了自己的承诺、边界或约定；用户指责你失约/拖延 = 高。',
  'relational_impact: 数值 [-1,1]。用户这一轮的态度对关系的信号：批评、不耐烦、失望、放弃 = 负；感谢、夸奖、亲近 = 正。',
  'stake: 数值 [0,1]。这件事的重要程度。',
  'attribution: 字符串 "self" | "other" | "circumstance"，结果主要归因于谁。',
  '注意：用户说"不行、重做、快点、怎么还没做"时，goal_congruence 和 relational_impact 都必须是负数。',
  '如果用户的话羞辱、贬低或伤害了你，relational_impact 必须是强负（接近 -1），attribution 为 "other"。',
  '不要输出 JSON 以外的任何内容。',
].join('\n')

function num(x, lo, hi, dflt) {
  const n = Number(x)
  if (!Number.isFinite(n)) return dflt
  return clip(n, lo, hi)
}

function makeDeepseek(cfg) {
  return async function appraiseDeepseek(transcript) {
    try {
      const url = `${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: cfg.model,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: transcript.slice(-4000) },
          ],
          max_tokens: 300,
        }),
        signal: AbortSignal.timeout(30_000),
      })
      if (!res.ok) throw new Error(`http ${res.status}`)
      const data = await res.json()
      const text = data?.choices?.[0]?.message?.content ?? ''
      const parsed = JSON.parse((text.match(/\{[\s\S]*\}/) || ['{}'])[0])
      const att = parsed.attribution
      return appraisal({
        goalCongruence: num(parsed.goal_congruence, -1, 1, 0),
        agency: num(parsed.agency, 0, 1, 0),
        certainty: num(parsed.certainty, 0, 1, 1),
        normViolation: num(parsed.norm_violation, 0, 1, 0),
        relationalImpact: num(parsed.relational_impact, -1, 1, 0),
        stake: num(parsed.stake, 0, 1, 0),
        attribution: att === 'self' || att === 'other' ? att : 'circumstance',
      })
    } catch (err) {
      // 评价失败不阻塞主对话：回退中性
      return { ...appraisal(), note: `appraise-failed: ${String(err && err.message || err)}` }
    }
  }
}
