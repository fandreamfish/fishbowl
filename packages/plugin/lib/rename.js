/**
 * M9：入住时改名 / 搬走时改回原名（宿主无关部分）。
 *   房子（会话）→ 「<名字>的房间」
 *   屋子（工作区）→ 「<名字> 的屋子」
 *
 * 真正的改名交给 host.nameScope()（DSH 适配器里才碰 sessionTitle / workspaceRegistry）。
 * 原名记录：第一次改名之前把原标题记进 creatures/.titles.json，搬走时原样恢复；
 * 记不到的就不动，绝不猜。
 */
import fs from 'node:fs'
import path from 'node:path'

/** 住处 → 标题文本（纯函数，可测）。 */
export function scopeTitle(name, occ) {
  if (!occ) return ''
  return occ.kind === 'session' ? `${name}的房间` : `${name} 的屋子`
}

/** 住处的键（存档用）。 */
export function scopeKey(occ) {
  return `${occ.kind}:${occ.id}`
}

function titlesPath(stateDir) {
  return path.join(stateDir, '.titles.json')
}

function readTitles(stateDir) {
  try {
    return JSON.parse(fs.readFileSync(titlesPath(stateDir), 'utf8')) || {}
  } catch {
    return {}
  }
}

function writeTitles(stateDir, map) {
  try {
    fs.mkdirSync(stateDir, { recursive: true })
    fs.writeFileSync(titlesPath(stateDir), JSON.stringify(map, null, 2))
  } catch { /* 记不下来不影响流程 */ }
}

function logResult(stateDir, occ, title, ok, why) {
  try {
    if (!stateDir) return
    fs.appendFileSync(path.join(stateDir, 'trace.ndjson'), JSON.stringify({
      ts: Date.now(), event: 'rename', occ: scopeKey(occ), title, ok, why: why ?? null,
    }) + '\n')
  } catch { /* 忽略 */ }
}

/** 改名之前先记下原名（只记一次；读不到就不写）。 */
export function captureOriginal(host, stateDir, occ) {
  if (!stateDir || !occ || !host) return false
  const map = readTitles(stateDir)
  const key = scopeKey(occ)
  if (map[key] && map[key].title) return true
  const title = host.titleOf?.(occ) ?? null
  if (!title) return false
  map[key] = { title, at: Date.now() }
  writeTitles(stateDir, map)
  return true
}

/** 把住处名字改回原名（没有记录就不动）。 */
export async function restoreOriginal(host, stateDir, occ) {
  if (!stateDir || !occ || !host) return { ok: false, why: 'no-record' }
  const map = readTitles(stateDir)
  const key = scopeKey(occ)
  const rec = map[key]
  if (!rec || !rec.title) return { ok: false, why: 'no-record' }
  const res = await host.nameScope(occ, rec.title)
  if (res?.ok) {
    delete map[key]
    writeTitles(stateDir, map)
    logResult(stateDir, occ, rec.title, true)
  } else {
    logResult(stateDir, occ, rec.title, false, res?.why)
  }
  return res
}

/**
 * 给一个住处改名（先记原名）。
 * @returns {Promise<{ok: boolean, why?: string}>}
 */
export async function renameScope(host, stateDir, occ, name) {
  const title = scopeTitle(name, occ)
  if (!title || !host) return { ok: false, why: 'no-title' }
  captureOriginal(host, stateDir, occ)
  const res = await host.nameScope(occ, title)
  logResult(stateDir, occ, title, !!res?.ok, res?.why)
  return res
}

/** 静默版本：只发起，不等待，也永不抛。 */
export function renameScopeAsync(host, stateDir, occ, name) {
  try {
    void Promise.resolve(renameScope(host, stateDir, occ, name)).catch(() => {})
  } catch { /* 忽略 */ }
}

/** 静默恢复原名。 */
export function restoreOriginalAsync(host, stateDir, occ) {
  try {
    void Promise.resolve(restoreOriginal(host, stateDir, occ)).catch(() => {})
  } catch { /* 忽略 */ }
}
