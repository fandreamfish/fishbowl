/**
 * M7：日记 / 小纸条 / 请求。
 *
 * 三个都是"她想说点什么"的不同体裁：
 *   - 日记：每天一篇，写今天发生的事与心情。一天最多一篇。
 *   - 小纸条：特意留给你的话，代表她当前状态。一天最多一张。
 *   - 请求：有事想征求你同意。一天最多一次，一周最多三次；没答的可以补答。
 *
 * 生成靠 LLM，配额与判定在这里（纯函数，可测）。
 */

/** 本地日期 YYYY-MM-DD（按个体时区）。 */
export function localDate(ts, timezone = 'Asia/Shanghai') {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts))
  } catch {
    return new Date(ts).toISOString().slice(0, 10)
  }
}

/** 今天 0 点（本地时区）的毫秒时间戳。 */
export function startOfDay(ts, timezone = 'Asia/Shanghai') {
  const date = localDate(ts, timezone)
  const midnight = new Date(`${date}T00:00:00`)
  // 用日期字符串构造本地时间；时区差异交给 Intl 的日期即可（够用）
  return midnight.getTime()
}

export const REQUEST_DAILY_MAX = 1
export const REQUEST_WEEKLY_MAX = 3

/**
 * 现在能不能提请求。
 * @param {number[]} requestTs 已有请求的时间戳
 */
export function canAsk(now, requestTs, timezone = 'Asia/Shanghai') {
  const dayStart = startOfDay(now, timezone)
  const weekAgo = now - 7 * 86_400_000
  const today = requestTs.filter(ts => ts >= dayStart).length
  const week = requestTs.filter(ts => ts >= weekAgo).length
  if (today >= REQUEST_DAILY_MAX) return { ok: false, why: '今天已经问过你了' }
  if (week >= REQUEST_WEEKLY_MAX) return { ok: false, why: '这周问得够多了' }
  return { ok: true, why: '' }
}

export const DIARY_SYSTEM_PROMPT = [
  '你在写今天的日记。就像人写日记一样：写今天发生了什么、你当时怎么想、现在的心情。',
  '第一人称，100–200 字。不要总结升华，不要"今天我学到了"这种句子。不要用列表。',
  '只输出日记正文。',
].join('\n')

export function buildDiaryPrompt(transcript, affectLine) {
  return `今天你和他之间发生的事：\n${transcript.slice(-1200)}\n\n你现在的状态：${affectLine}\n\n写今天的日记。`
}

/** 模型输出 → 日记正文；空或太长返回 null。 */
export function parseDiary(text) {
  if (typeof text !== 'string') return null
  const t = text.trim().replace(/^["'“”]+|["'“”]+$/g, '').trim()
  if (t.length === 0) return null
  return t.slice(0, 400)
}

export const NOTE_SYSTEM_PROMPT = [
  '你想给他留一张小纸条——特意留给他的话，可能是一句惦记、一句气话、一个提醒。',
  '一到两句话，不要解释为什么写，不要说"这是一张纸条"。只输出纸条内容。',
].join('\n')

export function parseNote(text) {
  if (typeof text !== 'string') return null
  const t = text.trim().replace(/^["'“”]+|["'“”]+$/g, '').trim()
  return t.length === 0 ? null : t.slice(0, 120)
}

export const REQUEST_SYSTEM_PROMPT = [
  '判断这次对话里，对方是否说过一件需要你同意的事（他请你允许某件事、或你正在征求他同意）。',
  '只输出 JSON：{"ask": true, "text": "征求同意的那句话（≤40字）"} 或 {"ask": false}。',
  '没有就输出 {"ask": false}。不要输出 JSON 以外的任何内容。',
].join('\n')

export function parseRequest(text) {
  try {
    const json = JSON.parse((text.match(/\{[\s\S]*\}/) || ['{}'])[0])
    if (json.ask !== true || typeof json.text !== 'string') return null
    const t = json.text.trim()
    return t.length === 0 ? null : t.slice(0, 80)
  } catch {
    return null
  }
}
