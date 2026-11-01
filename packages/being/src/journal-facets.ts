/**
 * 日记 / 小纸条 / 请求：从 Creature 里拆出来的 facet。
 * Creature 的方法只是薄委托，调用方 API 不变。
 */
import type { Creature } from './creature.ts'
import type { CreatureEvent } from '../../affect/src/index.ts'
import { uid } from '../../affect/src/index.ts'

export function hasDiary(creature: Creature, date: string): boolean {
  return creature.store.readEvents().some((e) => e.t === 'diary' && e.date === date)
}

export function recordDiary(creature: Creature, date: string, text: string, ts?: number): void {
  creature.store.appendEvent({ t: 'diary', id: uid(), ts: ts ?? Date.now(), date, text } as CreatureEvent)
}

export function diaries(creature: Creature, limit = 14): { date: string; text: string; ts: number }[] {
  return creature.store
    .readEvents()
    .filter((e): e is Extract<CreatureEvent, { t: 'diary' }> => e.t === 'diary')
    .slice(-limit)
    .map((e) => ({ date: e.date, text: e.text, ts: e.ts }))
    .reverse()
}

export function recordNote(creature: Creature, text: string, ts?: number): void {
  creature.store.appendEvent({ t: 'note', id: uid(), ts: ts ?? Date.now(), text } as CreatureEvent)
}

export function notes(creature: Creature, limit = 10): { text: string; ts: number }[] {
  return creature.store
    .readEvents()
    .filter((e): e is Extract<CreatureEvent, { t: 'note' }> => e.t === 'note')
    .slice(-limit)
    .map((e) => ({ text: e.text, ts: e.ts }))
    .reverse()
}

export function recordRequest(creature: Creature, text: string, ts?: number): void {
  creature.store.appendEvent({ t: 'request', id: uid(), ts: ts ?? Date.now(), text } as CreatureEvent)
}

export function answerRequest(creature: Creature, ref: string, answer: 'yes' | 'no', ts?: number): void {
  creature.store.appendEvent({ t: 'request-answered', id: uid(), ts: ts ?? Date.now(), ref, answer } as CreatureEvent)
}

export function requests(creature: Creature): { id: string; text: string; ts: number; answer: 'yes' | 'no' | null }[] {
  const events = creature.store.readEvents()
  const answers = new Map<string, 'yes' | 'no'>()
  for (const e of events) if (e.t === 'request-answered') answers.set(e.ref, e.answer)
  return events
    .filter((e): e is Extract<CreatureEvent, { t: 'request' }> => e.t === 'request')
    .map((e) => ({ id: e.id, text: e.text, ts: e.ts, answer: answers.get(e.id) ?? null }))
}

export function requestCountSince(creature: Creature, since: number): number {
  return creature.store.readEvents().filter((e) => e.t === 'request' && e.ts >= since).length
}

export function pendingRequests(creature: Creature): { id: string; text: string; ts: number }[] {
  return requests(creature).filter((r) => r.answer === null).map(({ id, text, ts }) => ({ id, text, ts }))
}

export function requestDigest(creature: Creature, now = Date.now()): { pending: string[]; answered: { text: string; answer: 'yes' | 'no' }[] } {
  const events = creature.store.readEvents()
  const answeredAt = new Map<string, number>()
  for (const e of events) if (e.t === 'request-answered') answeredAt.set(e.ref, e.ts)
  const list = requests(creature)
  const pending = list.filter((r) => r.answer === null).slice(-3).map((r) => r.text)
  const answered = list
    .filter((r) => r.answer !== null && now - (answeredAt.get(r.id) ?? 0) < 86_400_000)
    .slice(-2)
    .map((r) => ({ text: r.text, answer: r.answer as 'yes' | 'no' }))
  return { pending, answered }
}
