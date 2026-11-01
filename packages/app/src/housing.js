/**
 * 新建鱼时的住处选择：可以是现有住处，也可以顺手建一个新的。
 *
 * housing 形状：
 *   { kind: 'none' }
 *   { kind: 'existing', type: 'workspace' | 'session', id, workspace? }
 *   { kind: 'new-workspace', path }        整个工作区归这条鱼
 *   { kind: 'new-session', workspace }     在工作区里新建一个会话，只有这个会话归她
 *   { kind: 'new-both', path }             新建工作区 + 里面一个会话，只有会话归她
 */
export function normalizeHousing(raw) {
  if (!raw || typeof raw !== 'object') return { kind: 'none' }
  const kind = String(raw.kind ?? 'none')
  if (kind === 'none') return { kind: 'none' }
  if (kind === 'existing') {
    const type = raw.type === 'workspace' ? 'workspace' : 'session'
    const id = String(raw.id ?? '').trim()
    if (!id) throw new Error('先选一个住处')
    return { kind, type, id, workspace: raw.workspace ? String(raw.workspace) : undefined }
  }
  if (kind === 'new-workspace' || kind === 'new-both') {
    const p = String(raw.path ?? '').trim()
    if (!p) throw new Error('新工作区需要一个目录')
    return { kind, path: p }
  }
  if (kind === 'new-session') {
    const workspace = String(raw.workspace ?? '').trim()
    if (!workspace) throw new Error('新会话需要先选一个工作区')
    return { kind, workspace }
  }
  throw new Error('不认识的住处类型：' + kind)
}

/** housing → occupancy（必要时通过 host 真的建工作区/会话）。 */
export async function housingToOccupancy(host, raw, opts = {}) {
  const h = normalizeHousing(raw)
  if (h.kind === 'none') return null
  if (h.kind === 'existing') {
    return h.type === 'workspace'
      ? { kind: 'workspace', id: h.id }
      : { kind: 'session', id: h.id, workspace: h.workspace }
  }
  if (h.kind === 'new-workspace') {
    // 整个工作区归她：住处的 id 用路径（匹配会话的 workspace 路径）
    const w = await host.createWorkspace(h.path)
    return { kind: 'workspace', id: w.path }
  }
  if (h.kind === 'new-session') {
    const s = await host.createSession({ path: h.workspace, title: opts.title })
    return { kind: 'session', id: s.id, workspace: s.workspace || h.workspace }
  }
  // new-both：先建工作区，再在里面建一个会话，鱼住在会话里（工作区里的其它会话不归她）
  const w = await host.createWorkspace(h.path)
  const s = await host.createSession({ workspaceId: w.registryId, path: w.path, title: opts.title })
  return { kind: 'session', id: s.id, workspace: s.workspace || w.path }
}
