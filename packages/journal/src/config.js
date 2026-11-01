/** 日记配置：当天最后一件事；没写就第二天补。 */
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

export function normalizeDiary(raw) {
  const d = raw || {}
  const hm = (v, dflt) => (HHMM.test(String(v ?? '')) ? String(v) : dflt)
  return { enabled: d.enabled !== false, start: hm(d.start, '21:30'), end: hm(d.end, '23:59'), catchUp: d.catchUp !== false }
}
