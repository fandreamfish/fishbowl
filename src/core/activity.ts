/**
 * M3.2：共享活动——一起看视频/剧、一起读书、一起学习。
 * 活动的价值不在"记录"，而在注入里持续存在：她记得你们正在一起做的事。
 */

/** 预筛：出现"一起看/读/学"类措辞才值得一次 LLM 调用。 */
export const ACTIVITY_RE = /一起(?:看|读|学|追|听)|我们在(?:看|读|学|追|听)|陪(?:你|我)(?:看|读|学)/

export const ACTIVITY_SYSTEM_PROMPT = [
  '判断这段对话里，用户和 AI 是否开始或结束了一起做某件事（一起看视频/剧/直播、一起读书、一起学习）。',
  '只输出 JSON：{"changed": true/false, "title": "活动内容", "status": "started"/"ended"}。',
  '没有变化就 {"changed": false}。title 简短，≤30 字。',
  '不要输出 JSON 以外的任何内容。',
].join('\n')

/** @returns {{title: string, status: 'started'|'ended'}|null} */
export function parseActivity(text) {
  try {
    const json = JSON.parse((text.match(/\{[\s\S]*\}/) || ['{}'])[0])
    if (json.changed !== true || typeof json.title !== 'string') return null
    const status = json.status === 'ended' ? 'ended' : 'started'
    const title = json.title.trim().slice(0, 30)
    return title.length > 0 ? { title, status } : null
  } catch {
    return null
  }
}

/**
 * 积压合并：攒了超过 3 条时，不刷屏——合成一条。
 * @param {{id: string, text: string}[]} pending 按时间升序
 * @returns {{ ids: string[], text: string }}
 */
export function mergePendingText(pending) {
  if (pending.length <= 3) return { ids: pending.map(p => p.id), text: null }
  const latest = pending[pending.length - 1]
  return {
    ids: pending.map(p => p.id),
    text: `${latest.text}（还有 ${pending.length - 1} 条是前阵子攒的，都补给你了）`,
  }
}
