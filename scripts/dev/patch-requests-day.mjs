import fs from 'node:fs'

// 1) pendingRequests 带上 action/target
{
  const p = 'packages/being/src/journal-facets.ts'
  let t = fs.readFileSync(p, 'utf8')
  t = t.replace(
    "export function pendingRequests(creature: Creature): { id: string; text: string; ts: number }[] {\n  return requests(creature).filter((r) => r.answer === null).map(({ id, text, ts }) => ({ id, text, ts }))\n}",
    "export function pendingRequests(creature: Creature): { id: string; text: string; ts: number; action?: string; target?: string }[] {\n  return requests(creature)\n    .filter((r) => r.answer === null)\n    .map(({ id, text, ts, action, target }) => ({ id, text, ts, ...(action ? { action } : {}), ...(target ? { target } : {}) }))\n}")
  fs.writeFileSync(p, t)
  console.log('facets', t.includes('action?: string'))
}

// 2) 只展示结构化请求
{
  const p = 'packages/adapter-dsh/src/views.js'
  let t = fs.readFileSync(p, 'utf8')
  t = t.replace("      pendingRequests: c.pendingRequests(),", "      pendingRequests: c.pendingRequests().filter((r) => r.action),")
  t = t.replace("      requests: c.requests().slice(-10).reverse(),", "      requests: c.requests().filter((r) => r.action).slice(-10).reverse(),")
  fs.writeFileSync(p, t)
  console.log('views', t.includes('filter((r) => r.action)'))
}

// 3) 看 B 站的许可按"今天"算
{
  const p = 'packages/plugin/lib/browse/permission-tool.js'
  let t = fs.readFileSync(p, 'utf8')
  t = t.replace(
    "const ACTIONS = {\n  'comment.post': { label: '在 B 站说一句话', uses: 1, ttlMs: 2 * 60 * 60_000, gate: 'comment' },\n  'browse': { label: '看一次 B 站', uses: 1, ttlMs: 2 * 60 * 60_000, gate: 'browse' },\n}",
    "const ACTIONS = {\n  'comment.post': { label: '在 B 站说一句话', uses: 1, ttlMs: 2 * 60 * 60_000, gate: 'comment' },\n  // 看 B 站的许可按「今天」算：今天有效，第二天作废\n  'browse': { label: '今天可以刷 B 站', uses: 20, ttlMs: 0, gate: 'browse', untilDayEnd: true },\n}\n\n/** 距离本地当天结束还有多久（毫秒）。 */\nfunction msUntilDayEnd(now, tz) {\n  try {\n    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })\n    const parts = Object.fromEntries(fmt.formatToParts(new Date(now)).map((p) => [p.type, p.value]))\n    const h = Number(parts.hour) % 24\n    const m = Number(parts.minute)\n    const s = Number(parts.second)\n    return Math.max(60_000, ((24 * 3600) - (h * 3600 + m * 60 + s)) * 1000)\n  } catch { return 12 * 60 * 60_000 }\n}")
  t = t.replace("        const text = `申请：${spec.label}${target ? '（' + target + '）' : ''}，${spec.uses} 次，${Math.round(spec.ttlMs / 60_000)} 分钟内有效`\n          + (reason ? `\\n理由：${reason}` : '')\n        creature.recordRequest(text, undefined, { action: args.action, target, uses: spec.uses, ttlMs: spec.ttlMs })",
    "        const ttlMs = spec.untilDayEnd ? msUntilDayEnd(Date.now(), cfg.timezone) : spec.ttlMs\n        const span = spec.untilDayEnd ? '今天有效（到当天结束）' : `${Math.round(ttlMs / 60_000)} 分钟内有效`\n        const text = `申请：${spec.label}${target ? '（' + target + '）' : ''}，${span}`\n          + (reason ? `\\n理由：${reason}` : '')\n        creature.recordRequest(text, undefined, { action: args.action, target, uses: spec.uses, ttlMs })")
  fs.writeFileSync(p, t)
  console.log('permission', t.includes('msUntilDayEnd'))
}
