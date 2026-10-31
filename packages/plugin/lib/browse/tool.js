/**
 * fish_bili_look：她自己的眼睛。
 *
 * 为什么给她一个"主动看"的工具，而不是只让她被动接受推送：
 *   「能不能自己决定看什么」是自主唯一可验证的载体。
 *
 * 三条约束：
 *   1. 只读匿名：不点赞、不评论、不登录；
 *   2. 不回显状态：返回值只有素材，没有「你今天还剩几次」；
 *   3. 不给她配置：她不知道有黑名单/配额；被过滤掉的东西她也不会知道。
 *
 * 零依赖：直接给注册表认的 JSON Schema，不 import dsh-tools。
 */
import { workspaceOf } from '../extract.js'
import { inSelfTime, lookForCreature } from './runtime.js'

export function createBrowseTool(binding, cfg) {
  return {
    name: 'fish_bili_look',
    description:
      '去 B 站看一眼：首页在推什么、搜一个词、看某条视频之后平台又接着推什么，'
      + '或者直接看指定的那一条（给 BV 号或链接）。'
      + '只读，不会留下痕迹。给你的是标题、简介、标签、热评、弹幕——没有视频画面。'
      + '不用它也可以。',
    parameters: {
      type: 'object',
      properties: {
        what: {
          type: 'string',
          enum: ['home', 'search', 'related', 'video'],
          description: 'home=首页推给你的；search=你自己搜（要带 keyword）；related=接着某条往下看（要带 bvid）；video=看指定的那一条（要带 bvid）。',
        },
        keyword: { type: 'string', description: 'what=search 时搜什么。' },
        bvid: { type: 'string', description: 'what=related 时从哪条接着看；what=video 时看哪一条（BV 号，或者他递过来的链接）。' },
      },
      required: ['what'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          text: { type: 'string', description: '看到的素材' },
          note: { type: 'string' },
        },
        required: ['ok', 'text', 'note'],
      },
      render: (_args, out) => [{
        type: 'text',
        text: out?.ok ? String(out.text ?? '') : `这次没看到什么：${String(out?.note ?? '')}`,
      }],
    },
    async execute(args, exec) {
      try {
        const session = exec?.agent?.session
        const sid = session?.id
        if (!sid) return { ok: false, text: '', note: '这一轮拿不到会话。' }
        const creature = binding.resolve({ sessionId: sid, workspace: workspaceOf(session) })
        if (!creature) return { ok: false, text: '', note: '这条会话里没有鱼住。' }
        const what = ['home', 'search', 'related', 'video'].includes(args?.what) ? args.what : 'home'
        const selfTime = inSelfTime(creature.meta.creatureId)
        const r = await lookForCreature(creature, cfg, {
          what,
          keyword: args?.keyword,
          bvid: args?.bvid,
          mode: selfTime ? 'self' : 'tool',
          // 自处回合里按配额收紧；用户让她现在看则不受配额限制。
          selfTime,
          // 用户让她现在看，就不受「上网时段」限制；硬开关与风控仍然生效。
          force: true,
        })
        return { ok: !!r.ok, text: String(r.text ?? ''), note: String(r.note ?? '') }
      } catch (err) {
        return { ok: false, text: '', note: String(err?.message ?? err).slice(0, 120) }
      }
    },
  }
}
