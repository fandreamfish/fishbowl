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
}
