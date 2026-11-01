/**
 * 状态块的唯一组装处。
 *
 * 之前 DSH 与 QQ 各拼各的，导致 QQ 看不到许可/请求/违约。这里按渠道决定
 * 哪些片段能出现，内容生成只写一遍。
 */
import { breachLine, permitLine } from '../../being/src/index.ts'
import { recentDialog } from '../../being/src/index.ts'
import { grantLine } from './grant.js'
import { recentBlock } from './injector.js'

/**
 * @param {object} input
 * @param {object} input.creature
 * @param {{ render: Function }} input.mem
 * @param {object} input.affect
 * @param {object} input.bias
 * @param {string[]} [input.commitments]
 * @param {'dsh'|'qq'} [input.channel]
 * @returns {{ text: string, picked: string[] }}
 */
export function composeState({ creature, mem, affect, bias, commitments, channel = 'dsh', now = Date.now() }) {
  const snap = mem.render({ affect, bias, name: creature.meta.name, commitments, now })
  const parts = [snap.text]

  // 公开渠道（QQ）只放状态，不放私事：许可以下的东西一律不出现。
  if (channel !== 'dsh') return { text: parts.join('\n'), picked: snap.picked }

  try {
    const grant = grantLine(creature)
    if (grant) parts.push(`他允许你的事: ${grant}`)
  } catch { /* 许可读不出来不影响状态 */ }

  try {
    const req = creature.requestDigest(now)
    const lines = []
    if (req.pending.length) lines.push(`还在等回音: ${req.pending.join('；')}`)
    if (req.answered.length) {
      lines.push(`他答过的: ${req.answered.map((r) => `${r.text}（${r.answer === 'yes' ? '同意' : '不同意'}）`).join('；')}`)
    }
    if (lines.length) parts.push(lines.join('\n'))
  } catch { /* 同上 */ }

  try {
    const perm = permitLine(creature, now)
    if (perm) parts.push(`你现在被允许: ${perm}`)
  } catch { /* 同上 */ }

  try {
    const breach = breachLine(creature, now)
    if (breach) parts.push(breach)
  } catch { /* 同上 */ }

  try {
    const recent = recentBlock(recentDialog(creature, 6))
    if (recent) parts.push(recent)
  } catch { /* 同上 */ }

  return { text: parts.join('\n'), picked: snap.picked }
}
