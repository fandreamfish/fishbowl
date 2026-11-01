/**
 * 记忆系统门面（docs/MEMORY.md）。
 *
 *   observe()  零 LLM，落 turn 记录（先落盘，永不丢）
 *   tick()     异步补齐两份总结；攒够上限就整理成合并记忆
 *   render()   预算制的注入块
 *   search()   按相关度查（含已退休的）；searchHybrid() 在有向量时融合两路
 */
import fs from 'node:fs'
import path from 'node:path'
import { Ledger, newId } from './ledger.ts'
import { buildView, weightOf } from './records.ts'
import type { MemoryRecord, TurnRecord } from './records.ts'
import {
  HER_SYSTEM, NEUTRAL_SYSTEM, buildHerUser, buildNeutralUser,
  parseHer, parseNeutral, splitSegments,
} from './summarize.ts'
import { MERGE_SYSTEM, buildMergeUser, parseMerge, gateMemories, dedupeAgainst } from './consolidate.ts'
import { RecallIndex } from './recall.ts'
import { renderText, fingerprint } from './render.ts'
import { normalizeMemory } from './config.ts'
import { toAffect4 } from './events.ts'
import { acquireWriterLock } from './lock.ts'
import type { LockStatus } from './lock.ts'
import { VectorStore, rrf } from './embed.ts'
import type { Embedder } from './embed.ts'

export interface LlmRequest {
  kind: string
  system: string
  user: string
  json?: boolean
  maxTokens?: number
  model?: string
}

export type Llm = (req: LlmRequest) => Promise<string>

export interface TickReport {
  her: number
  neutral: number
  merged: number
  rejected: { claim: string; why: string }[]
  errors: string[]
  skipped: string[]
}

const SNAPSHOT_V = 1
const SNAPSHOT_EVERY = 20

export class Memory {
  readonly dir: string
  readonly ledger: Ledger
  cfg: any
  /** 写锁状态：抢不到时不是 null（只检测不上报才是失职） */
  lockStatus: LockStatus | null = null
  private clock: () => number
  private index = new RecallIndex()
  private indexKey = ''
  private tries = new Map<string, number>()
  private snapCache: { bytes: number; view: ReturnType<typeof buildView> } | null = null
  private snapSaved = 0
  private lock: { status: LockStatus; release: () => void } | null = null
  private vectors: VectorStore | null = null
  private embedder: Embedder | null = null

  constructor(opts: { dir: string; cfg?: any; clock?: () => number; lock?: 'off' | 'warn' | 'strict'; embedder?: Embedder }) {
    this.dir = opts.dir
    this.ledger = new Ledger(opts.dir)
    this.cfg = normalizeMemory(opts.cfg?.memory ?? opts.cfg)
    this.clock = opts.clock ?? Date.now

    const mode = opts.lock ?? this.cfg.singleWriter
    if (mode !== 'off') {
      const got = acquireWriterLock(opts.dir)
      this.lock = got
      this.lockStatus = got.status
      if (!got.status.ok && mode === 'strict') {
        throw new Error(`另一个写入者（pid ${got.status.holder?.pid}）正占着这份记忆：${opts.dir}`)
      }
    }

    if (opts.embedder) this.embedder = opts.embedder
    if (this.embedder) this.vectors = new VectorStore(opts.dir)
  }

  /** 设置页改了配置：不用重建实例。 */
  setConfig(cfgMemory: any) {
    this.cfg = normalizeMemory(cfgMemory)
  }

  close(): void {
    try {
      this.lock?.release()
    } catch {
      // 忽略
    }
    this.lock = null
  }

  // —— 视图（带快照缓存：删了能重算） ——

  view(): ReturnType<typeof buildView> {
    const bytes = this.ledger.byteSize
    if (this.snapCache && this.snapCache.bytes === bytes) return this.snapCache.view
    const disk = this.readSnapshot(bytes)
    if (disk) {
      this.snapCache = { bytes, view: disk }
      this.snapSaved = this.ledger.read().length
      return disk
    }
    const events = this.ledger.read()
    const view = buildView(events)
    this.snapCache = { bytes, view }
    this.snapSaved = events.length
    return view
  }

