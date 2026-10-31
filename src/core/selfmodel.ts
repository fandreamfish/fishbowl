/**
 * 自我认知层：跨场景稳定的行为倾向。
 * 与巩固（记忆）分开，因为这里守一条硬规则：
 * 单次事件不能定义"我"——少于 2 个独立证据的自我描述直接丢弃。
 * 这对应 DESIGN.md §8.1 护栏 3：任何自我认知级改变至少需 2 个独立事件。
 */
import { DEFAULT_LAYER_RATES } from './growth.ts'

/**
 * 触发规则：极慢（默认 12 ÷ (0.1×g) 轮，g=1 时 120 轮），且有冷却。
 * interval 参数仅用于测试/冒烟缩短周期。
 */
export function shouldSelfConsolidate(opts: { episodesSince: number; sinceLast: number; g: number; interval?: number }): boolean {
  const g = Math.max(opts.g, 0.1)
  const every = opts.interval ?? 12 / (DEFAULT_LAYER_RATES.self * g)
  if (opts.sinceLast < Math.max(3, every / 2)) return false
  return opts.episodesSince >= every
}

export const SELF_SYSTEM_PROMPT = [
  '你是自我认知巩固器。给你一个 AI 与用户最近的对话转录（user: / assistant: 格式，行号从 1 开始），',
  '归纳"我（AI）表现出什么稳定的行为倾向"。只输出 JSON：',
  '{ "self": [ {"claim": "…", "evidence": ["2","5","8"], "confidence": 0.7} ] }',
  '规则：',
  '- claim 是跨多个场景稳定的行为倾向（例如"被否定时倾向于先问清楚而不是辩解"），不是瞬时情绪，不是关于用户的事实。',
  '- 瞬时状态不算：一次生气不等于"我容易生气"；只有同类反应在 ≥2 个不同场景反复出现才算。',
  '- evidence 用行号指证，每条 claim 至少 2 个证据行。',
  '- 材料不足就输出空数组，禁止编造。总数 ≤ 3。',
  '- 输入里会列出"你已经认定的自我描述"：不要重复输出。',
  '- 不要输出 JSON 以外的任何内容。',
].join('\n')

export interface ParsedSelf { claim: string; evidence: string[]; confidence: number }

/** 防御性解析 + 证据门槛：<2 个证据的自我描述直接拒绝。 */
export function parseSelf(text: string): ParsedSelf[] {
  try {
    const json = JSON.parse((text.match(/\{[\s\S]*\}/) || ['{}'])[0])
    return (Array.isArray(json.self) ? json.self : [])
      .slice(0, 3)
      .filter((s) => typeof s?.claim === 'string' && s.claim.trim().length > 0)
      .map((s) => ({
        claim: s.claim.trim(),
        evidence: (Array.isArray(s.evidence) ? s.evidence.filter((x): x is string => typeof x === 'string') : []).slice(0, 8),
      }))
      .filter((s) => s.evidence.length >= 2) // 证据门槛：单次事件不能定义"我"
      .map((s) => ({ ...s, confidence: Math.min(1, s.evidence.length / 3) }))
  } catch {
    return []
  }
}

/** 本地去重（LLM 不听话时的第二道闸）。 */
export function dedupeSelf(parsed: ParsedSelf[], existing: string[]): ParsedSelf[] {
  return parsed.filter(s => !existing.includes(s.claim))
}
