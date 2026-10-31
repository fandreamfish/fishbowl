/**
 * 从事件流还原出「记录」与「记忆」。
 * 纯函数：同一份事件永远得到同一份结果，没有隐藏状态。
 */
import { MIN_EVIDENCE, MAX_EVIDENCE, isKind } from './events.ts'

export interface TurnRecord {
  id: string
  index: number          // 第几轮（从 1 开始，用于水位线）
  ts: number
  scope: any
  note: string
  raw: any
  appraisal: any
  salience: number
  tags: string[]
  /** 这一轮上下文里注入过的记忆 id */
  injected: string[]
  neutral: string
  segments: { text: string; chars: [number, number] }[]
  her: { at: number; text: string; affect: any }[]
  summaryState: 'none' | 'her' | 'neutral' | 'both'
  affectAtWrite: any
  affectPeak: any
  hits: { considered: number; used: number }
  mergedInto: string[]
}

export interface MemoryRecord {
  id: string
  kind: string
  subject: string
  claim: string
  attitude: string | null
  trigger?: string
  action?: string
  tags: string[]
  evidence: string[]
  evidenceStats: { turns: number; sessions: number; days: number; firstAt: number | null; lastAt: number | null }
  confidence: number
  reinforcements: number
  status: 'active' | 'retired'
  retireReason?: string
  createdAt: number
  firstAt: number | null
  lastAt: number | null
  lastTouchedAt: number
  affectPeak: any
  affectAtWrite: any
  by: any
  sourceBatch: any
  supersedes: string | null
  supersededBy: string | null
  counterexamples: string[]
}

export interface LedgerView {
  turns: TurnRecord[]
  memories: MemoryRecord[]
  /** 已整理到第几轮（0 = 一轮都没整理） */
  watermark: number
  attempts: { from: number; to: number; ok: boolean; ts: number }[]
}

const dayOf = (ts: number) => Math.floor(Number(ts) / 86_400_000)