  private get snapshotPath(): string {
    return path.join(this.dir, 'snapshot.json')
  }

  private readSnapshot(bytes: number) {
    try {
      const raw = JSON.parse(fs.readFileSync(this.snapshotPath, 'utf8'))
      if (raw?.v !== SNAPSHOT_V || raw.bytes !== bytes) return null
      if (!Array.isArray(raw.view?.turns) || !Array.isArray(raw.view?.memories)) return null
      return raw.view as ReturnType<typeof buildView>
    } catch {
      return null
    }
  }

  /** 每 20 条事件写一次快照。它只是缓存：删掉照样能重算。 */
  private maybeSaveSnapshot(): void {
    try {
      const n = this.ledger.read().length
      if (n - this.snapSaved < SNAPSHOT_EVERY) return
      const view = this.view()
      const tmp = this.snapshotPath + '.tmp'
      fs.writeFileSync(tmp, JSON.stringify({ v: SNAPSHOT_V, bytes: this.ledger.byteSize, view }))
      fs.renameSync(tmp, this.snapshotPath)
      this.snapSaved = n
    } catch {
      // 快照写失败不影响任何功能
    }
  }

  // —— 写 ——

  /** 一轮结束：先落盘。appraisal 已经算好，情绪快照是这一轮的冲击点。 */
  observe(turn: {
    note: string
    scope?: any
    raw?: any
    appraisal?: any
    salience?: number
    affect?: any
    injected?: string[]
    ts?: number
  }) {
    const ts = turn.ts ?? this.clock()
    const ev = this.ledger.append({
      t: 'turn',
      id: newId(),
      ts,
      note: String(turn.note ?? ''),
      scope: turn.scope ?? null,
      raw: turn.raw ?? null,
      appraisal: turn.appraisal ?? null,
      salience: Number(turn.salience ?? 0),
      tags: [],
      summaryState: 'none',
      affectAtWrite: null,
      affectPeak: toAffect4(turn.affect),
      injected: Array.isArray(turn.injected) ? turn.injected.slice(0, 40) : [],
    } as any)
    for (const id of (turn.injected || [])) {
      this.ledger.append({ t: 'hit', id: newId(), ts, turnId: ev.id, ref: id, use: 'considered' } as any)
    }
    this.maybeSaveSnapshot()
    return ev
  }

  recordHit(turnId: string | null, memoryId: string, use: 'used' | 'considered', ts?: number) {
    return this.ledger.append({ t: 'hit', id: newId(), ts: ts ?? this.clock(), turnId: turnId || undefined, ref: memoryId, use } as any)
  }

  retire(memoryId: string, reason = '') {
    return this.ledger.append({ t: 'retire', id: newId(), ts: this.clock(), ref: memoryId, reason } as any)
  }

  config(key: string, from: unknown, to: unknown) {
    return this.ledger.append({ t: 'config', id: newId(), ts: this.clock(), key, from, to } as any)
  }

  // —— 后台 ——

