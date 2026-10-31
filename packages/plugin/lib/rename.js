/**
 * M9：入住时改名 / 搬走时改回原名。
 *   房子（会话）→ 「<名字>的房间」
 *   屋子（工作区）→ 「<名字> 的屋子」
 *
 * rc.5 约束：会话标题只能改**活着的那个实例**（sessions.get(id) 同一对象），
 * 否则抛 "not live in this store"——没开着的会话等它被打开时再改。
 *
 * 原名记录：第一次改名之前把原标题记进 creatures/.titles.json，
 * 搬走时用原样恢复（记不到的就不动，绝不猜）。
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

/** 路径归一：统一分隔符、去尾斜杠、小写（Windows 不区分大小写）。 */
function normPath(p) {
  return String(p ?? '').replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase()
}

/** 找到工作区实体（按路径匹配；工作区 id 是内部 id）。 */
function workspaceByPath(registry, p) {
  try {
    const list = typeof registry?.list === 'function' ? registry.list() : []
    const want = normPath(p)
    return list.find((w) => w && normPath(w.path) === want) ?? null
  } catch {
    return null
  }
}

// —— 原名存档 ——

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

/** 读当前标题（读不到返回 null）。 */
function currentTitle(ctx, occ) {
  try {
    if (occ.kind === 'session') {
      const sessions = ctx.get?.('sessions')
      const titles = ctx.get?.('sessionTitle')
      const session = sessions && typeof sessions.get === 'function' ? sessions.get(occ.id) : null
      if (!session || !titles || typeof titles.get !== 'function') return null
      return titles.get(session)?.title ?? null
    }
    const ws = workspaceByPath(ctx.get?.('workspaceRegistry'), occ.id)
    return ws?.title ?? null
  } catch {
    return null
  }
}

/** 改名之前先记下原名（只记一次；记不到就不覆盖旧的记录）。 */
export function captureOriginal(ctx, stateDir, occ) {
  if (!stateDir || !occ) return false
  const map = readTitles(stateDir)
  const key = scopeKey(occ)
  if (map[key] && map[key].title) return true
  const title = currentTitle(ctx, occ)
  if (!title) return false
  map[key] = { title, at: Date.now() }
  writeTitles(stateDir, map)
  return true
}

/** 把住处名字改回原名（没有记录就不动）。 */
export async function restoreOriginal(ctx, stateDir, occ) {
  if (!stateDir || !occ) return { ok: false, why: 'no-record' }
  const map = readTitles(stateDir)
  const key = scopeKey(occ)
  const rec = map[key]
  if (!rec || !rec.title) return { ok: false, why: 'no-record' }
  try {
    if (occ.kind === 'session') {
      const sessions = ctx.get?.('sessions')
      const titles = ctx.get?.('sessionTitle')
      const session = sessions && typeof sessions.get === 'function' ? sessions.get(occ.id) : null
      if (!session) return { ok: false, why: 'session-not-live' }
      if (!titles || typeof titles.rename !== 'function') return { ok: false, why: 'no-sessionTitle-service' }
      titles.rename(session, rec.title)
    } else {
      const ws = workspaceByPath(ctx.get?.('workspaceRegistry'), occ.id)
      if (!ws) return { ok: false, why: 'workspace-not-found' }
      await ws.setTitle(rec.title)
    }
    delete map[key]
    writeTitles(stateDir, map)
    return { ok: true }
  } catch (e) {
    return { ok: false, why: String((e && e.message) || e) }
  }
}

/** 把结果记进 trace。 */
function logResult(ctx, occ, title, ok, why) {
  try {
    const dir = ctx.__fishbowlStateDir
    if (!dir) return
    fs.appendFileSync(path.join(dir, 'trace.ndjson'), JSON.stringify({
      ts: Date.now(), event: 'rename', occ: `${occ.kind}:${occ.id}`, title, ok, why: why ?? null,
    }) + '\n')
  } catch { /* 忽略 */ }
}

/**
 * 给一个住处改名（先记原名）。
 * @returns {Promise<{ok: boolean, why?: string}>}
 */
export async function renameScope(ctx, occ, name) {
  const title = scopeTitle(name, occ)
  if (!title) return { ok: false, why: 'no-title' }
  try {
    if (occ.kind === 'session') {
      const sessions = ctx.get?.('sessions')
      const titles = ctx.get?.('sessionTitle')
      if (!sessions || typeof sessions.get !== 'function') return { ok: false, why: 'no-sessions-service' }
      if (!titles || typeof titles.rename !== 'function') return { ok: false, why: 'no-sessionTitle-service' }
      const session = sessions.get(occ.id)
      if (!session) return { ok: false, why: 'session-not-live' }
      captureOriginal(ctx, ctx.__fishbowlStateDir, occ)
      titles.rename(session, title)
      logResult(ctx, occ, title, true)
      return { ok: true }
    }
    const registry = ctx.get?.('workspaceRegistry')
    if (!registry) return { ok: false, why: 'no-workspaceRegistry' }
    const ws = workspaceByPath(registry, occ.id)
    if (!ws) return { ok: false, why: 'workspace-not-found' }
    captureOriginal(ctx, ctx.__fishbowlStateDir, occ)
    await ws.setTitle(title)
    logResult(ctx, occ, title, true)
    return { ok: true }
  } catch (e) {
    const why = String((e && e.message) || e)
    logResult(ctx, occ, title, false, why)
    return { ok: false, why }
  }
}

/** 静默版本：只发起，不等待，也永不抛。 */
export function renameScopeAsync(ctx, occ, name) {
  try {
    void Promise.resolve(renameScope(ctx, occ, name)).catch(() => {})
  } catch {
    /* 忽略 */
  }
}

/** 静默恢复原名。 */
export function restoreOriginalAsync(ctx, stateDir, occ) {
  try {
    void Promise.resolve(restoreOriginal(ctx, stateDir, occ)).catch(() => {})
  } catch {
    /* 忽略 */
  }
}