export function buildView(events: any[]): LedgerView {
  const turns: TurnRecord[] = []
  const byTurn = new Map<string, TurnRecord>()

  for (const e of events) {
    if (e.t === 'turn') {
      const t: TurnRecord = {
        id: e.id,
        index: turns.length + 1,
        ts: Number(e.ts) || 0,
        scope: e.scope ?? null,
        note: String(e.note ?? ''),
        raw: e.raw ?? null,
        appraisal: e.appraisal ?? null,
        salience: Number(e.salience ?? 0),
        tags: Array.isArray(e.tags) ? e.tags : [],
        injected: Array.isArray(e.injected) ? e.injected.map(String) : [],
        neutral: '',
        segments: [],
        her: [],
        summaryState: e.summaryState ?? 'none',
        affectAtWrite: e.affectAtWrite ?? null,
        affectPeak: e.affectPeak ?? null,
        hits: { considered: 0, used: 0 },
        mergedInto: [],
      }
      turns.push(t)
      byTurn.set(t.id, t)
    }
  }

  for (const e of events) {
    if (e.t === 'summary' && byTurn.has(e.turnId)) {
      const t = byTurn.get(e.turnId)
      if (e.role === 'her') {
        t.her.push({ at: Number(e.ts) || 0, text: String(e.text ?? ''), affect: e.affect ?? null })
        t.summaryState = t.neutral ? 'both' : 'her'
      } else if (e.role === 'neutral') {
        t.neutral = String(e.text ?? '')
        t.segments = Array.isArray(e.segments) ? e.segments : []
        t.summaryState = t.her.length ? 'both' : 'neutral'
      }
    } else if (e.t === 'revisit' && byTurn.has(e.turnId)) {
      const t = byTurn.get(e.turnId)
      t.her.push({ at: Number(e.ts) || 0, text: String(e.text ?? ''), affect: e.affect ?? null })
      t.summaryState = t.neutral ? 'both' : 'her'
    } else if (e.t === 'hit' && byTurn.has(e.turnId)) {
      const t = byTurn.get(e.turnId)
      if (e.use === 'used') t.hits.used += 1
      else t.hits.considered += 1
    }
  }

  const mergedById = new Map<string, MemoryRecord>()
  const reinforced = new Map<string, number>()
  const retired = new Map<string, string>()
  const revisedConf = new Map<string, number>()
  const supersededBy = new Map<string, string>()

  for (const e of events) {
    if (e.t === 'retire' && e.ref) retired.set(e.ref, String(e.reason ?? ''))
    else if (e.t === 'revise' && e.ref) {
      if (Number.isFinite(Number(e.confidence))) revisedConf.set(e.ref, Number(e.confidence))
      else reinforced.set(e.ref, (reinforced.get(e.ref) ?? 0) + 1)
    } else if (e.t === 'hit' && e.ref && e.use === 'used') {
      // 只有「她真的用了」才让重量上升；被注入本身不算
      reinforced.set(e.ref, (reinforced.get(e.ref) ?? 0) + 1)
    } else if (e.t === 'merged' && e.supersedes) supersededBy.set(e.supersedes, e.id)
  }

  const memories: MemoryRecord[] = []
  for (const e of events) {
    if (e.t !== 'merged') continue
    const claim = String(e.claim ?? '')
    const evidence = Array.isArray(e.evidence) ? e.evidence.map(String) : []
    const evTurns = evidence.map((id) => byTurn.get(id)).filter(Boolean) as TurnRecord[]
    const scopeKeys = new Set(evTurns.map((t) => (t.scope ? `${t.scope.kind}:${t.scope.id}` : '')))
    const dayKeys = new Set(evTurns.map((t) => String(dayOf(t.ts))))
    const tsList = evTurns.map((t) => t.ts).filter((n) => Number.isFinite(n))
    const peak = evTurns.map((t) => t.affectPeak).filter(Boolean)
    const status = retired.has(e.id) ? 'retired' : (e.status === 'retired' ? 'retired' : 'active')
    const m: MemoryRecord = {
      id: e.id,
      kind: isKind(e.kind) ? e.kind : 'fact',
      subject: e.subject ?? 'user',
      claim,
      attitude: e.attitude ?? null,
      trigger: e.trigger,
      action: e.action,
      tags: Array.isArray(e.tags) ? e.tags : [],
      evidence,
      evidenceStats: {
        turns: evidence.length,
        sessions: scopeKeys.size,
        days: dayKeys.size,
        firstAt: tsList.length ? Math.min(...tsList) : null,
        lastAt: tsList.length ? Math.max(...tsList) : null,
      },
      confidence: revisedConf.has(e.id) ? revisedConf.get(e.id) : Number(e.confidence ?? 0.5),
      reinforcements: Number(e.reinforcements ?? 0) + (reinforced.get(e.id) ?? 0),
      status,
      retireReason: retired.get(e.id) || undefined,
      createdAt: Number(e.ts) || 0,
      firstAt: tsList.length ? Math.min(...tsList) : null,
      lastAt: tsList.length ? Math.max(...tsList) : null,
      lastTouchedAt: Number(e.ts) || 0,
      affectPeak: e.affectPeak ?? peak[0] ?? null,
      affectAtWrite: e.affectAtWrite ?? null,
      by: e.by ?? null,
      sourceBatch: e.sourceBatch ?? null,
      supersedes: e.supersedes ?? null,
      supersededBy: supersededBy.get(e.id) ?? null,
      counterexamples: Array.isArray(e.counterexamples) ? e.counterexamples.map(String) : [],
    }
    memories.push(m)
    mergedById.set(m.id, m)
    for (const tid of evidence) {
      const t = byTurn.get(tid)
      if (t && !t.mergedInto.includes(m.id)) t.mergedInto.push(m.id)
    }
  }

  // 水位线：最后一次成功的整理尝试覆盖到第几轮
  let watermark = 0
  const attempts: { from: number; to: number; ok: boolean; ts: number }[] = []
  for (const e of events) {
    if (e.t !== 'consolidation-attempt' || !e.batch) continue
    const to = Number(e.batch.to) || 0
    attempts.push({ from: Number(e.batch.from) || 0, to, ok: !!e.ok, ts: Number(e.ts) || 0 })
    if (e.ok) watermark = Math.max(watermark, to)
  }

  return { turns, memories, watermark, attempts }
}

/** 记忆的「重量」：证据 × 强化 × 时间衰减。是投影，永不落盘。 */
export function weightOf(m: MemoryRecord, now: number, halfLifeDays = 30): number {
  const ageDays = Math.max(0, (now - (m.lastAt || m.createdAt)) / 86_400_000)
  const boost = 1 + 0.4 * Math.log(1 + Math.max(0, m.reinforcements))
  return m.confidence * boost * Math.pow(0.5, ageDays / Math.max(1, halfLifeDays))
}

/** 该 kind 的证据是否够。关系类还要跨会话或跨天。 */
export function evidenceOk(m: { kind: string; evidence: string[]; evidenceStats?: any }): boolean {
  const min = MIN_EVIDENCE[m.kind] ?? 2
  const n = new Set(m.evidence).size
  if (n < min || n > MAX_EVIDENCE) return false
  if (m.kind === 'relation') {
    const st = m.evidenceStats || {}
    if (n >= 3 && (st.sessions > 1 || st.days > 1)) return true
    return false
  }
  return true
}
