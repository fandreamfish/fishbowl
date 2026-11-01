/**
 * 住处模型：一条鱼住一间房（一个会话），终身唯一。
 *
 * 规则：
 *   - 鱼只能通过「新建房间」获得住处，不能继承别人的会话
 *   - 一间房只能住一条鱼
 *   - 屋子（工作区）本身不归任何鱼；一个屋子可以住多条鱼（各有各的房间）
 *   - 搬家 = 归档旧房间 + 在新屋子建一间新房（由调用方执行）
 *
 * 旧的「整屋级住处」只保留读取兼容（数据里万一还有），不再允许创建。
 */

export type Occupancy =
  | { kind: 'session'; id: string; workspace?: string }
  /** @deprecated 只读兼容：旧数据里的整屋住处 */
  | { kind: 'workspace'; id: string }

export interface OccupantRow {
  creatureId: string
  occupancy: Occupancy
}

/** 住处里的路径比较：大小写/分隔符不敏感（DSH 不同入口给的写法不一致）。 */
export function samePath(a?: string | null, b?: string | null): boolean {
  const n = (v?: string | null) => String(v ?? '').replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase()
  return !!a && !!b && n(a) === n(b)
}

/**
 * 新房间是否与已有住处冲突。
 * @returns 冲突的 creatureId，或 null
 */
export function findConflict(target: Occupancy, taken: OccupantRow[]): string | null {
  for (const t of taken) {
    const o = t.occupancy
    if (target.kind === 'session') {
      if (o.kind === 'session' && o.id === target.id) return t.creatureId
      // 兼容：旧的整屋住户会拦住这个屋子里的所有房间
      if (o.kind === 'workspace' && samePath(o.id, target.workspace)) return t.creatureId
    } else {
      // 只读兼容路径：不再有新代码创建整屋住处
      if (o.kind === 'workspace' && samePath(o.id, target.id)) return t.creatureId
      if (o.kind === 'session' && samePath(o.workspace, target.id)) return t.creatureId
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
