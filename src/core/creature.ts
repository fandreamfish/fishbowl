/**
 * 个体：状态 = f(事件日志, 时间)。
 * 情绪是投影，从日志重放得出；缓存只是加速，删了重算结果一致。
 */
import type { Affect, Appraisal, Bias, CreatureEvent, CreatureMeta, Temperament } from './types.ts'
import { freshAffect } from './types.ts'
import {
  applyAbsence, applyAppraisal, applyContact, applyElapse,
  applyRepair, salienceOf, toBias,
} from './engine.ts'
import { memoryWindowDays } from './growth.ts'
import { Store } from './store.ts'
import { matchClaims, matchTexts } from './recall.ts'
import { uid } from './util.ts'

export class Creature {
  readonly store: Store
  readonly meta: CreatureMeta

  constructor(store: Store, meta: CreatureMeta) {
    this.store = store
    this.meta = meta
  }

  get temperament(): Temperament { return this.meta.temperament }

  static create(dir: string, meta: CreatureMeta): Creature {
    return new Creature(Store.create(dir, meta), meta)
  }

  static open(dir: string): Creature {
    const store = new Store(dir)
    return new Creature(store, store.readMeta())
  }

  /** 从缓存尾重放事件，返回当前情绪。重放是确定性的；封存期间时间不流逝。 */
  fold(): { affect: Affect; fromSeq: number; frozen: boolean } {
    const events = this.store.readEvents()
    const cache = this.store.readCache()
    const t = this.temperament

    let aff = freshAffect(t)
    let start = 0
    let frozen = false
    if (cache && typeof cache.lastSeq === 'number' && cache.lastSeq <= events.length) {
      aff = cache.affect as Affect
      frozen = cache.frozen === true
      start = cache.lastSeq
    }

    for (let i = start; i < events.length; i++) {
      if (i > 0 && !frozen) applyElapse(aff, (events[i].ts - events[i - 1].ts) / 1000, t)
      const e = events[i]
      if (e.t === 'freeze') frozen = true
      else if (e.t === 'unfreeze') frozen = false
      this.applyEvent(aff, e, t)
    }

    this.store.writeCache({ lastSeq: events.length, affect: aff, frozen })
    return { affect: aff, fromSeq: start, frozen }
  }

  private applyEvent(aff: Affect, e: CreatureEvent, t: Temperament): void {
    // episode 与 turn 都带 appraisal：前者是旧格式，后者是记忆系统的记录
    if ((e.t === 'episode' || e.t === 'turn') && e.appraisal) applyAppraisal(aff, e.appraisal, t)
    else if (e.t === 'absence') applyAbsence(aff, e.wakingHours)
    else if (e.t === 'contact') applyContact(aff, e.relief)
    else if (e.t === 'repair') applyRepair(aff, e.amount)
    // semantic / procedure / identity / activity / freeze / unfreeze 不参与情绪重放
  }

  bias(): Bias {
    return toBias(this.fold().affect, this.temperament)
  }

  recordEpisode(kind: string, a: Appraisal, note?: string, ts?: number): void {
    this.store.appendEvent({
      t: 'episode', id: uid(), ts: ts ?? Date.now(), kind,
      appraisal: a, salience: salienceOf(a), note,
    })
  }

  recordAbsence(wakingHours: number, ts?: number): void {
    this.store.appendEvent({ t: 'absence', id: uid(), ts: ts ?? Date.now(), wakingHours })
  }

  recordContact(relief: number, ts?: number): void {
    this.store.appendEvent({ t: 'contact', id: uid(), ts: ts ?? Date.now(), relief })
  }

  recordRepair(amount: number, ts?: number): void {
    this.store.appendEvent({ t: 'repair', id: uid(), ts: ts ?? Date.now(), amount })
  }

  recordSemantic(claim: string, evidence: string[], confidence: number, ts?: number): void {
    this.store.appendEvent({ t: 'semantic', id: uid(), ts: ts ?? Date.now(), claim, evidence, confidence, status: 'active' })
  }

  recordProcedure(trigger: string, action: string, evidence: string[], confidence: number, ts?: number): void {
    this.store.appendEvent({ t: 'procedure', id: uid(), ts: ts ?? Date.now(), trigger, action, evidence, confidence, status: 'active' })
  }

  /** 接受名字：既是事件（可回溯），也更新 meta（权威读取处）。 */
  recordIdentity(name: string, ts?: number): void {
    this.store.appendEvent({ t: 'identity', id: uid(), ts: ts ?? Date.now(), name })
    this.store.updateMetaName(name)
    this.meta.name = name
  }

