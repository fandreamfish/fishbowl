/** 极简 LLM 调用（评价 / 总结 / 整理共用）。密钥与模型来自 cfg.appraiser，可被 opts.model 覆盖。 */
export async function callLLM(cfg, system, user, opts = {}) {
  const a = cfg.appraiser
  const res = await fetch(`${a.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(a.apiKey ? { Authorization: `Bearer ${a.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: opts.model || a.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: opts.maxTokens ?? 500,
      ...(opts.json !== false ? { response_format: { type: 'json_object' } } : {}),
    }),
    signal: AbortSignal.timeout(45_000),
  })
  if (!res.ok) throw new Error(`http ${res.status}`)
  const data = await res.json()
  return data?.choices?.[0]?.message?.content ?? ''
}
