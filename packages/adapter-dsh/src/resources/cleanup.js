/**
 * 清理：把工作区里「没有鱼住」的会话删掉（目录 + 工作区登记）。
 * 不传 path = 清理所有工作区；默认 dryRun，确认后才真删。
 */
export async function handleCleanup({ binding, host, views, send, readBody }, req, res, parts) {
  if (!(parts[0] === 'cleanup' && parts[1] === 'rooms' && req.method === 'POST')) return false
  const body = JSON.parse(await readBody(req) || '{}')
  const only = String(body.path ?? '').trim()
  const scopes = views.allScopes()
  const paths = only ? [only] : scopes.workspaces.map(String)

  const plans = []
  for (const wsPath of paths) {
    const ws = host.workspaceByPath?.(wsPath)
    if (!ws) continue
    const inWs = scopes.sessions.filter((s) => String(s.workspace ?? '') === String(wsPath))
    const kept = []
    const candidates = []
    for (const s of inWs) {
      const owner = binding.resolve({ sessionId: s.id, workspace: wsPath })
      if (owner) kept.push({ id: s.id, title: s.title || '', owner: owner.meta.name })
      else candidates.push({ id: s.id, title: s.title || '', dirs: host.sessionDirsOf?.(s.id) ?? [] })
    }
    plans.push({ path: wsPath, ws, kept, candidates })
  }

  if (body.dryRun !== false) {
    send(res, {
      ok: true,
      dryRun: true,
      rooms: plans.map((p) => ({ path: p.path, kept: p.kept, candidates: p.candidates })),
    })
    return true
  }

  const rooms = []
  for (const p of plans) {
    const removed = []
    const failed = []
    for (const c of p.candidates) {
      // 默认归档（侧边栏隐藏、文件保留）；只有明确 purge 才删文件
      const archived = await host.archiveSession?.(p.ws, c.id)
      const files = body.purge === true ? (host.deleteSessionFiles?.(c.id) ?? 0) : 0
      if (archived || files > 0) removed.push({ id: c.id, archived: !!archived, dirs: files })
      else failed.push({ id: c.id, error: '归档失败（文件未动）' })
    }
    rooms.push({ path: p.path, kept: p.kept, removed, failed })
  }
  send(res, { ok: true, dryRun: false, rooms })
  return true
}