/**
 * 通道抽象（M3.1）：同一个体，多张"嘴"。
 * 每个通道有场合（register）：场合越公开，注入的记忆越少——
 * 私聊里的记忆不能在群里被引用（DESIGN §9 的披露边界）。
 */

export type ChannelRegister = 'intimate' | 'social' | 'public'

export interface ChannelSpec {
  id: string
  kind: 'dsm-session' | 'qq-private' | 'qq-group' | 'bilibili'
  register: ChannelRegister
}

export const CHANNELS: Record<string, ChannelSpec> = {
  'dsm-session': { id: 'dsm-session', kind: 'dsm-session', register: 'intimate' },
  'qq-private': { id: 'qq-private', kind: 'qq-private', register: 'intimate' },
  'qq-group': { id: 'qq-group', kind: 'qq-group', register: 'public' },
  bilibili: { id: 'bilibili', kind: 'bilibili', register: 'public' },
}

export interface MemoryForInjection {
  name: string | null
  semantics: string[]
  procedures: string[]
  self: string[]
  commitments: string[]
}

/**
 * 披露边界：
 *   intimate 全给（DSH 会话、QQ 私聊）
 *   social   只给名字（预留：朋友群等半公开场合）
 *   public   什么都不给（QQ 群、B 站——公开场合没有"我们的记忆"）
 */
export function memoryForChannel(memory: MemoryForInjection, register: ChannelRegister): MemoryForInjection {
  const empty = { name: memory.name ?? null, semantics: [], procedures: [], self: [], commitments: [] }
  if (register === 'intimate') return memory
  if (register === 'social') return empty
  return { ...empty, name: null }
}
