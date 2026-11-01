/**
 * 新建鱼时的住处选择：可以是现有住处，也可以顺手建一个新的。
 *
 * housing 形状：
 *   { kind: 'none' }
 *   { kind: 'existing', type: 'workspace' | 'session', id, workspace? }
 *   { kind: 'new-workspace', path }
 *   { kind: 'new-session', path }
 *   { kind: 'new-both', path }
 */
export function normalizeHousing(raw) {
  if (!raw || typeof raw !== 'object') return { kind: 'none' }
  const kind = String(raw.kind ?? 'none')
  if (kind === 'none') return { kind: 'none' }
  if (kind === 'existing') {
    const type = raw.type === 'workspace' ? 'workspace' : 'session'
    const id = String(raw.id ?? '')
    if (!id) throw new Error('先选一个住处')
    return { kind, type, id, workspace: raw.workspace ? String(raw.workspace) : undefined }
  }
  if (kind === 'new-workspace' || kind === 'new-both') {
    const p = String(raw.path ?? '').trim()
    if (!p) throw new Error('新工作区需要一个目录')
    return { kind, path: p }
  }
  if (kind === 'new-session') {
    const p = String(raw.path ?? '').trim()
    if (!p) throw new Error('新会话需要一个目录')
    return { kind, path: p }
  }
  throw new Error('不认识的住处类型：' + kind)
}

/** housing → occupancy（必要时通过 host 真的建工作区/会话）。 */
export async function housingToOccupancy(host, raw) {
  const h = normalizeHousing(raw)
  if (h.kind === 'none') return null
  if (h.kind === 'existing') {
    return h.type === 'workspace'
      ? { kind: 'workspace', id: h.id }
      : { kind: 'session', id: h.id, workspace: h.workspace }
  }
  if (h.kind === 'new-workspace') {
    const w = await host.createWorkspace(h.path)
    return { kind: 'workspace', id: w.id }
  }
  if (h.kind === 'new-session') {
    const s = await host.createSession({ path: h.path })
    return { kind: 'session', id: s.id, workspace: s.workspace || h.path }
  }
  // new-both：先建工作区，再在里面建一个会话，鱼住在会话里
  const w = await host.createWorkspace(h.path)
  const s = await host.createSession({ workspaceId: w.id })
  return { kind: 'session', id: s.id, workspace: s.workspace || w.path }
}
