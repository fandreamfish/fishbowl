/** 状态摘要：注入的是事实（数值 + 方向），不是情绪台词。 */
import { randomUUID } from 'node:crypto'
import { renderStateBlock } from '../../memory/src/index.ts'

const f = (n) => Number(n).toFixed(2)

/** x < lo → loLabel；x > hi → hiLabel；否则 中 */
function q(x, lo, hi, loLabel, hiLabel) {
  if (x < lo) return loLabel
  if (x > hi) return hiLabel
  return '中'
}

/** 你们最近说过的话（原文，按时间）。跨会话共享同一份。 */
export function recentBlock(items, maxChars = 1500) {
  const list = (items ?? []).filter((i) => i && i.text)
  if (list.length === 0) return ''
  const lines = []
  let used = 0
  for (const it of list) {
    const time = new Date(it.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    const text = it.text.replace(/\s+/g, ' ').trim().slice(0, 220)
    const line = `[${time}] ${text}`
    if (used + line.length > maxChars) break
    lines.push(line)
    used += line.length
  }
  return lines.length ? '（你们之前说过的话，按时间）：\n' + lines.join('\n') : ''
}
/** 用户这句话触发的回忆：短、只说命中的。 */
export function recallBlock(claims) {
  const list = (claims ?? []).filter((c) => c && c.text)
  if (list.length === 0) return ''
  return '（他这句话让你想起：' + list.map((c) => c.text).join('；') + '）'
}

/**
 * 状态摘要（纯状态，不含记忆条目）：统一由 memory 包的 renderStateBlock 生成，
 * 这里只保留旧签名，避免两套格式漂移。
 * @param {object} bias
 * @param {object} affect
 * @param {{name?: string|null, semantics?: string[], procedures?: string[], self?: string[], commitments?: string[], activity?: string|null, folded?: number, requests?: object}} [memory]
 */
export function summaryText(bias, affect, memory) {
  return renderStateBlock({ ...(memory ?? {}), bias, affect })
}

/**
 * 注入消息的完整形状。
 * 事故教训：inject 的消息会被原样写进会话日志成为 user/message 表面事件，
 * 缺 role / id 会永久卡死该会话的 API 请求（422）。任何调用方都不要手拼。
 *
 * `wake` 是给收集器看的出处标记（不是给她看的）：
 *   - 普通状态块 / 回忆 / 基线：不带 wake，收集器照旧跳过，不进记忆；
 *   - 唤醒（联系型或自处型）：带 wake，收集器把这句话记成 `situation:`，
 *     这样"她为什么醒"就能进账本，总结不会替她编一个不存在的对方。
 *
 * @param {string} text
 * @param {{ mode?: 'contact'|'self', reason?: string|null }|null} [wake]
 */
export function injectMessage(text, wake = null) {
  return {
    role: 'user',
    id: randomUUID(),
    content: [{ type: 'text', text }],
    source: {
      kind: 'fishbowl',
      ...(wake && typeof wake === 'object'
        ? { wake: { mode: wake.mode === 'self' ? 'self' : 'contact', reason: wake.reason ?? null } }
        : {}),
    },
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
  const memPart = `${memory?.name ?? ''}|${memory?.semantics?.length ?? 0}:${memory?.procedures?.length ?? 0}:${memory?.self?.length ?? 0}:${memory?.commitments?.length ?? 0}:${memory?.activity ?? ''}:${memory?.folded ?? 0}:${memory?.requests?.pending?.length ?? 0}`
  return `${knobs}|${affectPart}|${guiltPart}|${memPart}`
}