  /** 自我认知（证据门槛在 parseSelf 里）。 */
  recordSelf(claim: string, evidence: string[], confidence: number, ts?: number): void {
    this.store.appendEvent({ t: 'self', id: uid(), ts: ts ?? Date.now(), claim, evidence, confidence, status: 'active' })
  }

  /** 承诺（M2.4）。 */
  recordCommitment(text: string, ts?: number): void {
    this.store.appendEvent({ t: 'commitment', id: uid(), ts: ts ?? Date.now(), text })
  }

  /** 共享活动（M3.2）。 */
  recordActivity(title: string, status: 'started' | 'ended', ts?: number): void {
    this.store.appendEvent({ t: 'activity', id: uid(), ts: ts ?? Date.now(), title, status })
  }

  /** 她主动找过你（配额跨重启用）。 */
  recordOutreach(reason?: string, ts?: number): void {
    this.store.appendEvent({ t: 'outreach', id: uid(), ts: ts ?? Date.now(), reason })
  }

  /** 最近的主动联系时间（滚动窗口用）。 */
  outreachTimes(since = 0): number[] {
    return this.store
      .readEvents()
      .filter((e): e is Extract<CreatureEvent, { t: 'outreach' }> => e.t === 'outreach' && e.ts >= since)
      .map(e => e.ts)
      .sort((a, b) => a - b)
  }
  /** 封存（M4）：停止时间。 */
  recordFreeze(ts?: number): void {
    this.store.appendEvent({ t: 'freeze', id: uid(), ts: ts ?? Date.now() })
  }

  recordUnfreeze(ts?: number): void {
    this.store.appendEvent({ t: 'unfreeze', id: uid(), ts: ts ?? Date.now() })
  }

  isFrozen(): boolean {
    return this.fold().frozen
  }

  // —— M7：住处（工作区 / 会话） ——

  /** 搬进一个住处（工作区或会话）；调用方负责冲突检查。 */
  setOccupancy(occ: { kind: 'workspace' | 'session'; id: string; workspace?: string } | null): void {
    this.meta.occupancy = occ
    this.store.writeMeta(this.meta)
  }

  releaseOccupancy(): void {
    this.setOccupancy(null)
  }

  // —— M7：日记 / 小纸条 / 请求 ——

  /** 今天的日记写过了吗（date 形如 YYYY-MM-DD）。 */
  hasDiary(date: string): boolean {
    return this.store.readEvents().some(e => e.t === 'diary' && e.date === date)
  }

  recordDiary(date: string, text: string, ts?: number): void {
    this.store.appendEvent({ t: 'diary', id: uid(), ts: ts ?? Date.now(), date, text })
  }

  diaries(limit = 14): { date: string; text: string; ts: number }[] {
    return this.store
      .readEvents()
      .filter((e): e is Extract<CreatureEvent, { t: 'diary' }> => e.t === 'diary')
      .slice(-limit)
      .map(e => ({ date: e.date, text: e.text, ts: e.ts }))
      .reverse()
  }

  recordNote(text: string, ts?: number): void {
    this.store.appendEvent({ t: 'note', id: uid(), ts: ts ?? Date.now(), text })
  }

  notes(limit = 10): { text: string; ts: number }[] {
    return this.store
      .readEvents()
      .filter((e): e is Extract<CreatureEvent, { t: 'note' }> => e.t === 'note')
      .slice(-limit)
      .map(e => ({ text: e.text, ts: e.ts }))
      .reverse()
  }

  /** 请求：她有事想征求你的同意。 */
  recordRequest(text: string, ts?: number): void {
    this.store.appendEvent({ t: 'request', id: uid(), ts: ts ?? Date.now(), text })
  }

  /** 回答一个请求：yes / no。 */
  answerRequest(ref: string, answer: 'yes' | 'no', ts?: number): void {
    this.store.appendEvent({ t: 'request-answered', id: uid(), ts: ts ?? Date.now(), ref, answer })
  }

  /** 所有请求（含已答/未答）。 */
  requests(): { id: string; text: string; ts: number; answer: 'yes' | 'no' | null }[] {
    const events = this.store.readEvents()
    const answers = new Map<string, 'yes' | 'no'>()
    for (const e of events) if (e.t === 'request-answered') answers.set(e.ref, e.answer)
    return events
      .filter((e): e is Extract<CreatureEvent, { t: 'request' }> => e.t === 'request')
      .map(e => ({ id: e.id, text: e.text, ts: e.ts, answer: answers.get(e.id) ?? null }))
  }

