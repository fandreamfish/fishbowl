/** 极简 DeepSeek chat 客户端。密钥只从环境变量读，绝不落盘。 */
const BASE = 'https://api.deepseek.com'

/** @typedef {{ role: 'system'|'user'|'assistant', content: string }} ChatMessage */

/**
 * @param {ChatMessage[]} messages
 * @param {{ json?: boolean, maxTokens?: number, temperature?: number }} [opts]
 * @returns {Promise<string>}
 */
export async function chat(messages, opts = {}) {
  const key = process.env.DEEPSEEK_API_KEY
  if (!key) throw new Error('missing DEEPSEEK_API_KEY')
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages,
      max_tokens: opts.maxTokens ?? 1000,
      temperature: opts.temperature ?? 0.7,
      ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
    }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) throw new Error(`http ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = await res.json()
  return data?.choices?.[0]?.message?.content ?? ''
}
