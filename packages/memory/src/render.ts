/**
 * 注入渲染（docs/MEMORY.md §6）：骨架必出，态度可丢，预算按字数。
 * 这里只产出「她该记得什么」的文本，什么时候发出去由宿主决定。
 */
import { similarity } from './consolidate.ts'
import { weightOf } from './records.ts'
import type { MemoryRecord, TurnRecord } from './records.ts'

const f = (n: any) => Number(n ?? 0).toFixed(2)

function q(x: number, lo: number, hi: number, loLabel: string, hiLabel: string) {
  if (x < lo) return loLabel
  if (x > hi) return hiLabel
  return '中'
}

const timeOf = (ts: number) => {
  try {
    return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

export interface RenderInput {
  name?: string | null
  affect: any
  bias: any
  memories: MemoryRecord[]
  turns: TurnRecord[]
  commitments?: string[]
  budget: number
  memoryRatio: number
  turnRatio: number
  now?: number
}

/**
 * 按权重排序 + 同主题只出一条。
 * 不做多样性约束的话，三个名额会被三条同义改写占满。
 */
export function pickMemories(memories: MemoryRecord[], limit: number, now: number): MemoryRecord[] {
  const active = memories.filter((m) => m.status === 'active')
  active.sort((a, b) => weightOf(b, now) - weightOf(a, now))
  const picked: MemoryRecord[] = []
  for (const m of active) {
    if (picked.length >= limit) break
    if (picked.some((p) => similarity(p.claim, m.claim) >= 0.35)) continue
    picked.push(m)
  }
  return picked
}

export function renderText(input: RenderInput): { text: string; picked: string[] } {
  const now = input.now ?? Date.now()
  const mem = input.memories || []
  const budget = Math.max(200, Number(input.budget) || 900)

  const self = pickMemories(mem.filter((m) => m.kind === 'self'), 2, now)
  const facts = pickMemories(mem.filter((m) => m.kind !== 'self'), Math.max(0, Number(input.memoryRatio) || 0), now)
  const turns = (input.turns || [])
    .filter((t) => t.neutral)
    .slice(-Math.max(0, Number(input.turnRatio) || 0))
    .reverse()

  const parts: string[] = []
  let used = 0
  const line = (s: string, hard = false) => {
    if (!s) return false
    if (!hard && used + s.length > budget) return false
    parts.push(s)
    used += s.length
    return true
  }

  const a = input.affect || {}
  const guilt = Number(a.guilt ?? 0) > 0.05 ? ` / 未平复的愧疚 ${f(a.guilt)}（有件事还没过去）` : ''
  if (input.name) line(`名字: ${input.name}`, true)
  line(`情绪: 效价 ${f(a.valence)} / 唤醒 ${f(a.arousal)}${guilt}`, true)

  const b = input.bias || {}
  line(
    `倾向: 话量${f(b.verbosity)}(${q(b.verbosity, 0.4, 0.6, '少说', '多说')})`
      + ` · 拒绝${f(b.thresholdRefuse)}(${q(b.thresholdRefuse, 0.4, 0.6, '容易说不', '愿意配合')})`
      + ` · 验证${f(b.thresholdVerify)}(${q(b.thresholdVerify, 0.4, 0.6, '照做', '先查再动')})`
      + ` · 风险${f(b.riskAppetite)}(${q(b.riskAppetite, 0.4, 0.6, '保守', '敢试')})`
      + ` · 披露${f(b.disclosure)}(${q(b.disclosure, 0.4, 0.6, '保留', '愿意说')})`
      + ` · 耐心${f(b.patience)}(${q(b.patience, 0.4, 0.6, '没耐心', '有耐心')})`,
    true,
  )

  if (self.length) line(`自我认知: ${self.map((m) => m.claim).join('；')}`, true)

  const promises = (input.commitments || []).slice(-2)
  if (promises.length) line(`未完成的承诺: ${promises.join('；')}`, true)

  // 合并层：骨架必出，态度装得下才出
  for (const m of facts) {
    if (used + m.claim.length > budget) break
    let text = m.claim
    if (m.attitude && used + text.length + m.attitude.length + 4 <= budget) text += `（${m.attitude}）`
    line(`- ${text}`)
  }

  // 最近几轮：只给中性摘要（她的看法在下一层，不占这个预算）
  for (const t of turns) {
    const text = String(t.neutral || '').replace(/\s+/g, ' ').slice(0, 90)
    if (!text) continue
    line(`最近 ${timeOf(t.ts)}: ${text}`)
  }

  const retired = mem.filter((m) => m.status === 'retired').length
  if (retired > 0) line(`有些事记不清了（${retired} 件；想得起来再提）`)

  parts.push(
    '以上是瞬时快照（天气），不是人格（气候）。让它们影响你怎么做，而不是怎么说；'
      + '被问到你是什么样的人时：上面有「自我认知」就只按那些说，没有就照实说「我还没有足够的经历确定自己是什么样的人」，不要从情绪数字里编。',
  )

  return {
    text: ['[fishbowl 状态]', ...parts].join('\n'),
    picked: [...self, ...facts].map((m) => m.id),
  }
}

/** 粗粒度指纹：只在肉眼可见的变化时才值得重新注入。 */
export function fingerprint(memories: MemoryRecord[], affect: any, bias: any): string {
  const knobs = [bias?.verbosity, bias?.thresholdRefuse, bias?.thresholdVerify, bias?.riskAppetite, bias?.disclosure, bias?.patience]
    .map((v) => Math.round(Number(v ?? 0) * 10)).join(',')
  const a = [Math.round(Number(affect?.valence ?? 0) * 10), Math.round(Number(affect?.arousal ?? 0) * 10)].join(',')
  const act = memories.filter((m) => m.status === 'active').length
  const selfN = memories.filter((m) => m.status === 'active' && m.kind === 'self').length
  return `${knobs}|${a}|${Number(affect?.guilt ?? 0) > 0.05 ? 'g' : ''}|${memories.length}:${act}:${selfN}`
}
