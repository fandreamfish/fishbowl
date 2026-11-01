/**
 * B 站登录 / 说话 / 被回复测试。全部假 fetch 或假 client，不向真实网络发请求。
 */
import fs from 'node:fs'
import path from 'node:path'
import { Creature } from '../../being/src/index.ts'
import { DEFAULT_TEMPERAMENT } from '../../affect/src/index.ts'
import { browseDayKey, slimItem } from '../../bilibili/src/index.js'
import { normalizeConfig } from '../../app/src/index.js'
import { authPath, clearCookie, mentionPrefix, parseCookieInput, publicAuth, readAuth, saveAccount, saveAuth } from '../../bilibili/src/index.js'
import { createClient, normalizeCookie } from '../../bilibili/src/index.js'
import {
  commentCountToday, commentStatus, herCommentsRecent, postComment, postReply, renderReplies,
  replyCountToday, scanDueReplies, scanReplies, seenReplyRpids,
} from '../../bilibili/src/index.js'
import { createSpeakTool } from '../lib/browse/speak-tool.js'
import { appendSeen } from '../../bilibili/src/index.js'

let failures = 0
function check(name: string, cond: boolean, detail = '') {
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${name}${detail ? '  ' + detail : ''}`)
  if (!cond) failures++
}

const TMP = path.join(process.cwd(), 'test-tmp', 'bili')
fs.rmSync(TMP, { recursive: true, force: true })
fs.mkdirSync(TMP, { recursive: true })

console.log('== 登录态 ==')
const parsed = parseCookieInput('SESSDATA=s1; bili_jct=j1; buvid3=b1; foo=drop')
check('只留 B 站 cookie 键', parsed.cookie.includes('SESSDATA=s1') && parsed.cookie.includes('bili_jct=j1') && !parsed.cookie.includes('foo='))
check('缺键会报出来', parseCookieInput('SESSDATA=s1').missing.includes('bili_jct'))
check('空输入缺 SESSDATA', parseCookieInput('').missing.includes('SESSDATA'))
check('cookie 头前缀被剥掉', normalizeCookie('Cookie: SESSDATA=s1; bili_jct=j1').includes('SESSDATA=s1'))
const pub = publicAuth({ cookie: 'SESSDATA=secret', account: { mid: 9, name: '小鱼' }, mid: '9', nickname: '主人' })
check('公开视图不含 cookie 原文', !JSON.stringify(pub).includes('secret') && pub.hasCookie === true && pub.hasCsrf === false)
check('cookie 有 bili_jct 才算能写', publicAuth({ cookie: 'SESSDATA=s1; bili_jct=j1' }).hasCsrf === true)
check('@ 前缀昵称空格转下划线', mentionPrefix({ nickname: 'A B' }, { atOwner: true }) === '@A_B ')
check('关掉 @ 就不加', mentionPrefix({ nickname: 'A' }, { atOwner: false }) === '')

const authDir = path.join(TMP, 'auth-state', 'creatures')
fs.mkdirSync(authDir, { recursive: true })
const saved = saveAuth(authDir, { cookie: 'SESSDATA=s1; bili_jct=j1', mid: '9', nickname: '主人' })
check('cookie 落盘成功', saved.ok === true && fs.existsSync(authPath(authDir)))
check('cookie 在盘上', String(readAuth(authDir)?.cookie ?? '').includes('SESSDATA=s1'))
check('落盘后公开视图不吐 cookie', !JSON.stringify(publicAuth(readAuth(authDir))).includes('s1'))
saveAccount(authDir, { mid: 9, uname: '小鱼' })
check('测试登录写 account', readAuth(authDir)?.account?.name === '小鱼')
clearCookie(authDir)
check('清除 cookie 保留主人', !readAuth(authDir)?.cookie && readAuth(authDir)?.nickname === '主人')

console.log('== 客户端写接口（假 fetch） ==')
function json(obj: any) {
  return { ok: true, status: 200, text: async () => JSON.stringify(obj), json: async () => obj, arrayBuffer: async () => new Uint8Array() }
}
const calls: { url: string; body: string }[] = []
const fakeFetch = async (url: string, init: any = {}) => {
  calls.push({ url: String(url), body: String(init.body ?? '') })
  if (String(url).includes('/x/web-interface/nav')) return json({ code: 0, data: { isLogin: true, uname: '小鱼', mid: 9 } })
  if (String(url).includes('/x/v2/reply/add')) return json({ code: 0, data: { rpid: 12345 } })
  return json({ code: 0, data: null })
}
const c = createClient({ fetchImpl: fakeFetch, cookie: 'SESSDATA=s1; bili_jct=j1', minIntervalMs: 1, jitterMs: 0 })
const me = await c.me()
check('me 认出登录且能写', me.isLogin && me.canWrite && me.mid === 9)
check('写评论返回 rpid', (await c.replyAdd(1, '你好')).data.rpid === 12345)
check('写评论带 csrf', calls.some((x) => x.url.includes('/x/v2/reply/add') && x.body.includes('csrf=j1')))
const rr = await c.replyReply(1, 100, 200, '回你')
check('楼中楼带 root/parent', rr.ok && calls.some((x) => x.body.includes('root=100') && x.body.includes('parent=200')))
const noCookie = createClient({ fetchImpl: fakeFetch, minIntervalMs: 1, jitterMs: 0 })
check('没 cookie 写不了', (await noCookie.replyAdd(1, 'x')).code === 'NOT_LOGIN')

console.log('== 评论 / 回复 / 配额 ==')
const stateDir = path.join(TMP, 'state', 'creatures')
fs.mkdirSync(stateDir, { recursive: true })
check('评论默认关', normalizeConfig({}).comment.enabled === false)
check('评论默认配额', normalizeConfig({}).comment.perDay === 1 && normalizeConfig({}).comment.replyPerDay === 2)
const cfg = normalizeConfig({
  stateDir,
  timezone: 'Asia/Shanghai',
  comment: { enabled: true, perDay: 1, replyPerDay: 2, replyToReplies: true, scanEveryMin: 30, window: ['00:00', '23:59'], atOwner: true },
})
saveAuth(stateDir, { cookie: 'SESSDATA=s1; bili_jct=j1', mid: '9', nickname: '主人' })
saveAccount(stateDir, { mid: 9, uname: '小鱼' })
const fish = Creature.create(path.join(stateDir, 'fish1'), {
  schemaVersion: 1,
  creatureId: 'bili-fixture',
  name: '说话测试鱼',
  bornAt: new Date(0).toISOString(),
  timezone: 'Asia/Shanghai',
  model: { id: 'test', pinned: true },
  temperament: DEFAULT_TEMPERAMENT,
})
const day = browseDayKey(Date.now(), 'Asia/Shanghai')
appendSeen(fish, { ts: Date.now(), day, status: 'ok', items: [slimItem({ bvid: 'BV1aaaaaaaaa', title: '看过的' })] })

const fakeCommentClient = {
  view: async () => ({ ok: true, data: { aid: 111 } }),
  replyAdd: async () => ({ ok: true, code: 0, data: { rpid: 2001 } }),
  replyReply: async () => ({ ok: true, code: 0, data: { rpid: 2002 } }),
  subReplies: async () => ({ ok: true, data: [] }),
}
const c1 = await postComment(fish, cfg, { bvid: 'BV1aaaaaaaaa', text: '这条好看', client: fakeCommentClient })
check('评论成功并 @ 主人', c1.ok && c1.said === '@主人 这条好看')
check('评论记账 1 条', commentCountToday(fish, day) === 1)
const c2 = await postComment(fish, cfg, { bvid: 'BV1aaaaaaaaa', text: '再说一次', client: fakeCommentClient })
check('同一条今天不重复评', c2.ok === false)
const c3 = await postComment(fish, cfg, { bvid: 'BV1bbbbbbbbb', text: '没看过', client: fakeCommentClient })
check('没看过的不让评', c3.ok === false && c3.note.includes('没看过'))
const r1 = await postReply(fish, cfg, { bvid: 'BV1aaaaaaaaa', parentRpid: 3001, text: '回你一句', client: fakeCommentClient })
check('回复成功且不带 @', r1.ok && r1.said === '回你一句')
check('回复记账 1 条', replyCountToday(fish, day) === 1)
check('回过的回复记 seen', seenReplyRpids(fish).has(3001))

const scanClient = {
  view: async () => ({ ok: true, data: { aid: 111 } }),
  subReplies: async () => ({
    ok: true,
    data: [
      { rpid: 4001, mid: 77, user: '陌生人', text: '说得不错', ctime: 1 },
      { rpid: 4002, mid: 9, user: '小鱼', text: '我自己补的', ctime: 2 },
    ],
  }),
}
const waiting = await scanReplies(fish, cfg, { client: scanClient })
check('扫到别人回她的', waiting.length === 1 && waiting[0].rpid === 4001)
check('回复素材带回复编号', renderReplies(waiting).includes('回复编号 4001'))
const due = await scanDueReplies(fish, cfg, { client: scanClient, force: true })
check('到期扫描返回素材', due.items.length === 1 && due.text.includes('陌生人'))

const st = commentStatus(fish, cfg)
check('状态：今天 1 条评论 / 1 条回复', st.commentToday === 1 && st.replyToday === 1)
check('状态：最近评论可读', st.recent.length >= 1 && herCommentsRecent(fish, 7).length >= 1)

console.log('== 工具 ==')
const tool = createSpeakTool({ resolve: () => fish }, cfg)
check('工具名', tool.name === 'fish_bili_speak')
check('工具 schema 完整', tool.parameters.type === 'object' && tool.parameters.required.includes('kind'))
const offCfg = normalizeConfig({ stateDir, comment: { enabled: false } })
const toolOff = createSpeakTool({ resolve: () => fish }, offCfg)
const off = await toolOff.execute({ kind: 'comment', bvid: 'BV1aaaaaaaaa', text: 'x' }, { agent: { session: { id: 's1', header: { cwd: 'D:\\ws' } } } })
check('关着时只说不方便', off.ok === false && off.note === '现在不方便说。')

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURES'}`)
if (failures) process.exit(1)
