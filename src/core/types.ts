/** Core types: temperament, appraisal, affect, bias, and the creature event log. */

export interface Temperament {
  /** 情绪反应强度：同一事件产生多大 Δ */
  reactivity: number
  /** 基线唤醒度 */
  baselineArousal: number
  /** 底色（偏乐观 / 偏悲观） */
  baselineValence: number
  /** 情绪消退速度（按事件与按时间共用） */
  decayRate: number
  /** 什么值得注意 */
  salienceThreshold: number
}

/** 出生参数。不是人格描述——人格由经历长出来。 */
export const DEFAULT_TEMPERAMENT: Temperament = {
  reactivity: 1.0,
  baselineArousal: 0.35,
  baselineValence: 0.0,
  decayRate: 0.85,
  salienceThreshold: 0.3,
}

export type Attribution = 'self' | 'other' | 'circumstance'

/** 评价器输出：固定 7 维。永远不存自由文本。 */
export interface Appraisal {
  goalCongruence: number // [-1,1] 对当前目标有利/有害
  agency: number         // [0,1]   是我造成的 / 外部造成的
  certainty: number      // [0,1]   我是否理解发生了什么
  normViolation: number  // [0,1]   是否触及宪章或已有承诺
  relationalImpact: number // [-1,1] 对关系的增益/损耗
  stake: number          // [0,1]   涉及的东西我有多在意
  attribution: Attribution
}

export function appraisal(partial: Partial<Appraisal> = {}): Appraisal {
  return {
    goalCongruence: 0,
    agency: 0,
    certainty: 1,
    normViolation: 0,
    relationalImpact: 0,
    stake: 0,
    attribution: 'circumstance',
    ...partial,
  }
}

export interface Affect {
  valence: number
  arousal: number
  mood: number
  /** 缺席累积（想念）。持久项，不受死区影响。 */
  longing: number
  /** 未修复的违诺。持久项，只随 repair / contact 变化，不随情绪衰减。 */
  guilt: number
  /** 具名状态：frustrated / guilty / wary / curious / warm */
  named: Record<string, number>
}

export function freshAffect(t: Temperament): Affect {
  return {
    valence: t.baselineValence,
    arousal: t.baselineArousal,
    mood: 0,
    longing: 0,
    guilt: 0,
    named: {},
  }
}

/** 6 个决策旋钮。情绪的全部作用面。 */
export interface Bias {
  verbosity: number
  thresholdRefuse: number
  thresholdVerify: number
  riskAppetite: number
  disclosure: number
  patience: number
}

export const BASELINE_BIAS: Bias = {
  verbosity: 0.5,
  thresholdRefuse: 0.5,
  thresholdVerify: 0.5,
  riskAppetite: 0.5,
  disclosure: 0.5,
  patience: 0.5,
}

/**
 * 个体事件日志的最小语法。
 * 只有这些事件能改变它——这正是"唯一引起变化的是对话与自主行为"的落地。
 */
export type CreatureEvent =
  | { t: 'episode'; id: string; ts: number; kind: string; appraisal: Appraisal; salience: number; note?: string }
  // —— M17：记忆系统的 turn 记录。appraisal/salience 供情绪重放，其余字段归记忆系统 ——
  | {
    t: 'turn'; id: string; ts: number; note?: string; appraisal?: Appraisal; salience?: number
    scope?: unknown; raw?: unknown; injected?: string[]; tags?: string[]
    summaryState?: string; affectPeak?: unknown; affectAtWrite?: unknown
  }
  | { t: 'absence'; id: string; ts: number; wakingHours: number }
  | { t: 'contact'; id: string; ts: number; relief: number }   // relief ∈ [0,1]：重逢释放多少想念
  | { t: 'repair'; id: string; ts: number; amount: number }    // 修复违诺，减少愧疚
  // —— M2：记忆层（LLM 巩固产物，必须落盘，不参与情绪重放） ——
  | { t: 'semantic'; id: string; ts: number; claim: string; evidence: string[]; confidence: number; status: 'active' | 'retired' }
  | { t: 'procedure'; id: string; ts: number; trigger: string; action: string; evidence: string[]; confidence: number; status: 'active' | 'retired' }
  // —— M2：身份（接受名字是事件，meta.name 是权威） ——
  | { t: 'identity'; id: string; ts: number; name: string }
  // —— M2.2：自我认知（只读投影；证据门槛之外不许自述） ——
  | { t: 'self'; id: string; ts: number; claim: string; evidence: string[]; confidence: number; status: 'active' | 'retired' }
  // —— M2.4：承诺（说出口的"我会做"；broken 不消失——没翻篇） ——
  | { t: 'commitment'; id: string; ts: number; text: string }
  | { t: 'commitment-resolved'; id: string; ts: number; ref: string; status: 'fulfilled' | 'broken' }
  // —— M3.2：共享活动（一起看/读/学） ——
  | { t: 'activity'; id: string; ts: number; title: string; status: 'started' | 'ended' }
  // —— M6：记忆强化（同一件事被再次提到 → 重量上升，不是重复落盘） ——
  | { t: 'reinforce'; id: string; ts: number; ref: string }
  // —— M7：日记 / 小纸条 / 请求 ——
  | { t: 'diary'; id: string; ts: number; date: string; text: string }
  | { t: 'note'; id: string; ts: number; text: string }
  | { t: 'request'; id: string; ts: number; text: string }
  | { t: 'request-answered'; id: string; ts: number; ref: string; answer: 'yes' | 'no' }
  // —— M4：封存（停止时间：不经历、不缺席、不想念） ——
  | { t: 'freeze'; id: string; ts: number }
  | { t: 'unfreeze'; id: string; ts: number }

/** 四条不变量随目录走：模型、时区、schema、气质。 */
export interface CreatureMeta {
  schemaVersion: 1
  creatureId: string
  name: string
  bornAt: string
  timezone: string
  model: { id: string; pinned: true }
  temperament: Temperament
  /** M7：住处（工作区或会话）；空 = 未分配，任何会话都不归她。 */
  occupancy?: { kind: 'workspace' | 'session'; id: string; workspace?: string } | null
}
