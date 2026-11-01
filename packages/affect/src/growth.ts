/**
 * 成长率分层（DESIGN §8）：
 * 一个全局滑块 g，四层按固定相对速率联动，比例不变。
 * 战术学得飞快；自我认知极慢且证据门槛最高——性格改变得快，就等于没有性格。
 */

export type MemoryLayer = 'tactic' | 'preference' | 'relation' | 'self'

export const DEFAULT_LAYER_RATES: Record<MemoryLayer, number> = {
  tactic: 4,      // 战术：这类任务怎么做、工具怎么用
  preference: 1,  // 偏好：他喜欢什么、受不了什么
  relation: 0.5,  // 关系：信任、相处方式
  self: 0.1,      // 自我认知：我是什么样的人（强封顶）
}

/** 每层有效速率 = 相对速率 × g。 */
export function layerRate(layer: MemoryLayer, g: number): number {
  return DEFAULT_LAYER_RATES[layer] * Math.max(g, 0.1)
}

/** 每层触发间隔（轮）= 基准 12 轮 ÷ 有效速率。 */
export function layerInterval(layer: MemoryLayer, g: number, base = 12): number {
  return base / layerRate(layer, g)
}

/** 证据下限：单次事件永远不能定义身份层（DESIGN §8.1 护栏 3 的落地）。 */
export function minEvidence(layer: MemoryLayer): number {
  switch (layer) {
    case 'self': return 2
    case 'relation': return 3
    case 'preference': return 2
    default: return 1
  }
}

/**
 * 记忆窗口（天）：g 越高忘得越快。
 * 粗粒度落地 λ=λ0^g（DESIGN §8 原文的 λ0^(1/g) 是笔误，g 高必须忘得快，
 * 否则高 g 个体既学得快又顽固，与"善变"矛盾）。
 */
export function memoryWindowDays(g: number): number {
  return Math.max(7, 90 / Math.max(g, 0.1))
}

const RELATION_RE = /我们|关系|信任|约定|答应|承诺|感情|亲密/

/** 关系类事实的粗分类（用于更严的证据门槛）。 */
export function isRelationClaim(claim: string): boolean {
  return RELATION_RE.test(claim)
}