  /**
   * 补齐未完成的总结 + 到点就整理。
   * 每次最多 maxCalls 次模型调用（默认 3：两份总结 + 一次整理），失败不抛。
   */
  async tick(opts: { llm: Llm; now?: number; maxCalls?: number; by?: any; force?: boolean }): Promise<TickReport> {
    const now = opts.now ?? this.clock()
    const max = Math.max(1, opts.maxCalls ?? 3)
    const report: TickReport = { her: 0, neutral: 0, merged: 0, rejected: [], errors: [], skipped: [] }
    let calls = 0

    let view = this.view()
    const memById = new Map(view.memories.map((m) => [m.id, m]))

    // 1) 最老的未完成轮次
    for (const t of view.turns) {
      if (calls >= max) break
      const needNeutral = !t.neutral
      const needHer = t.her.length === 0 && this.wantsHer(t)
      if (!needNeutral && !needHer) continue
      if ((this.tries.get(t.id) ?? 0) >= 2) continue

      if (needNeutral) {
        calls += 1
        try {
          const raw = await opts.llm({
            kind: 'neutral',
            system: NEUTRAL_SYSTEM.replace('{{TAGS}}', this.cfg.tags.join(' / ')),
            user: buildNeutralUser({ transcript: t.note, tags: this.cfg.tags }),
            json: true,
            maxTokens: 500,
            model: this.cfg.neutralModel || undefined,
          })
          const parsed = parseNeutral(raw, this.cfg.tags)
          const segs = splitSegments(t.note, parsed.segments)
          const text = segs.map((s) => s.text).filter(Boolean).join('；') || '（这一轮没有可记的内容）'
          this.ledger.append({
            t: 'summary', id: newId(), ts: this.clock(), turnId: t.id, role: 'neutral',
            text, segments: segs, tags: parsed.tags,
            by: { ...(opts.by || {}), prompt: 'neutral@1' },
          } as any)
          report.neutral += 1
        } catch (e) {
          this.bump(t.id)
          report.errors.push(`neutral ${t.id.slice(0, 8)}: ${String((e as any)?.message || e)}`)
        }
      }

      if (needHer && calls < max) {
        calls += 1
        const injected = (t.injected || [])
          .map((id) => ({ id, text: memById.get(id)?.claim || '' }))
          .filter((x) => x.text)
        try {
          const raw = await opts.llm({
            kind: 'her',
            system: HER_SYSTEM,
            user: buildHerUser({ transcript: t.note, affect: t.affectPeak, injected }),
            json: true,
            maxTokens: 300,
            model: this.cfg.neutralModel || undefined,
          })
          const parsed = parseHer(raw)
          if (parsed.herSummary) {
            this.ledger.append({
              t: 'summary', id: newId(), ts: this.clock(), turnId: t.id, role: 'her',
              text: parsed.herSummary, affect: toAffect4(t.affectPeak),
              by: { ...(opts.by || {}), prompt: 'her@1' },
            } as any)
            for (const id of parsed.used) {
              if (memById.has(id) && injected.some((x) => x.id === id)) this.recordHit(t.id, id, 'used')
            }
            report.her += 1
          }
        } catch (e) {
          this.bump(t.id)
          report.errors.push(`her ${t.id.slice(0, 8)}: ${String((e as any)?.message || e)}`)
        }
      }
    }

    // 2) 到点整理：攒够上限，或者积压了一段时间（避免新鱼一直"未总结"）
    view = this.view()
    const pendingTurns = view.turns.slice(view.watermark)
    const pending = pendingTurns.length
    const oldestPendingTs = Number(pendingTurns[0]?.ts ?? now)
    const idleFlush = pending >= 3 && now - oldestPendingTs > 10 * 60_000
    if ((pending >= this.cfg.consolidateCap || idleFlush) && calls < max) {
      const from = view.watermark + 1
      const size = Math.min(Math.max(1, this.cfg.consolidateCap), pending)
      const batch = pendingTurns.slice(0, size)
      const to = from + batch.length - 1
      const last = [...view.attempts].reverse().find((a) => a.from === from && a.to === to)
      const attempts = view.attempts.filter((a) => a.from === from && a.to === to).length
      if (!opts.force && (attempts >= 3 || (last && !last.ok && now - last.ts < 10 * 60_000))) {
        report.skipped.push(`merge ${from}-${to}（退避中）`)
      } else {
        report.merged = await this.merge(batch, view.memories, { from, to }, opts)
        if (report.merged) this.maybeSaveSnapshot()
      }
    }

    return report
  }

  /** 把水位线退回去，让被零产出吞掉的批次重新整理（追加事件，不改历史）。 */
  rewindTo(to: number) {
    this.ledger.append({ t: 'watermark-rewind', id: newId(), ts: this.clock(), to: Math.max(0, Math.floor(to)) } as any)
  }
  private wantsHer(t: TurnRecord): boolean {
    if (this.cfg.herSummaryOnPlainTurns) return true
    return Number(t.salience) >= 0.4
  }

  private bump(turnId: string) {
    this.tries.set(turnId, (this.tries.get(turnId) || 0) + 1)
  }