  /** 配额：某个时间点之后提过几次请求。 */
  requestCountSince(since: number): number {
    return this.store.readEvents().filter(e => e.t === 'request' && e.ts >= since).length
  }

  /** 还有没有没答的请求（答过的进历史）。 */
  pendingRequests(): { id: string; text: string; ts: number }[] {
    return this.requests().filter(r => r.answer === null).map(({ id, text, ts }) => ({ id, text, ts }))
  }

  /** 请求摘要：还在等回音的 + 最近 24 小时他答过的（注入用）。 */
  requestDigest(now = Date.now()): { pending: string[]; answered: { text: string; answer: 'yes' | 'no' }[] } {
    const events = this.store.readEvents()
    const answeredAt = new Map<string, number>()
    for (const e of events) if (e.t === 'request-answered') answeredAt.set(e.ref, e.ts)
    const list = this.requests()
    const pending = list.filter(r => r.answer === null).slice(-3).map(r => r.text)
    const answered = list
      .filter(r => r.answer !== null && now - (answeredAt.get(r.id) ?? 0) < 86_400_000)
      .slice(-2)
      .map(r => ({ text: r.text, answer: r.answer }))
    return { pending, answered }
  }

  /** 当前正在一起做的事（记忆窗口内最后一次 started 且未 ended）。 */
  currentActivity(g = 1): string | null {
    const events = this.store.readEvents()
    const windowMs = memoryWindowDays(g) * 86_400_000
    const now = Date.now()
    let current: string | null = null
    for (const e of events) {
      if (e.t !== 'activity' || now - e.ts >= windowMs) continue
      if (e.status === 'started') current = e.title
      else if (current === e.title) current = null
    }
    return current
  }

  /** 承诺结算：fulfilled 或 broken。broken 的承诺不消失——没翻篇。 */
  resolveCommitment(ref: string, status: 'fulfilled' | 'broken', ts?: number): void {
    this.store.appendEvent({ t: 'commitment-resolved', id: uid(), ts: ts ?? Date.now(), ref, status })
  }

  /** 未了结的承诺（含 broken——它们仍然算"欠着"）。 */
  openCommitments(g = 1): { id: string; text: string; broken: boolean }[] {
    const events = this.store.readEvents()
    const resolved = new Map<string, 'fulfilled' | 'broken'>()
    for (const e of events) if (e.t === 'commitment-resolved') resolved.set(e.ref, e.status)
    const windowMs = memoryWindowDays(g) * 86_400_000
    const now = Date.now()
    const open: { id: string; text: string; broken: boolean }[] = []
    for (const e of events) {
      if (e.t === 'commitment' && now - e.ts < windowMs) {
        const st = resolved.get(e.id)
        if (st === undefined || st === 'broken') open.push({ id: e.id, text: e.text, broken: st === 'broken' })
      }
    }
    return open
  }

  /** 记忆强化（M6）：同一件事被再次提到 → 重量上升，不是重复落盘。 */
  recordReinforce(ref: string, ts?: number): void {
    this.store.appendEvent({ t: 'reinforce', id: uid(), ts: ts ?? Date.now(), ref })
  }

  /** 某类认知的原文（去重用，含已折叠的旧记忆——旧事不会被重新记一遍）。 */
  claimTexts(kind: 'semantic' | 'procedure' | 'self'): string[] {
    const events = this.store.readEvents()
    const out: string[] = []
    for (const e of events) {
      if (e.t !== kind || e.status !== 'active') continue
      out.push(e.t === 'procedure' ? `${e.trigger} → ${e.action}` : e.claim)
    }
    return out
  }

  /** 按原文找认知的事件 id（去重命中 → 强化）。 */
  findClaim(text: string): string | null {
    const events = this.store.readEvents()
    for (const e of events) {
      if (e.t === 'semantic' && e.status === 'active' && e.claim === text) return e.id
      if (e.t === 'procedure' && e.status === 'active' && `${e.trigger} → ${e.action}` === text) return e.id
      if (e.t === 'self' && e.status === 'active' && e.claim === text) return e.id
    }
    return null
  }

