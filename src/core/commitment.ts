/**
 * 承诺：她说出口的"我会做"。
 * 落盘为事件；broken 的承诺不消失——这是"没翻篇"在记忆层的版本。
 */

/** 预筛：她的回复里出现承诺类措辞才值得一次 LLM 调用。 */
export const COMMITMENT_RE = /(?:^|[。！!]\s*)(?:可以|好的|行|没问题|包在我身上)[。!！,，?？吧]|我(?:会|一定|保证|答应|承诺|回头|明天|今晚|稍后|这就|现在(?:就)?|帮你|给你)/

/** 用户上一条消息是请求（帮我/可以吗/行不行…）——只有应答请求的"可以/行"才算承诺。 */
export const REQUEST_RE = /(?:帮我|帮我个忙|可以吗|行不行|能不能|行吗|好吗|拜托|麻烦你|能不能帮)/

export const COMMITMENT_SYSTEM_PROMPT = [
  '判断下面这段 AI 的回复里，AI 是否对用户做出了承诺。',
  '用户请求帮忙时，AI 表示同意（"可以/行/好的"）也算承诺；追问细节不算拒绝，仍是承诺的一部分。',
  '只输出 JSON：{"committed": true/false, "text": "承诺内容"}。',
  '没有承诺就输出 {"committed": false}。text 只写承诺本身，一句话。',
  '不要输出 JSON 以外的任何内容。',
].join('\n')

/** @returns {string|null} */
export function parseCommitment(text) {
  try {
    const json = JSON.parse((text.match(/\{[\s\S]*\}/) || ['{}'])[0])
    if (json.committed !== true || typeof json.text !== 'string') return null
    const t = json.text.trim().slice(0, 200)
    return t.length > 0 ? t : null
  } catch {
    return null
  }
}

export const BROKEN_SYSTEM_PROMPT = [
  '下面列了几个 AI 未完成的承诺，以及最近的一段对话。',
  '判断用户是否在抱怨/指出其中某个承诺没有被兑现。',
  '只输出 JSON：{"broken": true/false, "index": 0}。',
  'index 是承诺列表的序号（从 0 开始）。只有确定没兑现才输出 broken: true，不确定就 false。',
  '不要输出 JSON 以外的任何内容。',
].join('\n')

/** @returns {number|null} 被判定为已违背的承诺序号，null = 无 */
export function parseBroken(text, count) {
  try {
    const json = JSON.parse((text.match(/\{[\s\S]*\}/) || ['{}'])[0])
    if (json.broken !== true) return null
    const i = Number(json.index)
    if (!Number.isInteger(i) || i < 0 || i >= count) return null
    return i
  } catch {
    return null
  }
}
