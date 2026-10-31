/**
 * M9：入住时改名。
 *   房子（会话）→ 「<名字>的房间」
 *   屋子（工作区）→ 「<名字> 的屋子」
 *
 * 会话标题服务：ctx.get('sessionTitle').rename(session, title)
 *   —— rc.5 要求 session 必须是**活着的那个实例**（sessions.get(id) 的同一个对象），
 *      否则抛 "not live in this store"。所以没开着的会话只能等它被打开时再改。
 * 工作区标题：ctx.get('workspaceRegistry').list() → entity.setTitle(title)
 *
 * 改名失败不影响入住本身；结果写进 trace 便于排查。
 */
import fs from 'node:fs'
import path from 'node:path'

/** 住处 → 标题文本（纯函数，可测）。 */
export function scopeTitle(name, occ) {
  if (!occ) return ''
  return occ.kind === 'session' ? `${name}的房间` : `${name} 的屋子`
}

/** 路径归一：统一分隔符、去尾斜杠、小写（Windows 不区分大小写）。 */
function normPath(p) {
  return String(p ?? '').replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase()
}

/** 找到工作区实体（按路径匹配；工作区 id 是内部 id）。 */
function workspaceByPath(registry, path2) {
  try {
    const list = typeof registry?.list === 'function' ? registry.list() : []
    const want = normPath(path2)
    return list.find((w) => w && normPath(w.path) === want) ?? null
  } catch {
    return null
  }
}

/** 把结果记进 trace（失败也无所谓）。 */
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
 * 给一个住处改名。
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
      titles.rename(session, title)
      logResult(ctx, occ, title, true)
      return { ok: true }
    }
    const registry = ctx.get?.('workspaceRegistry')
    if (!registry) return { ok: false, why: 'no-workspaceRegistry' }
    const ws = workspaceByPath(registry, occ.id)
    if (!ws) return { ok: false, why: 'workspace-not-found' }
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
