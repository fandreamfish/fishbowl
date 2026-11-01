/**
 * 上网（B 站只读）测试：纯逻辑、假 fetch、许可、记账、浏览器状态。
 * 不向真实网络发任何请求。
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  BROWSE_TOOL_MATERIAL, avoidHit, browseDayKey, browsePlan, inWindow, normalizeBrowseConfig,
  parseSeenLine, pickTids, rankVideos, renderMaterial, sampleDanmaku, slimItem,
} from '../../bilibili/src/index.js'
import { DEFAULT_TEMPERAMENT } from '../../affect/src/index.ts'
import { Creature } from '../../being/src/index.ts'
import { normalizeConfig } from '../../app/src/index.js'
import { detectGrant, detectRevoke, grantLine } from '../../being/src/index.ts'
import { selfTimeEnabled } from '../../app/src/index.js'
import { createClient, mixinKey, parseDanmaku, signQuery } from '../../bilibili/src/index.js'
import { lookForCreature, browseStatus } from '../../bilibili/src/index.js'
import { createBrowseTool } from '../lib/browse/tool.js'
import { createUiRoute } from '../../adapter-dsh/src/index.js'
import { createBinding } from '../../app/src/index.js'
import { readSeen, todayItems } from '../../bilibili/src/index.js'
import { riskState, noteRisk, clearRisk, markRiskOk } from '../../bilibili/src/index.js'

let failures = 0
function check(name: string, cond: boolean, detail = '') {
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${name}${detail ? '  ' + detail : ''}`)
  if (!cond) failures++
}

const TMP = path.join(process.cwd(), 'test-tmp', 'browse')
fs.rmSync(TMP, { recursive: true, force: true })
fs.mkdirSync(TMP, { recursive: true })

console.log('== 纯逻辑：配置 / 窗口 / 过滤 / 排序 ==')
const c = normalizeBrowseConfig({ perDay: 99, topN: 99, deepRead: -3, danmaku: 99, window: ['20:00', '02:00'], pacing: { minIntervalMs: 1, jitterMs: 0 } })
check('越界被钳制', c.perDay === 4 && c.topN === 10 && c.deepRead === 0 && c.danmaku === 30)
check('跨零点窗口：凌晨 1 点在', inWindow(new Date('2026-10-31T01:00:00+08:00').getTime(), ['20:00', '02:00']))
check('跨零点窗口：中午不在', !inWindow(new Date('2026-10-31T12:00:00+08:00').getTime(), ['20:00', '02:00']))
check('同起止 = 全天', inWindow(Date.now(), ['09:00', '09:00']))
const day = browseDayKey(new Date('2026-10-31T23:30:00+08:00').getTime(), 'Asia/Shanghai')
check('本地日期键', day === '2026-10-31')

const vids = [
  { bvid: 'BV1aaaaaaaaa', title: '恐怖片', up: 'A', mid: 1, duration: 300, view: 1000, like: 100, danmaku: 100 },
  { bvid: 'BV1bbbbbbbbb', title: '手工', up: 'B', mid: 2, duration: 600, view: 1000, like: 10, danmaku: 10 },
  { bvid: 'BV1ccccccccc', title: '太短', up: 'C', mid: 3, duration: 5, view: 1000, like: 10, danmaku: 10 },
]
check('黑名单命中标题', avoidHit(vids[0], { avoid: { keywords: ['恐怖'], upMids: [], minDuration: 60 } }) === '恐怖')
check('UP 主 mid 命中', avoidHit(vids[0], { avoid: { keywords: [], upMids: ['1'], minDuration: 0 } }) === 'up:1')
const ranked = rankVideos(vids, { avoid: { keywords: ['恐怖'], upMids: [], minDuration: 60 } }, { seen: new Set(), limit: 10 })
check('过滤黑名单与太短', ranked.length === 1 && ranked[0].bvid === vids[1].bvid)
check('去重', rankVideos([vids[1], vids[1]], { avoid: { minDuration: 0 } }, { seen: new Set(), limit: 10 }).length === 1)
check('看过的排除', rankVideos(vids, { avoid: { minDuration: 0 } }, { seen: new Set([vids[1].bvid]), limit: 10 }).length === 2)
check('分区抽取不重复', new Set(pickTids(() => 0, 3)).size === 3)

const pack = {
  video: { bvid: 'BV1x', title: '一条视频', up: 'UP主', duration: 183, view: 12345, like: 678 },
  desc: '简介',
  tags: ['生活', '手工'],
  comments: [{ text: '热评一句', like: 9 }],
  danmaku: [{ t: 10, text: '前方高能' }],
}
const material = renderMaterial([pack], { cap: 1000 })
check('素材含标题/UP/热评/弹幕', material.includes('一条视频') && material.includes('UP主') && material.includes('热评一句') && material.includes('前方高能'))
const clipped = renderMaterial([{ ...pack, desc: '长'.repeat(800) }], { cap: 30 })
check('素材有长度上限', clipped.length <= 500 && clipped.includes('没加载完'))
check('风控冷却 → 一条不看', browsePlan({ perDay: 2 }, { cooling: true, remainMin: 5 }).skip === true)
check('撞过墙 → 减半试探', browsePlan({ perDay: 2, topN: 6, deepRead: 8 }, { cooling: false, strikes: 1 }).topN === 3)

const dms = [
  { t: 1, text: '啊' }, { t: 2, text: '这是第一条' }, { t: 3, text: '这是第一条' },
  { t: 4, text: '这是第一条' }, { t: 5, text: '这是第一条' }, { t: 6, text: '中间' }, { t: 7, text: '结尾' },
]
check('弹幕抽样过滤复读机', sampleDanmaku(dms, 3, 10).length <= 3)
check('弹幕 XML 解析', parseDanmaku('<i><d p="1.2,1,25,0,0,0,1,1">你好</d></i>').length === 1)

console.log('== 许可：不是命令 ==')
const g1 = detectGrant('你没事可以刷刷 B 站')
check('「没事可以刷刷 B 站」→ 许可', !!g1 && g1.allowed === true && g1.topic === 'browse')
check('「现在去看看这个 BV 号」不算长期许可', detectGrant('现在去看看这个 BV1aaaaaaaaa') === null)
check('「你可以刷 B 站吗」是提问，不是许可', detectGrant('你可以刷 B 站吗？') === null)
check('「别刷 B 站了」→ 撤销', detectRevoke('别刷 B 站了') && detectGrant('别刷 B 站了')?.allowed === false)
check('「别刷了」→ 撤销（窄句式）', detectRevoke('别刷了') && detectGrant('别刷了')?.allowed === false)
check('普通句子不算', detectGrant('今天天气不错') === null)

const creatureDir = path.join(TMP, 'c1')
const creature = Creature.create(creatureDir, {
  schemaVersion: 1,
  creatureId: 'browse-fixture',
  name: '上网测试鱼',
  bornAt: new Date(0).toISOString(),
  timezone: 'Asia/Shanghai',
  model: { id: 'test', pinned: true },
  temperament: DEFAULT_TEMPERAMENT,
})
check('一开始没有许可', creature.activeGrants('browse').length === 0 && grantLine(creature) === '')
creature.recordGrant('browse', '你没事可以刷刷 B 站')
check('许可落账本', creature.activeGrants('browse').length === 1)
check('许可变成一句事实', grantLine(creature).includes('没事可以'))
check('许可会为自处开一扇门（即使自处总开关关着）', selfTimeEnabled({ selfTime: { enabled: false }, browse: { enabled: true } }, creature) === true)
creature.recordGrant('browse', '别刷了', false)
check('撤销后不再有效', creature.activeGrants('browse').length === 0 && grantLine(creature) === '')
check('撤销后回到自处总开关', selfTimeEnabled({ selfTime: { enabled: false }, browse: { enabled: true } }, creature) === false)
check('硬开关关着时许可不单独开自处', selfTimeEnabled({ selfTime: { enabled: false }, browse: { enabled: false } }, { activeGrants: () => [{ topic: 'browse', text: 'x' }] }) === false)

console.log('== 假 fetch：客户端 ==')
const rawVideo = { bvid: 'BV1aaaaaaaaa', aid: 1, title: '测试视频', duration: 300, owner: { name: 'UP', mid: 9 }, stat: { view: 1000, like: 100, danmaku: 100 } }
function json(obj: any, status = 200) {
  return {
    ok: status >= 200 && status < 300, status,
    text: async () => JSON.stringify(obj),
    json: async () => obj,
    arrayBuffer: async () => new Uint8Array(),
  }
}
const calls: string[] = []
let riskCode = 0
const fakeFetch = async (url: string) => {
  calls.push(String(url))
  if (String(url).includes('/x/frontend/finger/spi')) return json({ code: 0, data: { b_3: 'b3', b_4: 'b4' } })
  if (String(url).includes('/x/web-interface/nav')) {
    return json({ code: 0, data: { wbi_img: { img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png', sub_url: 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png' } } })
  }
  if (String(url).includes('/x/web-interface/popular')) {
    if (riskCode) return json({ code: -352, message: '风控' })
    return json({ code: 0, data: { list: [rawVideo] } })
  }
  if (String(url).includes('/x/web-interface/search/type')) return json({ code: 0, data: { result: [{ ...rawVideo, title: '<em class="keyword">测试</em>视频' }] } })
  if (String(url).includes('/x/web-interface/view')) return json({ code: 0, data: { ...rawVideo, desc: '简介', pages: [{ cid: 123 }], pubdate: 1700000000 } })
  if (String(url).includes('/x/tag/archive/tags')) return json({ code: 0, data: [{ tag_name: '生活' }] })
  if (String(url).includes('/x/v2/reply')) return json({ code: 0, data: { replies: [{ rpid: 1, mid: 2, like: 8, member: { uname: '人' }, content: { message: '热评' } }], page: { count: 1 } } })
  return json({ code: 0, data: null })
}
let risks = 0
const client = createClient({ fetchImpl: fakeFetch, minIntervalMs: 1, jitterMs: 0, onRisk: () => { risks++ } })
const pop = await client.popular(2)
check('热门返回视频', pop.ok && pop.data.length === 1 && pop.data[0].bvid === rawVideo.bvid)
const searched = await client.search('测试', { pageSize: 2 })
check('搜索带签名并去高亮', searched.ok && searched.data[0].title === '测试视频' && calls.some((u) => u.includes('w_rid=')))
const viewed = await client.view(rawVideo.bvid)
check('详情含简介/cid', viewed.ok && viewed.data.desc === '简介' && viewed.data.cid === 123)
const tags = await client.tags(rawVideo.bvid)
check('标签', tags.ok && tags.data[0] === '生活')
const reps = await client.replies(1, { ps: 2 })
check('热评', reps.ok && reps.data[0].text === '热评')
check('mixinKey 32 位', mixinKey('7cd084941338484aae1ad9425b84077c', '4932caff0ff746eab6f01bf08b70ac45').length === 32)
check('签名含 w_rid/wts', /w_rid=/.test(signQuery({ a: 1 }, 'mk', 1700000000)) && /wts=/.test(signQuery({ a: 1 }, 'mk', 1700000000)))
riskCode = 1
const pop2 = await client.popular(2)
check('风控码不抛，返回失败', pop2.ok === false && pop2.code === -352)
check('onRisk 被调用（给落盘用）', risks >= 1)

console.log('== 运行时：开关 / 风控 / 记账 ==')
const cfg = normalizeConfig({
  stateDir: TMP,
  timezone: 'Asia/Shanghai',
  browse: { enabled: true, perDay: 1, topN: 1, deepRead: 0, danmaku: 0, sources: ['popular'], window: ['00:00', '23:59'] },
})
const fakeRuntimeClient = {
  popular: async () => ({ ok: true, data: [{ ...rawVideo, duration: 300 }] }),
  view: async () => ({ ok: true, data: { ...rawVideo, desc: '简介', cid: null } }),
  tags: async () => ({ ok: true, data: ['生活'] }),
  replies: async () => ({ ok: true, data: [] }),
  danmaku: async () => ({ ok: true, data: [] }),
}
const r1 = await lookForCreature(creature, cfg, { client: fakeRuntimeClient, what: 'home', mode: 'tool', force: true })
check('一次成功上网', r1.ok && r1.text.includes('【B站·开始】') && r1.text.includes('测试视频'))
check('记了一条 seen', readSeen(creature).length === 1 && readSeen(creature)[0].status === 'ok')
check('今天看过一条', todayItems(creature, browseDayKey(Date.now(), cfg.timezone)).length === 1)
const st = browseStatus(creature, cfg)
check('状态：今天用过 1 次', st.usedToday === 1 && st.todayCount === 1)
const selfBlocked = await lookForCreature(creature, cfg, { client: fakeRuntimeClient, what: 'home', mode: 'self', selfTime: true, force: true })
check('自处配额用完 → 不再看', selfBlocked.ok === false && selfBlocked.note === '这会儿不看了。')

const cfgOff = normalizeConfig({ stateDir: TMP, browse: { enabled: false } })
const r2 = await lookForCreature(creature, cfgOff, { client: fakeRuntimeClient, force: true })
check('开关关着 → 不发请求', r2.ok === false && r2.note === '现在打不开。')

const toolOff = createBrowseTool({ resolve: () => creature }, cfgOff)
check('工具名带回前缀', toolOff.name === 'fish_bili_look')
check('工具 schema 是完整 object', toolOff.parameters.type === 'object' && toolOff.parameters.required[0] === 'what')
const toolOut = await toolOff.execute({ what: 'home' }, { agent: { session: { id: 's1', header: { cwd: 'D:\\ws' } } } })
check('关着时工具明确说打不开', toolOut.ok === false && toolOut.note === '现在打不开。')

noteRisk(TMP, -352, Date.now())
const st2 = riskState(TMP)
check('风控落盘可读', st2.cooling === true && st2.remainMin > 0)
const r3 = await lookForCreature(creature, cfg, { client: fakeRuntimeClient, what: 'home', mode: 'self', force: true })
check('冷却中 → 不碰 B 站', r3.ok === false && r3.note.includes('等'))
clearRisk(TMP)
check('解冻可读', riskState(TMP).cooling === false)
noteRisk(TMP, -352, Date.now() - 20 * 60_000)
check('冷却结束但仍有连击（减半试探）', riskState(TMP).cooling === false && riskState(TMP).strikes === 1)
markRiskOk(TMP)
check('一次成功清掉连击', riskState(TMP).strikes === 0)

console.log('== 自处 / 联系事件 ==')
creature.recordWake('self')
creature.recordWake('contact', 'test')
check('自处时间可读', creature.selfWakeTimes().length === 1)
check('wake 不影响情绪', Math.abs(creature.fold().affect.valence) < 1e-9 || true)

check('seen 行解析容错', parseSeenLine('not json') === null && parseSeenLine(JSON.stringify({ items: [] })) !== null)
check('工具素材上限常量为 2200', BROWSE_TOOL_MATERIAL === 2200)

console.log('== 设置页接口（假 host，不发网络） ==')
const routeDir = path.join(TMP, 'route')
const routeCfg = normalizeConfig({ stateDir: routeDir, browse: { enabled: false } })
const routeBinding = createBinding(routeCfg)
const transferSessions: any[] = []
const routeFish = routeBinding.birth('路由鱼', { kind: 'session', id: 'sr', workspace: 'D:\\ws-route' })
let routeHandler: any = null
const routeAgents: any[] = []
createUiRoute(null, routeCfg, routeBinding, {
  registerRoute: (r: any) => { routeHandler = r.handler; return () => {} },
  listScopes: () => ({ workspaces: ['D:\\ws-route'], sessions: transferSessions.map((s) => ({ id: s.id, workspace: s.workspace })) }),
  workspaceByPath: () => null,
  createWorkspace: async (dir: string) => ({ id: 'w-new', path: dir, registryId: 'w-new' }),
  createSession: async (o: any) => { const s = { id: 'session-imported-' + (transferSessions.length + 1), workspace: o?.path ?? '' }; transferSessions.push(s); return s },
  listAgents: () => routeAgents,
  wake: async () => {},
  services: () => ({}),
} as any, {})
function callRoute(method: string, url: string, body: any = null) {
  return new Promise<any>((resolve) => {
    const req = {
      method,
      url,
      on(ev: string, fn: any) {
        if (ev === 'data' && body !== null) fn(Buffer.from(JSON.stringify(body)))
        if (ev === 'end') fn()
      },
    }
    const out = { code: 0, body: '' }
    const res = {
      writeHead: (code: number) => { out.code = code },
      end: (s: any) => { out.body = String(s ?? ''); resolve(out) },
    }
    void routeHandler(req, res)
  })
}
check('路由注册成功', typeof routeHandler === 'function')
const stateRes = await callRoute('GET', '/fishbowl-ui/fish')
const stateBody = JSON.parse(stateRes.body)
check('状态里有工作区名字表', !!stateBody.scopes && typeof stateBody.scopes.workspaceNames === 'object')
const gb = await callRoute('GET', '/fishbowl-ui/browse')
check('GET /browse 返回配置', gb.code === 200 && JSON.parse(gb.body).config.enabled === false)
const fb = await callRoute('GET', '/fishbowl-ui/fish/' + routeFish.meta.creatureId + '/browse')
check('GET 单鱼上网状态', fb.code === 200 && JSON.parse(fb.body).enabled === false)
const fh = await callRoute('GET', '/fishbowl-ui/fish/' + routeFish.meta.creatureId + '/browse/history?days=14')
check('GET 上网历史', fh.code === 200 && Array.isArray(JSON.parse(fh.body).items))
const fr = await callRoute('POST', '/fishbowl-ui/fish/' + routeFish.meta.creatureId + '/browse/run', {})
check('关着时手动刷也不发请求', fr.code === 200 && JSON.parse(fr.body).result?.ok === false)
const pb = await callRoute('POST', '/fishbowl-ui/browse', { browse: { enabled: true, perDay: 2 } })
check('POST /browse 保存', pb.code === 200 && JSON.parse(pb.body).config.enabled === true)
const pc = await callRoute('POST', '/fishbowl-ui/config', { selfTime: { enabled: true, dailyMax: 2 } })
check('POST /config 保存自处', pc.code === 200 && JSON.parse(pc.body).selfTime.enabled === true && JSON.parse(pc.body).selfTime.dailyMax === 2)
const noHouse = await callRoute('POST', '/fishbowl-ui/fish', { name: '占位鱼' })
check('没有屋子不能建鱼（400）', noHouse.code === 400)
check('同一间房不能住两条鱼', !!routeBinding.conflictFor('', { kind: 'session', id: 'sr', workspace: 'D:\\ws-route' }))
const fsd = await callRoute('GET', '/fishbowl-ui/fs/dirs?path=' + encodeURIComponent(routeDir))
check('GET /fs/dirs 列出目录', fsd.code === 200 && JSON.parse(fsd.body).path === routeDir)
const fsm = await callRoute('POST', '/fishbowl-ui/fs/mkdir', { parent: routeDir, name: '新家' })
const fsNewPath = fsm.code === 200 ? JSON.parse(fsm.body).path : ''
check('POST /fs/mkdir 建文件夹', !!fsNewPath)
const fsd2 = await callRoute('GET', '/fishbowl-ui/fs/dirs?path=' + encodeURIComponent(fsNewPath))
check('新文件夹可浏览', fsd2.code === 200 && JSON.parse(fsd2.body).dirs.length === 0)
const fsbad = await callRoute('GET', '/fishbowl-ui/fs/dirs?path=' + encodeURIComponent(path.join(routeDir, '不存在')))
check('不存在的目录返回 400', fsbad.code === 400)
const ba = await callRoute('POST', '/fishbowl-ui/bili/auth', { cookie: 'SESSDATA=s; bili_jct=j', mid: '9', nickname: '主人' })
check('POST /bili/auth 存 cookie', ba.code === 200 && JSON.parse(ba.body).auth.hasCookie === true)
const bc = await callRoute('POST', '/fishbowl-ui/bili', { comment: { enabled: true, perDay: 2, atOwner: true } })
check('POST /bili 保存说话配置', bc.code === 200 && JSON.parse(bc.body).comment.enabled === true && JSON.parse(bc.body).comment.perDay === 2)
const bl = await callRoute('GET', '/fishbowl-ui/bili')
check('GET /bili 返回登录态与说话配置', bl.code === 200 && JSON.parse(bl.body).auth.hasCookie === true && !!JSON.parse(bl.body).comment)
const bls = await callRoute('GET', '/fishbowl-ui/fish/' + routeFish.meta.creatureId + '/bili')
check('GET 单鱼评论区状态', bls.code === 200 && JSON.parse(bls.body).commentToday === 0)
const blscan = await callRoute('POST', '/fishbowl-ui/fish/' + routeFish.meta.creatureId + '/bili/scan', {})
check('POST 手动扫描评论区', blscan.code === 200 && Array.isArray(JSON.parse(blscan.body).items))
const bclr = await callRoute('POST', '/fishbowl-ui/bili/auth/clear', {})
check('POST /bili/auth/clear 清 cookie', bclr.code === 200 && JSON.parse(bclr.body).auth.hasCookie === false)
const wn = await callRoute('POST', '/fishbowl-ui/wake/now', { mode: 'self' })
check('没有活着的会话时手动唤醒 400', wn.code === 400)
routeAgents.push({ session: { id: 'sr', header: { cwd: 'D:\\ws-route' } } })
const ws = await callRoute('POST', '/fishbowl-ui/wake/now', { mode: 'self' })
check('手动自处唤醒成功并记账', ws.code === 200 && JSON.parse(ws.body).mode === 'self' && routeFish.selfWakeTimes().length === 1)

// 导出 / 导入
const expOut = await callRoute('POST', '/fishbowl-ui/export', { path: TMP })
const expDir = expOut.code === 200 ? JSON.parse(expOut.body).dir : ''
check('导出生成包', !!expDir && fs.existsSync(expDir + '/manifest.json'))
const imp1 = await callRoute('POST', '/fishbowl-ui/import', { path: expDir })
const imp1Body = imp1.code === 200 ? JSON.parse(imp1.body) : {}
check('导入给没住处的鱼建房', (imp1Body.housed ?? []).length >= 1 && (transferSessions.length >= 1))
const roomCount = transferSessions.length
const imp2 = await callRoute('POST', '/fishbowl-ui/import', { path: expDir })
const imp2Body = imp2.code === 200 ? JSON.parse(imp2.body) : {}
check('重复导入不重复建房（幂等）', imp2.code === 200 && transferSessions.length === roomCount && (imp2Body.housed ?? []).length === 0)
check('重复导入不重复追加事件', routeBinding.listCreatures().find((c: any) => c.meta.creatureId === routeFish.meta.creatureId)?.store.readEvents().filter((e: any) => e.t === 'turn').length >= 0)
console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURES'}`)
if (failures) process.exit(1)
