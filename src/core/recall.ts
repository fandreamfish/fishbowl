/**
 * 回忆匹配（M13）：用户这句话里提到了什么，能对上她记得的哪几件事。
 *
 * 纯函数，不调模型：中文按二字窗口切分，英文/数字按词；命中数越多越相关。
 * 命中为 0 的不返回（宁可不提，也不要瞎联想）。
 */

function tokens(text) {
  const s = String(text ?? '').toLowerCase()
  const out = new Set()
  // 英文/数字词
  for (const m of s.matchAll(/[a-z0-9_]{2,}/g)) out.add(m[0])
  // 中文二元组（跳过标点与空白）
  const cjk = s.replace(/[^\u4e00-\u9fa5]/g, ' ')
  for (const seg of cjk.split(/\s+/)) {
    for (let i = 0; i + 2 <= seg.length; i++) out.add(seg.slice(i, i + 2))
  }
  return out
}

/**
 * @param {{id: string, text: string, kind: string}[]} claims 她记得的事
 * @param {string} text 用户这句话
 * @param {number} limit 最多返回几条
 * @returns {{id: string, text: string, kind: string, score: number}[]}
 */
export function matchClaims(claims, text, limit = 3) {
  const q = tokens(text)
  if (q.size === 0) return []
  const scored = []
  for (const c of claims ?? []) {
    const t = tokens(c.text)
    let hit = 0
    for (const tok of t) if (q.has(tok)) hit += 1
    if (hit > 0) scored.push({ ...c, score: hit })
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit)
}

/**
 * 在一段段原文里找命中的片段（用于翻原始对话，而不只是认知）。
 * @param {{ts: number, text: string}[]} items
 * @param {string} text 用户这句话
 */
export function matchTexts(items, text, limit = 3) {
  const q = tokens(text)
  if (q.size === 0) return []
  const scored = []
  for (const it of items ?? []) {
    const t = tokens(it.text)
    let hit = 0
    for (const tok of t) if (q.has(tok)) hit += 1
    if (hit > 0) scored.push({ ...it, score: hit })
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit)
}