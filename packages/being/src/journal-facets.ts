/**
 * 日记 / 小纸条 / 请求：从 Creature 里拆出来的 facet。
 * Creature 的方法只是薄委托，调用方 API 不变。
 */
import fs from 'node:fs'
import path from 'node:path'
import type { Creature } from './creature.ts'
import type { CreatureEvent } from '../../affect/src/index.ts'
import { uid } from '../../affect/src/index.ts'

export function hasDiary(creature: Creature, date: string): boolean {
  return creature.store.readEvents().some((e) => e.t === 'diary' && e.date === date)
}

export function recordDiary(creature: Creature, date: string, text: string, ts?: number): void {
  const at = ts ?? Date.now()
  creature.store.appendEvent({ t: 'diary', id: uid(), ts: at, date, text } as CreatureEvent)
  writeDiaryFile(creature, date, text, at)
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
  const at = ts ?? Date.now()
  creature.store.appendEvent({ t: 'note', id: uid(), ts: at, text } as CreatureEvent)
  writeNoteFile(creature, text, at)
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

const pad = (n: number) => String(n).padStart(2, '0')

/** 日记：一个人一个文件夹，一天一个文件。 */
export function writeDiaryFile(creature: Creature, date: string, text: string, ts?: number): string {
  const dir = path.join(creature.store.dir, 'diary')
  fs.mkdirSync(dir, { recursive: true })
  const at = ts ?? Date.now()
  const when = new Date(at)
  const head = `${date} ${pad(when.getHours())}:${pad(when.getMinutes())}`
  const body = `# ${head}\n\n${text.trim()}\n`
  // 她自己可能已经手写过同一天的日记：不覆盖，另起一个文件
  let file = path.join(dir, `${date}.md`)
  let n = 1
  while (fs.existsSync(file)) {
    try { if (fs.readFileSync(file, 'utf8') === body) return file } catch { /* 读不了就换名 */ }
    n += 1
    file = path.join(dir, `${date}-${n}.md`)
  }
  fs.writeFileSync(file, body, 'utf8')
  return file
}

/** 小纸条：一个人一个文件夹，一条一个文件。 */
export function writeNoteFile(creature: Creature, text: string, ts?: number): string {
  const dir = path.join(creature.store.dir, 'notes')
  fs.mkdirSync(dir, { recursive: true })
  const at = ts ?? Date.now()
  const d = new Date(at)
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  let file = path.join(dir, `${stamp}.md`)
  let n = 1
  while (fs.existsSync(file)) file = path.join(dir, `${stamp}-${n++}.md`)
  fs.writeFileSync(file, text.trim() + '\n', 'utf8')
  return file
}
