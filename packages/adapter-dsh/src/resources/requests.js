/** 轻量：只取所有鱼待答的结构化请求，给右下角提醒轮询用。 */
export async function handleRequests({ binding, send }, req, res) {
  if (req.method !== 'GET') return false
  const out = []
  try {
    for (const c of binding.listCreatures()) {
      for (const r of c.pendingRequests()) {
        if (!r.action) continue
        out.push({ fishId: c.meta.creatureId, name: c.meta.name, request: r })
      }
    }
  } catch { /* 单条读不出来就跳过 */ }
  send(res, { ok: true, requests: out })
  return true
}
