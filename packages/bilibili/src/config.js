/** 在 B 站说话的配置：默认关，所有写操作都要它显式打开。 */
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

export function normalizeComment(raw) {
  const c = raw || {}
  return {
    enabled: c.enabled === true,
    // 在 B 站说话前必须先拿到许可（默认关）：没有许可时工具直接拒绝
    requirePermit: c.requirePermit === true,
    perDay: Number.isFinite(Number(c.perDay)) ? Math.max(0, Math.min(5, Math.round(Number(c.perDay)))) : 1,
    replyPerDay: Number.isFinite(Number(c.replyPerDay)) ? Math.max(0, Math.min(10, Math.round(Number(c.replyPerDay)))) : 2,
    replyToReplies: c.replyToReplies !== false,
    scanEveryMin: Number.isFinite(Number(c.scanEveryMin)) ? Math.max(5, Math.min(720, Math.round(Number(c.scanEveryMin)))) : 30,
    window: Array.isArray(c.window) && c.window.length === 2 && c.window.every((x) => HHMM.test(String(x)))
      ? [String(c.window[0]), String(c.window[1])]
      : ['20:00', '23:00'],
    atOwner: c.atOwner !== false,
  }
}

/** 只接受认识的「在 B 站说话」配置键。 */
export function pickCommentConfig(x) {
  if (!x || typeof x !== 'object') return undefined
  const out = {}
  if (typeof x.enabled === 'boolean') out.enabled = x.enabled
  if (typeof x.requirePermit === 'boolean') out.requirePermit = x.requirePermit
  if (Number.isFinite(Number(x.perDay))) out.perDay = Math.min(5, Math.max(0, Math.round(Number(x.perDay))))
  if (Number.isFinite(Number(x.replyPerDay))) out.replyPerDay = Math.min(10, Math.max(0, Math.round(Number(x.replyPerDay))))
  if (typeof x.replyToReplies === 'boolean') out.replyToReplies = x.replyToReplies
  if (Number.isFinite(Number(x.scanEveryMin))) out.scanEveryMin = Math.min(720, Math.max(5, Math.round(Number(x.scanEveryMin))))
  if (typeof x.atOwner === 'boolean') out.atOwner = x.atOwner
  if (Array.isArray(x.window) && x.window.length === 2 && x.window.every((t) => HHMM.test(String(t)))) {
    out.window = [String(x.window[0]), String(x.window[1])]
  }
  return out
}
