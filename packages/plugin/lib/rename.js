/**
 * M9：入住时改名。
 *   房子（会话）→ 「<名字>的房间」
 *   屋子（工作区）→ 「<名字> 的屋子」
 *
 * 会话标题服务：ctx.get('sessionTitle').rename(session, title)（只能改活着的会话）
 * 工作区标题：ctx.get('workspaceRegistry').list() → entity.setTitle(title)
 * 改名失败不影响入住本身。
 */

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
function workspaceByPath(registry, path) {
  try {
    const list = typeof registry?.list === 'function' ? registry.list() : []
    const want = normPath(path)
    return list.find((w) => w && normPath(w.path) === want) ?? null
  } catch {
    return null
  }
}

/**
 * 给一个住处改名。
 * @returns {Promise<boolean>} 是否真的改了
 */
export async function renameScope(ctx, occ, name) {
  const title = scopeTitle(name, occ)
  if (!title) return false
  try {
    if (occ.kind === 'session') {
      const sessions = ctx.get?.('sessions')
      const titles = ctx.get?.('sessionTitle')
      const session = sessions && typeof sessions.get === 'function' ? sessions.get(occ.id) : null
      if (session && titles && typeof titles.rename === 'function') {
        titles.rename(session, title)
        return true
      }
      return false
    }
    const registry = ctx.get?.('workspaceRegistry')
    const ws = workspaceByPath(registry, occ.id)
    if (ws && typeof ws.setTitle === 'function') {
      await ws.setTitle(title)
      return true
    }
  } catch {
    /* 改名失败不影响入住 */
  }
  return false
}

/** 静默版本：只发起，不等待，也永不抛。 */
export function renameScopeAsync(ctx, occ, name) {
  try {
    void Promise.resolve(renameScope(ctx, occ, name)).catch(() => {})
  } catch {
    /* 忽略 */
  }
}
