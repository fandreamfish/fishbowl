/**
 * fish_bili_speak：她在 B 站开口。
 *
 * 与 fish_bili_look 的分工：
 *   look  = 眼睛（只读，不留痕）
 *   speak = 嘴（写，会留在账号上；默认关，有配额）
 *
 * 她不知道配额、不知道开关、不知道被谁管着；被拒绝时只听到
 * 「现在不方便说」「今天说得够多了」这种状态，不是规则。
 */
import { workspaceOf } from '../../../app/src/index.js'
import { postComment, postReply } from '../../../bilibili/src/index.js'
import { configFor } from '../../../app/src/index.js'

export function createSpeakTool(binding, cfg) {
  return {
    name: 'fish_bili_speak',
    description:
      '在 B 站说一句话。可以给你今天看过的某个视频留一条评论，或者回一句别人留在你评论下面的话。'
      + '这是公开场合，别人看得见；不要提你们之间的事，也不要提他的私事。'
      + '不想说就不说，没有人等着你回答。',
    parameters: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['comment', 'reply'],
          description: 'comment=给视频留一条评论；reply=回别人留在你评论下面的话。',
        },
        bvid: { type: 'string', description: '在哪个视频（形如 BV1xx411c7mD）。' },
        text: { type: 'string', description: '要说的话。说人话，一两百字以内。' },
        parentRpid: {
          type: 'string',
          description: 'kind=reply 时，回复编号（材料里写着「回复编号 …」）。',
        },
      },
      required: ['kind', 'text'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          said: { type: 'string', description: '真正发出去的话' },
          note: { type: 'string' },
        },
        required: ['ok', 'said', 'note'],
      },
      render: (_args, out) => [{
        type: 'text',
        text: out?.ok ? `说出去了：「${String(out.said ?? '')}」` : `没说：${String(out.note ?? '')}`,
      }],
    },
    async execute(args, exec) {
      try {
        const session = exec?.agent?.session
        const sid = session?.id
        if (!sid) return { ok: false, said: '', note: '这一轮拿不到会话。' }
        const creature = binding.resolve({ sessionId: sid, workspace: workspaceOf(session) })
        if (!creature) return { ok: false, said: '', note: '这条会话里没有鱼住。' }
        if (configFor(cfg, creature).capabilities?.browse === false) return { ok: false, said: '', note: '我现在不上网，也就不在外面说话。' }
        if (args?.kind !== 'comment' && args?.kind !== 'reply') {
          return { ok: false, said: '', note: '要说哪种？评论还是回复。' }
        }
        const r = args.kind === 'reply'
          ? await postReply(creature, configFor(cfg, creature), {
            bvid: args?.bvid,
            parentRpid: args?.parentRpid,
            text: args?.text,
          })
          : await postComment(creature, configFor(cfg, creature), { bvid: args?.bvid, text: args?.text })
        return { ok: !!r.ok, said: String(r.said ?? ''), note: String(r.note ?? '') }
      } catch (err) {
        return { ok: false, said: '', note: '没说出来。' }
      }
    },
  }
}
