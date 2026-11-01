/**
 * 记忆视图：把账本投影成设置页要的结构。
 * 新旧两种事件格式都映射到同一套字段（新结构优先）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { buildView } from '../../memory/src/index.ts'

const RELATION_RE = /我们|关系|信任|约定|答应|承诺|感情|亲密/

/** 这条认知是谁的事。新结构里由模型给，旧结构里只能按字面猜（关系词优先）。 */
export function subjectOf(text) {
  const s = String(text ?? '')
  if (RELATION_RE.test(s)) return 'between'
  if (/^(用户|他)/.test(s)) return 'user'
  if (/^(AI|我（AI）|我自己)/.test(s) || /AI\s*(会|在|给|对|把)/.test(s)) return 'self'
  return 'world'
}

/** 旧认知（semantic / procedure / self）→ 统一的记忆视图。 */
function legacyClaimView(e, reinforces) {
  const text = e.t === 'procedure' ? `${e.trigger} → ${e.action}` : String(e.claim ?? '')
  const kind = e.t === 'semantic' ? (RELATION_RE.test(text) ? 'relation' : 'fact') : e.t === 'procedure' ? 'lesson' : 'self'
  return {
    id: e.id,
    kind,
    subject: e.t === 'self' ? 'self' : subjectOf(text),
    claim: text,
    attitude: null,
    tags: [],
    evidence: Array.isArray(e.evidence) ? e.evidence.map(String) : [],
    evidenceMode: 'lines',
    confidence: Number(e.confidence ?? 0.5),
    reinforcements: reinforces.get(e.id) ?? 0,
    status: e.status ?? 'active',
    createdAt: e.ts,
    affectPeak: null,
    affectAtWrite: null,
    by: null,
    supersedes: null,
  }
}

/** 旧 episode → turn 记录视图。 */
function legacyTurnView(e) {
  const note = typeof e.note === 'string' ? e.note : ''
  return {
    id: e.id,
    occurredAt: e.ts,
    neutral: note,
    her: [],
    tags: [],
    affectPeak: null,
    salience: Number(e.salience ?? 0),
    hits: { considered: 0, used: 0 },
    summaryState: note ? 'neutral' : 'none',
    scope: null,
    rawText: null,
    legacy: true,
  }
}

/** 有没有另一个活着的进程也在写这只鱼（双写会让一个人变成两个）。 */
export function otherWriter(dir) {
  try {
    const o = JSON.parse(fs.readFileSync(path.join(dir, '.writer.lock'), 'utf8'))
    const pid = Number(o?.pid)
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return null
    try {
      process.kill(pid, 0)
      return { pid, at: Number(o?.at) || 0 }
    } catch (e) {
      return e?.code === 'EPERM' ? { pid, at: Number(o?.at) || 0 } : null
    }
  } catch {
    return null
  }
}

/** 新结构：账本投影 → 设置页视图（字段名与前端约定一致）。 */
function newDetail(events, cfg, dir) {
  const v = buildView(events)
  const turns = v.turns
    .slice()
    .reverse()
    .map((t) => ({
      id: t.id,
      occurredAt: t.ts,
      neutral: t.neutral,
      her: t.her,
      tags: t.tags,
      affectPeak: t.affectPeak,
      salience: t.salience,
      hits: t.hits,
      summaryState: t.summaryState,
      scope: t.scope,
      rawText: t.note,
      legacy: false,
    }))
  const memories = v.memories.map((m) => ({ ...m, evidenceMode: 'turns' }))

  const byKind = { fact: 0, lesson: 0, relation: 0, self: 0 }
  let active = 0
  let retired = 0
  for (const m of memories) {
    if (byKind[m.kind] !== undefined) byKind[m.kind] += 1
    if (m.status === 'retired') retired += 1
    else active += 1
  }

  memories.sort((a, b) => (a.status === b.status ? (b.createdAt || 0) - (a.createdAt || 0) : a.status === 'retired' ? 1 : -1))

  return {
    view: 'new',
    config: cfg.memory ?? null,
    stats: {
      events: events.length,
      turnTotal: v.turns.length,
      memoryTotal: memories.length,
      active,
      retired,
      byKind,
      pending: Math.max(0, v.turns.length - v.watermark),
      watermark: v.watermark,
      lock: dir ? otherWriter(dir) : null,
    },
    memories: memories.slice(0, 1000),
    turns: turns.slice(0, 500),
  }
}

/** 旧结构：只有 episode / semantic / procedure 时，映射成同一套视图。 */
function legacyDetail(events, cfg) {
  const reinforces = new Map()
  for (const e of events) if (e.t === 'reinforce' && e.ref) reinforces.set(e.ref, (reinforces.get(e.ref) || 0) + 1)

  const memories = []
  const turns = []
  for (const e of events) {
    if (e.t === 'semantic' || e.t === 'procedure' || e.t === 'self') memories.push(legacyClaimView(e, reinforces))
    else if (e.t === 'episode') turns.push(legacyTurnView(e))
  }

  const byKind = { fact: 0, lesson: 0, relation: 0, self: 0 }
  let active = 0
  let retired = 0
  for (const m of memories) {
    if (byKind[m.kind] !== undefined) byKind[m.kind] += 1
    if (m.status === 'retired') retired += 1
    else active += 1
  }

  memories.sort((a, b) => (a.status === b.status ? (b.createdAt || 0) - (a.createdAt || 0) : a.status === 'retired' ? 1 : -1))
  turns.sort((a, b) => (b.occurredAt || 0) - (a.occurredAt || 0))

  return {
    view: 'legacy',
    config: cfg.memory ?? null,
    stats: { events: events.length, turnTotal: turns.length, memoryTotal: memories.length, active, retired, byKind, pending: null },
    memories: memories.slice(0, 1000),
    turns: turns.slice(0, 500),
  }
}

/** 记忆详情视图：配置之外的一切。 */
export function memoryDetail(creature, cfg) {
  const events = creature.store.readEvents()
  const hasNew = events.some((e) => e.t === 'turn' || e.t === 'merged')
  return hasNew ? newDetail(events, cfg, creature.store.dir) : legacyDetail(events, cfg)
}
