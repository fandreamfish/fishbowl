/** 状态摘要：注入的是事实（数值 + 方向），不是情绪台词。 */
import { randomUUID } from 'node:crypto'

const f = (n) => Number(n).toFixed(2)

/** x < lo → loLabel；x > hi → hiLabel；否则 中 */
function q(x, lo, hi, loLabel, hiLabel) {
  if (x < lo) return loLabel
  if (x > hi) return hiLabel
  return '中'
}

/** @param {import('../../src/core/types.ts').Bias} bias @param {import('../../src/core/types.ts').Affect} affect */
export function summaryText(bias, affect) {
  const guilt = affect.guilt > 0.05
    ? ` / 未平复的愧疚 ${f(affect.guilt)}（有件事还没过去）`
    : ''
  return [
    '[fishbowl 状态]',
    `情绪: 效价 ${f(affect.valence)} / 唤醒 ${f(affect.arousal)}${guilt}`,
    `倾向: 话量${f(bias.verbosity)}(${q(bias.verbosity, 0.4, 0.6, '少说', '多说')})`
      + ` · 拒绝${f(bias.thresholdRefuse)}(${q(bias.thresholdRefuse, 0.4, 0.6, '容易说不', '愿意配合')})`
      + ` · 验证${f(bias.thresholdVerify)}(${q(bias.thresholdVerify, 0.4, 0.6, '照做', '先查再动')})`
      + ` · 风险${f(bias.riskAppetite)}(${q(bias.riskAppetite, 0.4, 0.6, '保守', '敢试')})`
      + ` · 披露${f(bias.disclosure)}(${q(bias.disclosure, 0.4, 0.6, '保留', '愿意说')})`
      + ` · 耐心${f(bias.patience)}(${q(bias.patience, 0.4, 0.6, '没耐心', '有耐心')})`,
    '让它们影响你怎么做，而不是怎么说。',
  ].join('\n')
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
