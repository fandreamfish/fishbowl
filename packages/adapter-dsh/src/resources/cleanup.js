/**
 * 清理：把某个工作区里「没有鱼住」的会话删掉（目录 + 工作区登记）。
 * 默认 dryRun，确认后才真删。
 */
export async function handleCleanup({ binding, host, views, send, readBody }, req, res, parts) {
  if (!(parts[0] === 'cleanup' && parts[1] === 'rooms' && req.method === 'POST')) return false
  const body = JSON.parse(await readBody(req) || '{}')
  const wsPath = String(body.path ?? '').trim()
  if (!wsPath) { send(res, { ok: false, error: '需要工作区路径' }, 400); return true }

  const ws = host.workspaceByPath?.(wsPath)
  if (!ws) { send(res, { ok: false, error: '找不到这个工作区' }, 400); return true }

  const scopes = views.allScopes()
  const inWs = scopes.sessions.filter((s) => String(s.workspace ?? '') === String(wsPath))
  const kept = []
  const candidates = []
  for (const s of inWs) {
    const owner = binding.resolve({ sessionId: s.id, workspace: wsPath })
    if (owner) kept.push({ id: s.id, title: s.title || '', owner: owner.meta.name })
    else candidates.push({ id: s.id, title: s.title || '', dirs: host.sessionDirsOf?.(s.id) ?? [] })
  }

  if (body.dryRun !== false) {
    send(res, { ok: true, dryRun: true, path: wsPath, kept, candidates })
    return true
  }

  const removed = []
  const failed = []
  for (const c of candidates) {
    const detached = await host.detachSession?.(ws, c.id)
    const files = host.deleteSessionFiles?.(c.id) ?? 0
    if (files > 0 || detached) removed.push({ id: c.id, dirs: files })
    else failed.push({ id: c.id, error: '没删到文件也没摘掉登记' })
  }
  send(res, { ok: true, dryRun: false, path: wsPath, kept, removed, failed })
  return true
}
