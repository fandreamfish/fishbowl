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
import { Store } from './store.ts'
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

  /** 从缓存尾重放事件，返回当前情绪。重放是确定性的。 */
  fold(): { affect: Affect; fromSeq: number } {
    const events = this.store.readEvents()
    const cache = this.store.readCache()
    const t = this.temperament

    let aff = freshAffect(t)
    let start = 0
    if (cache && typeof cache.lastSeq === 'number' && cache.lastSeq <= events.length) {
      aff = cache.affect as Affect
      start = cache.lastSeq
    }

    for (let i = start; i < events.length; i++) {
      if (i > 0) applyElapse(aff, (events[i].ts - events[i - 1].ts) / 1000, t)
      this.applyEvent(aff, events[i], t)
    }

    this.store.writeCache({ lastSeq: events.length, affect: aff })
    return { affect: aff, fromSeq: start }
  }

  private applyEvent(aff: Affect, e: CreatureEvent, t: Temperament): void {
    if (e.t === 'episode') applyAppraisal(aff, e.appraisal, t)
    else if (e.t === 'absence') applyAbsence(aff, e.wakingHours)
    else if (e.t === 'contact') applyContact(aff, e.relief)
    else if (e.t === 'repair') applyRepair(aff, e.amount)
    // semantic / procedure / identity 是记忆事件，不参与情绪重放（no-op）
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

  /** 注入用记忆摘要：名字 + 最近几条活跃语义 + 教训。 */
  memorySummary(): { name: string | null; semantics: string[]; procedures: string[] } {
    const defaultPrefix = 'fish-'
    const name = this.meta.name && !this.meta.name.startsWith(defaultPrefix) ? this.meta.name : null
    const events = this.store.readEvents()
    const semantics = events
      .filter((e): e is Extract<CreatureEvent, { t: 'semantic' }> => e.t === 'semantic' && e.status === 'active')
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 2)
      .map(e => e.claim)
    const procedures = events
      .filter((e): e is Extract<CreatureEvent, { t: 'procedure' }> => e.t === 'procedure' && e.status === 'active')
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 1)
      .map(e => `${e.trigger} → ${e.action}`)
    const self = events
      .filter((e): e is Extract<CreatureEvent, { t: 'self' }> => e.t === 'self' && e.status === 'active' && e.confidence >= 0.5)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 2)
      .map(e => e.claim)
    return { name, semantics, procedures, self }
  }
}