  private async merge(
    batch: TurnRecord[],
    memories: MemoryRecord[],
    range: { from: number; to: number },
    opts: { llm: Llm; by?: any },
  ): Promise<number> {
    const by = { ...(opts.by || {}), prompt: 'merge@1' }
    const existing = memories
      .filter((m) => m.status === 'active')
      .slice(-40)
      .map((m) => ({ id: m.id, claim: m.claim, kind: m.kind }))

    let raw = ''
    try {
      raw = await opts.llm({
        kind: 'merge',
        system: MERGE_SYSTEM.replace('{{MIN}}', '2').replace('{{MAX}}', '12'),
        user: buildMergeUser(batch, existing, this.cfg.tags),
        json: true,
        maxTokens: 1800,
        model: this.cfg.neutralModel || undefined,
      })
    } catch (e) {
      this.ledger.append({
        t: 'consolidation-attempt', id: newId(), ts: this.clock(), batch: range, ok: false,
        error: String((e as any)?.message || e).slice(0, 200), by,
      } as any)
      return 0
    }

    const parsed = parseMerge(raw)
    const { accepted, rejected } = gateMemories(parsed, batch, this.cfg.tags)
    const { fresh, dup } = dedupeAgainst(accepted, existing)

    // 产出 0：不推进水位线（批次还有机会重新整理）；连续 3 次才放弃
    if (fresh.length === 0 && dup.length === 0) {
      const prior = this.view().attempts.filter((a) => a.from === range.from && a.to === range.to).length
      this.ledger.append({
        t: 'consolidation-attempt', id: newId(), ts: this.clock(), batch: range, ok: false,
        produced: 0, rejected: rejected.slice(0, 5), rawHead: String(raw ?? '').slice(0, 200),
        giveUp: prior + 1 >= 3, by,
      } as any)
      if (prior + 1 >= 3) {
        this.ledger.append({ t: 'consolidation-attempt', id: newId(), ts: this.clock(), batch: range, ok: true, produced: 0, gaveUp: true, by } as any)
      }
      return 0
    }

    const now = this.clock()
    for (const c of dup) {
      // 同一件事又说了一遍：不新增，记一条强化（重量上升）
      this.ledger.append({ t: 'revise', id: newId(), ts: now, ref: c.hit.id, note: 'again' } as any)
    }

    const peak = this.peakOf(batch)
    for (const c of fresh) {
      const supersedes = c.supersedes && existing.some((m) => m.id === c.supersedes) ? c.supersedes : null
      this.ledger.append({
        t: 'merged', id: newId(), ts: now,
        kind: c.kind, subject: c.subject, claim: c.claim, attitude: c.attitude,
        trigger: c.trigger, action: c.action, tags: c.tags,
        evidence: c.evidence, confidence: c.confidence,
        affectPeak: peak, affectAtWrite: peak,
        by, sourceBatch: range, supersedes, status: 'active',
      } as any)
      if (supersedes) this.ledger.append({ t: 'retire', id: newId(), ts: now, ref: supersedes, reason: 'superseded' } as any)
    }

    this.ledger.append({
      t: 'consolidation-attempt', id: newId(), ts: now, batch: range, ok: true,
      produced: fresh.length, rejected: rejected.slice(0, 5), by,
    } as any)

    return fresh.length
  }

  private peakOf(batch: TurnRecord[]) {
    let best: any = null
    let bestScore = -1
    for (const t of batch) {
      const a = t.affectPeak
      if (!a) continue
      const s = Math.abs(Number(a.valence) || 0) + Number(a.arousal || 0)
      if (s > bestScore) {
        bestScore = s
        best = a
      }
    }
    return best
  }

  // —— 读 ——

  private syncIndex(view: ReturnType<typeof buildView>) {
    const key = `${view.memories.length}|${view.turns.length}`
    if (key === this.indexKey) return
    const docs = []
    for (const m of view.memories) {
      docs.push({ id: m.id, text: `${m.claim} ${m.attitude || ''} ${m.tags.join(' ')}`, kind: 'memory' as const, ref: m })
    }
    for (const t of view.turns) {
      const text = `${t.neutral} ${t.her.map((h) => h.text).join(' ')}`
      if (text.trim()) docs.push({ id: t.id, text, kind: 'turn' as const, ref: t })
    }
    this.index.sync(docs)
    this.indexKey = key
  }

