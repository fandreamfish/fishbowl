/** 状态摘要：注入的是事实（数值 + 方向），不是情绪台词。 */
import { randomUUID } from 'node:crypto'

const f = (n) => Number(n).toFixed(2)

/** x < lo → loLabel；x > hi → hiLabel；否则 中 */
function q(x, lo, hi, loLabel, hiLabel) {
  if (x < lo) return loLabel
  if (x > hi) return hiLabel
  return '中'
}

/** @param {import('../../src/core/types.ts').Bias} bias @param {import('../../src/core/types.ts').Affect} affect @param {{name?: string|null, semantics?: string[], procedures?: string[], self?: string[]}} [memory] */
export function summaryText(bias, affect, memory) {
  const mem = memory ?? { name: null, semantics: [], procedures: [], self: [] }
  const guilt = affect.guilt > 0.05
    ? ` / 未平复的愧疚 ${f(affect.guilt)}（有件事还没过去）`
    : ''
  const parts = ['[fishbowl 状态]']
  if (mem.name) parts.push(`名字: ${mem.name}`)
  parts.push(
    `情绪: 效价 ${f(affect.valence)} / 唤醒 ${f(affect.arousal)}${guilt}`,
    `倾向: 话量${f(bias.verbosity)}(${q(bias.verbosity, 0.4, 0.6, '少说', '多说')})`
      + ` · 拒绝${f(bias.thresholdRefuse)}(${q(bias.thresholdRefuse, 0.4, 0.6, '容易说不', '愿意配合')})`
      + ` · 验证${f(bias.thresholdVerify)}(${q(bias.thresholdVerify, 0.4, 0.6, '照做', '先查再动')})`
      + ` · 风险${f(bias.riskAppetite)}(${q(bias.riskAppetite, 0.4, 0.6, '保守', '敢试')})`
      + ` · 披露${f(bias.disclosure)}(${q(bias.disclosure, 0.4, 0.6, '保留', '愿意说')})`
      + ` · 耐心${f(bias.patience)}(${q(bias.patience, 0.4, 0.6, '没耐心', '有耐心')})`,
  )
  if (mem.semantics?.length) parts.push(`记得的事: ${mem.semantics.join('；')}`)
  if (mem.procedures?.length) parts.push(`教训: ${mem.procedures.join('；')}`)
  if (mem.self?.length) parts.push(`自我认知: ${mem.self.join('；')}`)
  parts.push(
    '以上是瞬时快照（天气），不是人格（气候）。让它们影响你怎么做，而不是怎么说；'
      + '被问到你是什么样的人时：上面有"自我认知"就只按那些说，没有就照实说"我还没有足够的经历确定自己是什么样的人"，不要从情绪数字里编。',
  )
  return parts.join('\n')
}

/**
 * 注入消息的完整形状。
 * 事故教训：inject 的消息会被原样写进会话日志成为 user/message 表面事件，
 * 缺 role / id 会永久卡死该会话的 API 请求（422）。任何调用方都不要手拼。
 */
export function injectMessage(text) {
  return {
    role: 'user',
    id: randomUUID(),
    content: [{ type: 'text', text }],
    source: { kind: 'fishbowl' },
  }
}

/**
 * 状态粗粒度指纹：只在"肉眼可见的变化"时才注入。
 * 直接比较文本没用——衰减让数值每轮漂移 0.001，文本永远不同。
 * 量化到 0.1 之后，微小漂移被吸收，真正的事件（如情绪砸到 -0.6）才会触发注入。
 */
export function stateKey(bias, affect, memory) {
  const knobs = [bias.verbosity, bias.thresholdRefuse, bias.thresholdVerify,
    bias.riskAppetite, bias.disclosure, bias.patience]
    .map(v => Math.round(v * 10)).join(',')
  const affectPart = [Math.round(affect.valence * 10), Math.round(affect.arousal * 10)].join(',')
  const guiltPart = affect.guilt > 0.05 ? 'g' : ''
  const memPart = `${memory?.name ?? ''}|${memory?.semantics?.length ?? 0}:${memory?.procedures?.length ?? 0}:${memory?.self?.length ?? 0}`
  return `${knobs}|${affectPart}|${guiltPart}|${memPart}`
}
