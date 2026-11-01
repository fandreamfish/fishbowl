/**
 * 许可（permit）：他点头之后，某件"本来会被挡住"的事才放行。
 *
 * 与 grant 的区别：
 *   grant  = 长期态度（"你没事可以刷刷 B 站"），是事实，不卡操作
 *   permit = 一次性授权（"这条评论可以发"），带范围、次数、期限，用完即止
 *
 * 事件：{ t:'permit', id, ts, ref, action, target, uses, ttlMs }
 */
import type { Creature } from './creature.ts'
import type { CreatureEvent } from '../../affect/src/index.ts'
import { uid } from '../../affect/src/index.ts'

export interface Permit {
  id: string
  action: string
  target: string
  uses: number
  expiresAt: number
  ref: string
  ts: number
}

type PermitEvent = Extract<CreatureEvent, { t: 'permit' }>

function permitsOf(creature: Creature): Permit[] {
  const out: Permit[] = []
  for (const e of creature.store.readEvents()) {
    if (e.t !== 'permit') continue
    const ev = e as PermitEvent
    out.push({
      id: ev.id,
      action: String(ev.action ?? ''),
      target: String(ev.target ?? ''),
      uses: Number(ev.uses ?? 1),
      expiresAt: Number(ev.ts ?? 0) + Number(ev.ttlMs ?? 0),
      ref: String(ev.ref ?? ''),
      ts: Number(ev.ts ?? 0),
    })
  }
  return out
}

/** 已用掉的次数：同一个许可被消费时写一条 permit-used。 */
function usedCount(creature: Creature, permitId: string): number {
  return creature.store.readEvents().filter((e) => e.t === 'permit-used' && e.ref === permitId).length
}

export function recordPermit(
  creature: Creature,
  { action, target = '', uses = 1, ttlMs = 2 * 60 * 60_000, ref = '' }: { action: string; target?: string; uses?: number; ttlMs?: number; ref?: string },
  ts?: number,
): Permit {
  const at = ts ?? Date.now()
  const id = uid()
  creature.store.appendEvent({ t: 'permit', id, ts: at, ref, action, target, uses, ttlMs } as CreatureEvent)
  return { id, action, target, uses, expiresAt: at + ttlMs, ref, ts: at }
}

/** 当前仍然有效的许可（未过期、还有次数）。 */
export function activePermits(creature: Creature, now = Date.now()): Permit[] {
  return permitsOf(creature).filter((p) => p.expiresAt > now && usedCount(creature, p.id) < p.uses)
}

/** 找一张能覆盖这次操作的许可；没有就返回 null。 */
export function findPermit(creature: Creature, action: string, target = '', now = Date.now()): Permit | null {
  const hit = activePermits(creature, now).find(
    (p) => p.action === action && (!p.target || !target || p.target === target),
  )
  return hit ?? null
}

/** 消费一次（写 permit-used）。返回是否成功。 */
export function consumePermit(creature: Creature, permit: Permit, ts?: number): void {
  creature.store.appendEvent({ t: 'permit-used', id: uid(), ts: ts ?? Date.now(), ref: permit.id } as CreatureEvent)
}

/** 状态块里的一行：她现在被允许做什么。 */
export function permitLine(creature: Creature, now = Date.now()): string {
  const list = activePermits(creature, now)
  if (!list.length) return ''
  return list
    .map((p) => {
      const left = p.uses - usedCount(creature, p.id)
      const until = new Date(p.expiresAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      return `${p.action}${p.target ? ' @ ' + p.target : ''}（剩 ${left} 次，到 ${until}）`
    })
    .join('；')
}

/** 没等同意就做了：记一条 breach（审计用，不是拦截）。 */
export function recordBreach(
  creature: Creature,
  { action, target = '', detail = '' }: { action: string; target?: string; detail?: string },
  ts?: number,
): void {
  creature.store.appendEvent({ t: 'breach', id: uid(), ts: ts ?? Date.now(), action, target, detail } as CreatureEvent)
}

/** 最近 N 天的违规（状态块里点出来）。 */
export function recentBreaches(creature: Creature, days = 7, now = Date.now()): { action: string; target: string; detail: string; ts: number }[] {
  const since = now - days * 86_400_000
  return creature.store
    .readEvents()
    .filter((e) => e.t === 'breach' && Number(e.ts) >= since)
    .map((e) => ({ action: String(e.action ?? ''), target: String(e.target ?? ''), detail: String(e.detail ?? ''), ts: Number(e.ts ?? 0) }))
}

/** 状态块里的一行：他不同意的、以及你没等他同意就做了的。 */
export function breachLine(creature: Creature, now = Date.now()): string {
  const list = recentBreaches(creature, 7, now)
  if (!list.length) return ''
  const last = list[list.length - 1]
  return `没等他同意就做过：${last.action}${last.target ? ' @ ' + last.target : ''}（${new Date(last.ts).toLocaleString('zh-CN')}）`
}