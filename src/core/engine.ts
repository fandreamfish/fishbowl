/**
 * 认知内核：评价 → 情绪 → 决策偏置。
 * 纯函数，无 I/O。数值与 prototype/engine.py 严格一致（已校准版）。
 */
import { clip } from './util.ts'
import type { Affect, Appraisal, Bias, Temperament } from './types.ts'

export function salienceOf(a: Appraisal): number {
  return clip(
    0.35 * Math.abs(a.goalCongruence)
    + 0.25 * a.normViolation
    + 0.20 * Math.abs(a.relationalImpact)
    + 0.20 * a.stake,
    0, 1,
  )
}

/** 一次评价事件。先衰减，再加增量——与 Python 版一致。 */
export function applyAppraisal(aff: Affect, a: Appraisal, t: Temperament): void {
  const dv = (1.0 * a.goalCongruence * a.stake
    + 0.8 * a.relationalImpact
    - 1.2 * a.normViolation) * t.reactivity
  const da = (0.40 * Math.abs(a.goalCongruence)
    + 0.50 * a.normViolation
    + 0.25 * (1 - a.certainty)) * t.reactivity

  aff.valence = clip(
    t.baselineValence + t.decayRate * (aff.valence - t.baselineValence) + dv,
    -1, 1,
  )
  aff.arousal = clip(
    t.baselineArousal + 0.70 * (aff.arousal - t.baselineArousal) + da,
    0, 1,
  )
  aff.mood = 0.98 * aff.mood + 0.02 * aff.valence

  // 违诺累加，之后按天慢慢淡；repair 是更快的出口
  if (a.normViolation > 0) {
    aff.guilt = clip(aff.guilt + 1.2 * a.normViolation, 0, 1)
  }

  tagNamed(aff, a)
}

function tagNamed(aff: Affect, a: Appraisal): void {
  for (const k of Object.keys(aff.named)) {
    aff.named[k] *= 0.85
    if (aff.named[k] < 0.02) delete aff.named[k]
  }
  if (a.goalCongruence < -0.3 && a.agency > 0.4 && a.certainty > 0.5) {
    aff.named.frustrated = clip((aff.named.frustrated ?? 0) + Math.abs(a.goalCongruence), 0, 1)
  }
  if (a.normViolation > 0.2 && a.attribution === 'self') {
    aff.named.guilty = clip((aff.named.guilty ?? 0) + a.normViolation, 0, 1)
  }
  if (a.relationalImpact < -0.2 && a.attribution === 'other' && a.certainty < 0.6) {
    aff.named.wary = clip((aff.named.wary ?? 0) + Math.abs(a.relationalImpact), 0, 1)
  }
  if (a.certainty < 0.4 && a.stake > 0.5 && a.agency > 0.4) {
    aff.named.curious = clip((aff.named.curious ?? 0) + a.stake, 0, 1)
  }
  if (a.relationalImpact > 0.3) {
    aff.named.warm = clip((aff.named.warm ?? 0) + a.relationalImpact, 0, 1)
  }
}

/**
 * 心情自己会淡：所有项都随时间走，只是半衰期不同。
 * 愧疚和想念比效价慢得多（天级），但不会永远钉在同一格。
 */
export interface HalfLives { guilt: number; longing: number; named: number }
export const HALF_LIFE_DAYS: HalfLives = { guilt: 3, longing: 2, named: 2 }
const NAMED_FACTOR: Record<string, number> = { guilty: 1, wary: 1, warm: 1.5, frustrated: 0.5, curious: 0.25 }

const half = (x: number, halfLifeDays: number, days: number) => x * Math.pow(0.5, days / halfLifeDays)

/** 时间流逝。按真实秒数做半衰期式衰减；持久项只是慢一点，不是不动。 */
export function applyElapse(aff: Affect, seconds: number, t: Temperament, hl: HalfLives = HALF_LIFE_DAYS): void {
  if (seconds <= 0) return
  const k = Math.pow(t.decayRate, seconds / 60)
  aff.valence = t.baselineValence + k * (aff.valence - t.baselineValence)
  aff.arousal = t.baselineArousal + k * (aff.arousal - t.baselineArousal)
  const mk = Math.pow(0.98, seconds / 60)
  aff.mood = mk * aff.mood + (1 - mk) * aff.valence

  const days = seconds / 86_400
  aff.guilt = clip(half(aff.guilt, hl.guilt, days), 0, 1)
  aff.longing = clip(half(aff.longing, hl.longing, days), 0, 1)
  for (const key of Object.keys(aff.named)) {
    aff.named[key] = clip(half(aff.named[key], hl.named * (NAMED_FACTOR[key] ?? 1), days), 0, 1)
  }
}

/** 缺席累积。只在清醒时段累积（睡着时不想念）。想念本身是难受的。 */
export function applyAbsence(aff: Affect, wakingHours: number): void {
  aff.longing = clip(0.35 * Math.log1p(Math.max(wakingHours, 0)), 0, 1)
  aff.valence = clip(aff.valence - 0.35 * aff.longing, -1, 1)
}

/** 重逢：释放一部分想念（relief ∈ [0,1]）。 */
export function applyContact(aff: Affect, relief: number): void {
  aff.longing = clip(aff.longing * (1 - clip(relief, 0, 1)), 0, 1)
}

/** 修复违诺。 */
export function applyRepair(aff: Affect, amount: number): void {
  aff.guilt = clip(aff.guilt - amount, 0, 1)
}

/**
 * 死区：瞬态项归零。
 * 注意持久项（guilt / longing）不参与死区判定——它们本来就会随时间淡，不需要死区再归零。
 */
export function inDeadband(aff: Affect, t: Temperament): boolean {
  return Math.abs(aff.arousal - t.baselineArousal) < 0.12
    && Math.abs(aff.valence - aff.mood) < 0.15
}

/** 情绪 → 6 个旋钮。瞬态项被死区清零，持久项始终生效。 */
export function toBias(aff: Affect, t: Temperament): Bias {
  const quiet = inDeadband(aff, t)
  const v = quiet ? 0 : aff.valence
  const ar = quiet ? 0 : aff.arousal - t.baselineArousal
  const wary = aff.named.wary ?? 0

  return {
    verbosity: clip(0.5 + 0.30 * v - 0.40 * ar, 0, 1),
    thresholdRefuse: clip(0.5 + 0.40 * v - 0.25 * wary, 0, 1),
    thresholdVerify: clip(0.5 + 0.45 * aff.guilt + 0.30 * wary + 0.20 * ar, 0, 1),
    riskAppetite: clip(0.5 + 0.40 * ar - 0.25 * v, 0, 1),
    disclosure: clip(0.5 + 0.30 * v - 0.45 * wary + 0.30 * aff.longing, 0, 1),
    patience: clip(0.5 - 0.50 * ar + 0.20 * v, 0, 1),
  }
}
