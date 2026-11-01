/**
 * 新建鱼时的住处：必须有一个屋子，并且总是新建一间房（一条鱼一间房，终身）。
 *
 * housing 形状：
 *   { kind: 'new-session', workspace }   在现有屋子里新建一间房
 *   { kind: 'new-both', path }           新建屋子，并在里面建一间房
 *
 * 不再支持「先不安排」「住进别人的会话」「整屋归她」。
 */
export function normalizeHousing(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('先为它选一个屋子（会为它新建一间房）')
  const kind = String(raw.kind ?? '')
  if (kind === 'new-session') {
    const workspace = String(raw.workspace ?? '').trim()
    if (!workspace) throw new Error('先选一个屋子')
    return { kind, workspace }
  }
  if (kind === 'new-both') {
    const path = String(raw.path ?? '').trim()
    if (!path) throw new Error('新屋子需要一个目录')
    return { kind, path }
  }
  throw new Error('每条鱼都要有自己的房间：请选一个屋子，或新建一个屋子')
}

/** housing → occupancy（总是房间/会话级）。 */
export async function housingToOccupancy(host, raw, opts = {}) {
  const h = normalizeHousing(raw)
  if (h.kind === 'new-session') {
    const s = await host.createSession({ path: h.workspace, title: opts.title })
    return { kind: 'session', id: s.id, workspace: s.workspace || h.workspace }
  }
  // 新建屋子 + 房间：屋子本身不归她，只有这间房归她
  const w = await host.createWorkspace(h.path)
  const s = await host.createSession({ workspaceId: w.registryId, path: w.path, title: opts.title })
  return { kind: 'session', id: s.id, workspace: s.workspace || w.path }
}