  /**
   * 记忆重量（M6）：
   *   重量 = 置信度 × (1 + 0.4·ln(1+强化次数)) × 0.5^(ageDays / 半衰期)
   * 半衰期 = 记忆窗口/3；超过窗口的不再逐个显示，折叠成"记不清了"，
   * 但事件原文永远在账本里——recall 能翻回去（遗忘是折叠，不是删除）。
   */
  claimsWithWeight(g = 1, now = Date.now()): MemoryClaim[] {
    const events = this.store.readEvents()
    const hits = new Map<string, number>()
    const lastHit = new Map<string, number>()
    for (const e of events) {
      if (e.t !== 'reinforce') continue
      hits.set(e.ref, (hits.get(e.ref) ?? 0) + 1)
      lastHit.set(e.ref, Math.max(lastHit.get(e.ref) ?? 0, e.ts))
    }
    const windowMs = memoryWindowDays(g) * 86_400_000
    const halfLifeDays = Math.max(1, memoryWindowDays(g) / 3)
    const out: MemoryClaim[] = []
    for (const e of events) {
      if ((e.t !== 'semantic' && e.t !== 'procedure' && e.t !== 'self') || e.status !== 'active') continue
      const text = e.t === 'procedure' ? `${e.trigger} → ${e.action}` : e.claim
      const confidence = e.confidence ?? 0.5
      const n = hits.get(e.id) ?? 0
      const lastSeen = Math.max(e.ts, lastHit.get(e.id) ?? 0)
      const ageDays = Math.max(0, (now - lastSeen) / 86_400_000)
      const weight = confidence * (1 + 0.4 * Math.log(1 + n)) * Math.pow(0.5, ageDays / halfLifeDays)
      out.push({ id: e.id, kind: e.t, text, confidence, hits: n, lastSeen, weight, folded: now - lastSeen > windowMs })
    }
    return out.sort((a, b) => b.weight - a.weight)
  }

  /** 按话题匹配她记得的事（用户这句话提到了什么）。 */
  recallMatches(text: string, g = 1, limit = 3): { id: string; kind: MemoryClaim['kind']; text: string; score: number }[] {
    return matchClaims(this.claimsWithWeight(g), text, limit)
  }

  /** 最近说过的话（原文，按时间正序）：跨会话共享同一份。 */
  recentDialog(limit = 6): { ts: number; text: string }[] {
    const out: { ts: number; text: string }[] = []
    for (const e of this.store.readEvents()) {
      if ((e.t === 'episode' || e.t === 'turn') && typeof e.note === 'string') out.push({ ts: e.ts, text: e.note })
    }
    return out.slice(-limit)
  }

  /** 按话题翻原始对话（整个历史，不限时间）。 */
  episodeMatches(text: string, limit = 3): { ts: number; text: string; score: number }[] {
    const items: { ts: number; text: string }[] = []
    for (const e of this.store.readEvents()) {
      if ((e.t === 'episode' || e.t === 'turn') && typeof e.note === 'string') items.push({ ts: e.ts, text: e.note })
    }
    return matchTexts(items, text, limit)
  }
  /** 回忆（M6）：按重量翻出记忆，含已折叠的旧事。 */
  recall(g = 1, limit = 8): MemoryClaim[] {
    return this.claimsWithWeight(g).slice(0, limit)
  }

  /** 注入用记忆摘要：名字 + 重量最高的活跃语义/教训/自我认知 + 折叠计数。 */
  memorySummary(g = 1): {
    name: string | null
    semantics: string[]
    procedures: string[]
    self: string[]
    commitments: string[]
    activity: string | null
    folded: number
    requests: { pending: string[]; answered: { text: string; answer: 'yes' | 'no' }[] }
  } {
    const name = this.meta.name && !this.meta.name.startsWith('fish-') ? this.meta.name : null
    const claims = this.claimsWithWeight(g)
    const active = (kind: MemoryClaim['kind'], limit: number, minConf = 0) =>
      claims
        .filter(c => c.kind === kind && !c.folded && c.confidence >= minConf)
        .slice(0, limit)
        .map(c => c.text)
    const commitments = this.openCommitments(g).slice(-2).map(c => (c.broken ? '⚠ ' : '') + c.text)
    const activity = this.currentActivity(g)
    return {
      name,
      semantics: active('semantic', 3),
      procedures: active('procedure', 2),
      self: active('self', 2, 0.5),
      commitments,
      activity,
      folded: claims.filter(c => c.folded).length,
      requests: this.requestDigest(),
    }
  }
}

export interface MemoryClaim {
  id: string
  kind: 'semantic' | 'procedure' | 'self'
  text: string
  confidence: number
  hits: number
  lastSeen: number
  weight: number
  folded: boolean
}
