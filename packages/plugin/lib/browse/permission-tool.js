/**
 * fish_ask_permission：她想做一件"本来会被挡住"的事，先问一声。
 *
 * 现在只开放一个动作：comment.post（在 B 站发评论/回复）。
 * 请求带上动作、对象、次数、期限；他点头之后才会签发一张许可，说话工具才会放行。
 */
import { workspaceOf } from '../../../app/src/index.js'
import { configFor } from '../../../app/src/index.js'

const ACTIONS = {
  'comment.post': { label: '在 B 站说一句话', uses: 1, ttlMs: 2 * 60 * 60_000, gate: 'comment' },
  // 看 B 站的许可按「今天」算：今天有效，第二天作废
  'browse': { label: '今天可以刷 B 站', uses: 20, ttlMs: 0, gate: 'browse', untilDayEnd: true },
}

/** 距离本地当天结束还有多久（毫秒）。 */
function msUntilDayEnd(now, tz) {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    const parts = Object.fromEntries(fmt.formatToParts(new Date(now)).map((p) => [p.type, p.value]))
    const h = Number(parts.hour) % 24
    const m = Number(parts.minute)
    const s = Number(parts.second)
    return Math.max(60_000, ((24 * 3600) - (h * 3600 + m * 60 + s)) * 1000)
  } catch { return 12 * 60 * 60_000 }
}

export function createPermissionTool(binding, cfg) {
  return {
    name: 'fish_ask_permission',
    description:
      '有些事得先问过他才能做。现在能申请的是"在 B 站说一句话"：'
      + '如果你今天看过某个视频、想说一句，但还没有得到允许，就用这个工具申请。'
      + '申请之后等他的回答；他不点，你就先不做。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: Object.keys(ACTIONS), description: '要申请的事' },
        target: { type: 'string', description: '对象：视频号（BV…）或评论编号' },
        reason: { type: 'string', description: '为什么想说（一句话）' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: { ok: { type: 'boolean' }, note: { type: 'string' } },
        required: ['ok', 'note'],
      },
      render: (_a, out) => [{ type: 'text', text: String(out?.note ?? '') }],
    },
    async execute(args, exec) {
      try {
        const session = exec?.agent?.session
        const sid = session?.id
        if (!sid) return { ok: false, note: '这一轮拿不到会话。' }
        const creature = binding.resolve({ sessionId: sid, workspace: workspaceOf(session) })
        if (!creature) return { ok: false, note: '这条会话里没有鱼住。' }
        const spec = ACTIONS[args?.action]
        if (!spec) return { ok: false, note: '这件事不能申请。' }
        const fcfg = configFor(cfg, creature)
        if (spec.gate === 'comment' && fcfg.comment?.enabled !== true) {
          return { ok: false, note: '现在还不能在外面说话（他没开这个口子）。' }
        }
        if (spec.gate === 'browse' && fcfg.browse?.enabled !== true) {
          return { ok: false, note: '现在打不开 B 站（他没开这个口子）。' }
        }
        if (spec.gate === 'comment' && fcfg.comment?.autoApprove === true) {
          return { ok: true, note: '他之前说过这类事不用每次问，直接说就行。' }
        }
        const target = String(args?.target ?? '').trim()
        const reason = String(args?.reason ?? '').trim()
        const ttlMs = spec.untilDayEnd ? msUntilDayEnd(Date.now(), cfg.timezone) : spec.ttlMs
        const span = spec.untilDayEnd ? '今天有效（到当天结束）' : `${Math.round(ttlMs / 60_000)} 分钟内有效`
        const text = `申请：${spec.label}${target ? '（' + target + '）' : ''}，${span}`
          + (reason ? `\n理由：${reason}` : '')
        creature.recordRequest(text, undefined, { action: args.action, target, uses: spec.uses, ttlMs })
        return { ok: true, note: '已经问他了，等他点头。' }
      } catch (err) {
        return { ok: false, note: '申请没发出去。' }
      }
    },
  }
}
