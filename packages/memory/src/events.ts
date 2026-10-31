/**
 * 事件（docs/MEMORY.md §1/§2）。只追加，永不改写。
 * 修正历史 = 追加一条新事件，不是回去改。
 */

export type Kind = 'fact' | 'lesson' | 'relation' | 'self'
export type Subject = 'user' | 'self' | 'between' | 'world'
export type Role = 'her' | 'neutral'

export interface Affect4 {
  valence: number
  arousal: number
  guilt: number
  longing: number
}

export interface ScopeRef {
  kind: 'workspace' | 'session'
  id: string
  workspace?: string
}

export interface RawRef {
  /** 消息 id 区间（指向鱼自己的副本） */
  from?: string
  to?: string
  /** 在原文里的字符区间；拆分成多条时各自不同 */
  chars?: [number, number] | null
}

export interface Appraisal {
  goalCongruence: number
  agency: number
  certainty: number
  normViolation: number
  relationalImpact: number
  stake: number
  attribution: 'self' | 'other' | 'circumstance'
}

export interface TurnEvent {
  t: 'turn'
  id: string
  ts: number
  scope?: ScopeRef
  /** 这一轮的完整转录（user/assistant 交替），是评价与总结的原料 */
  note: string
  raw?: RawRef
  appraisal?: Appraisal
  salience?: number
  tags?: string[]
  /** 这一轮上下文里注入过的记忆 id（用于判定「真用到了」） */
  injected?: string[]
  /** none | her | neutral | both —— 「还没想好怎么记」是合法状态 */
  summaryState?: 'none' | 'her' | 'neutral' | 'both'
  affectAtWrite?: Affect4 | null
  affectPeak?: Affect4 | null
}

export interface SummaryEvent {
  t: 'summary'
  id: string
  ts: number
  turnId: string
  role: Role
  text: string
  /** 中性总结的拆分点：每段一条，chars 是原文区间 */
  segments?: { text: string; chars: [number, number] }[]
  tags?: string[]
  affect?: Affect4 | null
  by?: Provenance
}

export interface RevisitEvent {
  t: 'revisit'
  id: string
  ts: number
  turnId: string
  text: string
  affect?: Affect4 | null
}

export interface HitEvent {
  t: 'hit'
  id: string
  ts: number
  /** 哪一轮用到的；工具触发时可能没有 */
  turnId?: string
  /** 被用到/被想起的那条记忆 */
  ref?: string
  use: 'used' | 'considered'
  by?: string
}

export interface Provenance {
  model: string
  prompt: string
  schema?: number
}

export interface MergedEvent {
  t: 'merged'
  id: string
  ts: number
  kind: Kind
  subject: Subject
  claim: string
  attitude?: string | null
  trigger?: string
  action?: string
  tags?: string[]
  evidence: string[]
  confidence?: number
  affectPeak?: Affect4 | null
  affectAtWrite?: Affect4 | null
  by?: Provenance
  sourceBatch?: { from: number; to: number }
  supersedes?: string | null
  status?: 'active' | 'retired'
}

export interface RetireEvent {
  t: 'retire'
  id: string
  ts: number
  ref: string
  reason?: string
}

export interface ReviseEvent {
  t: 'revise'
  id: string
  ts: number
  ref: string
  confidence?: number
  note?: string
}

export interface ConfigEvent {
  t: 'config'
  id: string
  ts: number
  key: string
  from?: unknown
  to?: unknown
}

export interface AttemptEvent {
  t: 'consolidation-attempt'
  id: string
  ts: number
  batch: { from: number; to: number }
  ok: boolean
  by?: Provenance
  produced?: number
  error?: string
}

export type MemoryEvent =
  | TurnEvent | SummaryEvent | RevisitEvent | HitEvent | MergedEvent
  | RetireEvent | ReviseEvent | ConfigEvent | AttemptEvent

/** 各类型记忆的证据门槛（docs/MEMORY.md §3.5）。 */
export const MIN_EVIDENCE: Record<Kind, number> = {
  fact: 2,
  lesson: 1,
  relation: 3,
  self: 2,
}

/** 一条结论最多覆盖多少轮——超了必须拆，否则既不读也不可证伪。 */
export const MAX_EVIDENCE = 12

/** 一轮最多拆成几条。 */
export const MAX_SEGMENTS = 3

export function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x))
}

export function isKind(x: unknown): x is Kind {
  return x === 'fact' || x === 'lesson' || x === 'relation' || x === 'self'
}

export function isSubject(x: unknown): x is Subject {
  return x === 'user' || x === 'self' || x === 'between' || x === 'world'
}

/** 把任意情绪对象收敛成 4 个数（缺的补 0），存进事件前用它。 */
export function toAffect4(a: any): Affect4 | null {
  if (!a || typeof a !== 'object') return null
  const f = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0)
  return { valence: f(a.valence ?? a.v), arousal: f(a.arousal ?? a.a), guilt: f(a.guilt), longing: f(a.longing) }
}
