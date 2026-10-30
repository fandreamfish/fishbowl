/** 身份：起名检测（关键词预筛 + LLM 提取）。 */
export const IDENTITY_RE = /(?:你(?:就)?叫|给你起(?:个)?名|你的名字|叫你)/

export const IDENTITY_SYSTEM_PROMPT = [
  '判断这段对话里用户是否给 AI 起了名字。只输出 JSON：{"named": true/false, "name": "名字"}。',
  '没有起名就输出 {"named": false}。name 只取用户明确给出的那个称呼，不要猜。',
  '不要输出 JSON 以外的任何内容。',
].join('\n')

/** 防御性解析。 */
export function parseIdentity(text) {
  try {
    const json = JSON.parse((text.match(/\{[\s\S]*\}/) || ['{}'])[0])
    if (json.named !== true || typeof json.name !== 'string') return null
    const name = json.name.trim().slice(0, 20)
    return name.length > 0 ? name : null
  } catch {
    return null
  }
}