  /** 按相关度查（含已退休的；折叠 ≠ 删除）。同步，热路径用。 */
  search(query: string, opts: { limit?: number; kind?: 'memory' | 'turn' } = {}) {
    const view = this.view()
    this.syncIndex(view)
    const hits = this.index.search(query, { limit: opts.limit ?? 8, kind: opts.kind })
    return hits.map((h) => ({
      kind: h.doc.kind,
      score: h.score,
      id: h.doc.id,
      text: h.doc.kind === 'memory' ? h.doc.ref.claim : (h.doc.ref.neutral || ''),
      record: h.doc.ref,
    }))
  }

  /** 有向量时把 BM25 与向量两路融合（RRF）；任何一步失败退回纯 BM25。 */
  async searchHybrid(query: string, opts: { limit?: number; kind?: 'memory' | 'turn' } = {}) {
    const base = this.search(query, opts)
    const embedder = this.embedder
    const vectors = this.vectors
    if (!embedder || !vectors) return base
    try {
      await this.ensureVectors()
      const qv = (await embedder.embed([query]))[0]
      if (!qv || !qv.length) return base
      const vec = vectors
        .search(qv, { limit: (opts.limit ?? 8) * 2, model: embedder.id })
        .filter((h) => h.score >= 0.15)
      if (!vec.length) return base
      const fused = rrf([vec, base.map((b) => ({ id: b.id }))])
      const byId = new Map(base.map((b) => [b.id, b]))
      const view = this.view()
      return fused
        .slice(0, opts.limit ?? 8)
        .map((m) => {
          const hit = byId.get(m.id)
          if (hit) return hit
          const mem = view.memories.find((x) => x.id === m.id)
          if (mem) return { kind: 'memory' as const, score: m.fused, id: mem.id, text: mem.claim, record: mem }
          return null
        })
        .filter(Boolean) as ReturnType<Memory['search']>
    } catch {
      return base
    }
  }

  /** 补齐还没向量化的条目（每次最多 32 条，别把一轮打成批量任务）。 */
  private async ensureVectors(limit = 32): Promise<void> {
    const embedder = this.embedder
    const vectors = this.vectors
    if (!embedder || !vectors) return
    const view = this.view()
    const docs = [
      ...view.memories.map((m) => ({ id: m.id, text: `${m.claim} ${m.attitude || ''}` })),
      ...view.turns.filter((t) => t.neutral).map((t) => ({ id: t.id, text: t.neutral })),
    ].filter((d) => !vectors.has(d.id, embedder.id))
    if (!docs.length) return
    const batch = docs.slice(0, limit)
    const vecs = await embedder.embed(batch.map((d) => d.text))
    batch.forEach((d, i) => {
      if (vecs[i] && vecs[i].length) vectors.put(d.id, embedder.id, vecs[i])
    })
  }

  render(input: { affect: any; bias: any; name?: string | null; commitments?: string[]; now?: number }) {
    const now = input.now ?? this.clock()
    const view = this.view()
    const out = renderText({
      name: input.name,
      affect: input.affect,
      bias: input.bias,
      memories: view.memories,
      turns: view.turns,
      commitments: input.commitments,
      budget: this.cfg.injectBudget,
      memoryRatio: this.cfg.memoryRatio,
      turnRatio: this.cfg.turnRatio,
      now,
    })
    return {
      text: out.text,
      picked: out.picked,
      fingerprint: fingerprint(view.memories, input.affect, input.bias),
      view,
    }
  }

  stats() {
    const view = this.view()
    const byKind: Record<string, number> = { fact: 0, lesson: 0, relation: 0, self: 0 }
    for (const m of view.memories) byKind[m.kind] = (byKind[m.kind] || 0) + 1
    return {
      turns: view.turns.length,
      memories: view.memories.length,
      byKind,
      active: view.memories.filter((m) => m.status === 'active').length,
      retired: view.memories.filter((m) => m.status === 'retired').length,
      pending: Math.max(0, view.turns.length - view.watermark),
      watermark: view.watermark,
      lock: this.lockStatus,
      vectors: this.vectors ? this.vectors.size : null,
      weightOf: (m: MemoryRecord) => weightOf(m, this.clock()),
    }
  }
}
