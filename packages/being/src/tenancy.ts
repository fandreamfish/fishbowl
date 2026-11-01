/**
 * 住处模型（M7）：一只鱼住在一个工作区，或工作区里的一个会话。
 *
 * 规则：
 *   - 一个工作区只能住一只鱼；住进去后，它的所有会话都被占用（其他鱼进不来）
 *   - 一个会话只能住一只鱼；住进去不影响同工作区的其他会话
 *   - 同一只鱼只有一个住处；换住处 = 先释放再占用
 *   - 工作区用绝对路径标识（DSH 会话头的 cwd），会话用 session id
 *
 * 解析优先级：会话级 > 工作区级。都没有 → 没有鱼（不注入、不记忆）。
 */

/** 住处里的路径比较：大小写/分隔符不敏感（DSH 不同入口给的写法不一致）。 */
export function samePath(a?: string | null, b?: string | null): boolean {
  const n = (v?: string | null) => String(v ?? '').replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase()
  return !!a && !!b && n(a) === n(b)
}

export type Occupancy =
  | { kind: 'workspace'; id: string }
  | { kind: 'session'; id: string; workspace?: string }

export interface OccupantRow {
  creatureId: string
  occupancy: Occupancy
}

/**
 * 新住处是否与已有住处冲突。
 * @returns 冲突的 creatureId，或 null
 */
export function findConflict(target: Occupancy, taken: OccupantRow[]): string | null {
  for (const t of taken) {
    const o = t.occupancy
    if (target.kind === 'workspace') {
      if (o.kind === 'workspace' && samePath(o.id, target.id)) return t.creatureId
      // 想住整个工作区：该工作区下已住着一只鱼（会话级）→ 也冲突
      if (o.kind === 'session' && samePath(o.workspace, target.id)) return t.creatureId
    } else {
      if (o.kind === 'session' && o.id === target.id) return t.creatureId
      if (o.kind === 'workspace' && samePath(o.id, target.workspace)) return t.creatureId
    }
  }
  return null
}

/** 从所有个体里解析这个会话归谁。 */
export function resolveOccupant(
  session: { sessionId: string; workspace?: string },
  creatures: { creatureId: string; occupancy?: Occupancy | null }[],
): { creatureId: string; via: 'session' | 'workspace' } | null {
  for (const c of creatures) {
    if (c.occupancy?.kind === 'session' && c.occupancy.id === session.sessionId) {
      return { creatureId: c.creatureId, via: 'session' }
    }
  }
  if (!session.workspace) return null
  for (const c of creatures) {
    if (c.occupancy?.kind === 'workspace' && samePath(c.occupancy.id, session.workspace)) {
      return { creatureId: c.creatureId, via: 'workspace' }
    }
  }
  return null
}
