/** 记忆系统（packages/memory）单元测试：账本、门槛、检索、渲染、整理闭环。 */
import fs from 'node:fs'
import path from 'node:path'
import { Ledger } from '../src/ledger.ts'
import { buildView } from '../src/records.ts'
import { normalizeMemory, validateMemory } from '../src/config.ts'
import { gateMemories, dedupeAgainst, similarity, parseMerge } from '../src/consolidate.ts'
import { splitSegments, locateQuote, parseNeutral, parseHer, HER_SYSTEM, NEUTRAL_SYSTEM } from '../src/summarize.ts'
import { RecallIndex, tokenize } from '../src/recall.ts'
import { renderText, pickMemories, fingerprint } from '../src/render.ts'
import { acquireWriterLock } from '../src/lock.ts'
import { cosine, rrf } from '../src/embed.ts'
import { Memory } from '../src/memory.ts'

let failures = 0
function check(name: string, cond: boolean, detail = ''): void {
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${name}${detail ? '  ' + detail : ''}`)
  if (!cond) failures++
}

const TMP = path.join(process.cwd(), 'test-tmp', 'memory')
fs.rmSync(TMP, { recursive: true, force: true })

// ---------------------------------------------------------------- 配置
console.log('== 配置 ==')
const good = normalizeMemory({})
check('默认配置合法', validateMemory(good).length === 0)
check('越界被钳制', normalizeMemory({ turnsPerRecord: 99, injectBudget: 1 }).turnsPerRecord === 20)
check('空标签表被补回默认', normalizeMemory({ tags: [] }).tags.length > 5)
check('整理阈值 < 记录间隔 → 报错', validateMemory({ ...good, turnsPerRecord: 5, consolidateCap: 3 }).length === 1)

// ---------------------------------------------------------------- 账本
console.log('== 账本（只追加 + 缓存） ==')
const led = new Ledger(path.join(TMP, 'ledger'))
led.append({ t: 'turn', id: 'a', ts: 1, note: 'n1' } as any)
led.append({ t: 'turn', id: 'b', ts: 2, note: 'n2' } as any)
check('读回两条', led.read().length === 2)
const before = led.read()
check('缓存命中返回同一引用', led.read() === before)
fs.appendFileSync(led.file, '{"t":"turn","id":"c","ts":3,"note":"n3"}\n')
check('文件被外部改动会重读', led.read().length === 3)
fs.appendFileSync(led.file, 'not json\n')
check('坏行不毒死整本账', led.read().length === 3)

// ---------------------------------------------------------------- 视图
console.log('== 视图（turn / summary / hit / 水位线） ==')
const evs = [
  { t: 'turn', id: 't1', ts: 1000, note: '用户: 早\n助手: 早', appraisal: { goalCongruence: 0.2 }, salience: 0.2, scope: { kind: 'session', id: 's1' }, injected: ['m1'] },
  { t: 'summary', id: 's1a', ts: 1100, turnId: 't1', role: 'neutral', text: '他说了声早' },
  { t: 'summary', id: 's1b', ts: 1100, turnId: 't1', role: 'her', text: '有点困', affect: { valence: 0.1, arousal: 0.2, guilt: 0, longing: 0 } },
  { t: 'hit', id: 'h1', ts: 1200, turnId: 't1', ref: 'm1', use: 'used' },
  { t: 'turn', id: 't2', ts: 2000, note: '用户: 加班\n助手: 嗯', salience: 0.4, scope: { kind: 'session', id: 's1' } },
  { t: 'merged', id: 'm1', ts: 3000, kind: 'fact', subject: 'user', claim: '他今天加班', evidence: ['t1', 't2'], confidence: 0.7 },
  { t: 'consolidation-attempt', id: 'a1', ts: 3000, batch: { from: 1, to: 2 }, ok: true, produced: 1 },
]
const view = buildView(evs)
check('两轮，序号从 1 开始', view.turns.length === 2 && view.turns[0].index === 1 && view.turns[1].index === 2)
check('中性总结落到轮次上', view.turns[0].neutral === '他说了声早')
check('她的看法进 her 链', view.turns[0].her.length === 1 && view.turns[0].her[0].text === '有点困')
check('summaryState 变 both', view.turns[0].summaryState === 'both')
check('注入过的 id 记在轮次上', view.turns[0].injected[0] === 'm1')
check('hit 计入 used', view.turns[0].hits.used === 1)
check('记忆的 evidence 反查到轮次', view.turns[0].mergedInto[0] === 'm1' && view.turns[1].mergedInto[0] === 'm1')
check('水位线 = 2', view.watermark === 2)
check('证据统计：2 轮 / 1 会话 / 1 天', view.memories[0].evidenceStats.turns === 2 && view.memories[0].evidenceStats.sessions === 1)

// ---------------------------------------------------------------- 门槛
console.log('== 证据门槛 ==')
const batch = [
  { id: 'a', ts: 0, scope: { kind: 'session', id: 's1' } },
  { id: 'b', ts: 0, scope: { kind: 'session', id: 's1' } },
  { id: 'c', ts: 0, scope: { kind: 'session', id: 's2' } },
] as any
const tags = ['工作']
check('证据不足 → 拒', gateMemories([{ kind: 'fact', claim: 'x', evidence: ['a'] }], batch, tags).accepted.length === 0)
check('证据够 → 收', gateMemories([{ kind: 'fact', claim: 'x', evidence: ['a', 'b'] }], batch, tags).accepted.length === 1)
check('同一轮重复引用不算多条', gateMemories([{ kind: 'fact', claim: 'x', evidence: ['a', 'a'] }], batch, tags).accepted.length === 0)
check('引用本批不存在的 turn → 拒', gateMemories([{ kind: 'fact', claim: 'x', evidence: ['a', 'zzz'] }], batch, tags).accepted.length === 0)
check('关系类同一会话同一天 → 拒', gateMemories([{ kind: 'relation', claim: '我们关系很好', evidence: ['a', 'b'] }], batch, tags).accepted.length === 0)
check('关系类跨会话 → 收', gateMemories([{ kind: 'relation', claim: '我们关系很好', evidence: ['a', 'b', 'c'] }], batch, tags).accepted.length === 1)
check('教训一条证据即可', gateMemories([{ kind: 'lesson', claim: '当x时先y', evidence: ['a'] }], batch, tags).accepted.length === 1)
check('标签只留词表里的', gateMemories([{ kind: 'fact', claim: 'x', evidence: ['a', 'b'], tags: ['工作', '乱写'] }], batch, tags).accepted[0].tags.length === 1)

console.log('== 去重 ==')
check('同一句换个说法相似度高', similarity('用户讨厌被当成工具人', '用户讨厌被当成工具') > 0.8)
check('加了半句会掉下来', similarity('用户讨厌被当成工具人', '用户讨厌被当成工具，也很烦被催') > 0.4)
check('无关句子相似度低', similarity('用户讨厌被当成工具人', '今天天气不错') < 0.2)
const dedup = dedupeAgainst(
  [{ kind: 'fact', claim: '用户讨厌被当成工具人' }],
  [{ id: 'old', claim: '用户讨厌被当成工具', kind: 'fact' }],
)
check('相似结论判为重复', dedup.fresh.length === 0 && dedup.dup.length === 1)
const dedup2 = dedupeAgainst(
  [{ kind: 'fact', claim: '用户讨厌被当成工具人' }],
  [{ id: 'old', claim: '用户讨厌加班', kind: 'fact' }],
)
check('不同结论不误判', dedup2.fresh.length === 1)

// ---------------------------------------------------------------- 解析与拆分
console.log('== 解析与拆分 ==')
check('坏 JSON → 空', parseHer('not json').herSummary === '')
check('used 只留字符串', parseHer('{"herSummary":"嗯","used":["a",1,null]}').used.length === 1)
check('中性标签过滤词表', parseNeutral('{"segments":[{"text":"a","quote":"q"}],"tags":["工作","乱写"]}', tags).tags.length === 1)
check('合并解析容错', parseMerge('{"memories":[{"kind":"fact","subject":"user","claim":"c","evidence":["a"]}]}').length === 1)
check('quote 逐字定位', JSON.stringify(locateQuote('我们今天聊了装工具的事', '装工具')) === '[6,9]')
check('quote 编造 → null', locateQuote('我们今天聊了装工具的事', '他昨天说要辞职') === null)
const seg = splitSegments('第一件事。第二件事。', [{ text: 'A', quote: '第一件事' }, { text: 'B', quote: '第二件事' }])
check('拆成两段并按位置排序', seg.length === 2 && seg[0].chars[0] < seg[1].chars[0])
const badseg = splitSegments('原文', [{ text: 'A', quote: '编的' }, { text: 'B', quote: '也是编的' }])
check('定位失败整轮退回一段', badseg.length === 1)
check('她的总结提示词认 situation', HER_SYSTEM.includes('situation'))
check('中性总结提示词认 situation', NEUTRAL_SYSTEM.includes('situation'))

// ---------------------------------------------------------------- 检索
console.log('== 检索（BM25） ==')
check('停用词被滤掉', tokenize('我们这个可以').length === 0 || !tokenize('我们这个可以').includes('我们'))
const idx = new RecallIndex()
idx.sync([
  { id: 'd1', text: '用户讨厌被当成工具人', kind: 'memory' },
  { id: 'd2', text: '用户周六休息，不上班', kind: 'memory' },
  { id: 'd3', text: '我们一起看了一部电影', kind: 'turn' },
])
const r1 = idx.search('你还记得我讨厌什么吗', { limit: 3 })
check('相关的那条排第一', r1.length > 0 && r1[0].doc.id === 'd1')
check('无关查询不命中', idx.search('量子力学', { limit: 3 }).length === 0)
check('可按类型过滤', idx.search('用户', { kind: 'turn', limit: 3 }).every((h) => h.doc.kind === 'turn'))

// ---------------------------------------------------------------- 渲染
console.log('== 注入渲染 ==')
const mems = [
  { id: 'm1', kind: 'self', claim: '我不太主动解释自己', status: 'active', confidence: 0.8, reinforcements: 0, tags: [], evidence: [], createdAt: 1, lastAt: 1, evidenceStats: {} },
  { id: 'm2', kind: 'fact', claim: '他很在意被当成工具人', attitude: 'a'.repeat(500), status: 'active', confidence: 0.9, reinforcements: 0, tags: [], evidence: [], createdAt: 1, lastAt: 1, evidenceStats: {} },
  { id: 'm3', kind: 'fact', claim: '他周六不上班', status: 'active', confidence: 0.6, reinforcements: 0, tags: [], evidence: [], createdAt: 1, lastAt: 1, evidenceStats: {} },
] as any
const rendered = renderText({ affect: { valence: -0.4, arousal: 0.6, guilt: 0, longing: 0 }, bias: { verbosity: 0.3, thresholdRefuse: 0.5, thresholdVerify: 0.5, riskAppetite: 0.5, disclosure: 0.5, patience: 0.5 }, memories: mems, turns: [], budget: 600, memoryRatio: 5, turnRatio: 3, name: '大肥鱼' })
const txt = rendered.text
check('预算紧时丢掉态度、保留骨架', !txt.includes('a'.repeat(50)) && txt.includes('他很在意被当成工具人'))
check('注入过哪些记忆有记录（供判定「真用到了」）', rendered.picked.includes('m1') && rendered.picked.includes('m2'))
check('自我认知必出', txt.includes('我不太主动解释自己'))
check('带上名字与情绪', txt.includes('大肥鱼') && txt.includes('效价'))
check('指纹随记忆变化', fingerprint(mems, { valence: 0 }, {}) !== fingerprint(mems.slice(0, 1), { valence: 0 }, {}))

console.log('== 多样性 ==')
const dupMems = [
  { id: 'x1', kind: 'fact', claim: '用户讨厌被当成工具人', status: 'active', confidence: 0.9, reinforcements: 0, tags: [], evidence: [], createdAt: 10, lastAt: 10, evidenceStats: {} },
  { id: 'x2', kind: 'fact', claim: '用户讨厌被当成工具', status: 'active', confidence: 0.88, reinforcements: 0, tags: [], evidence: [], createdAt: 10, lastAt: 10, evidenceStats: {} },
  { id: 'x3', kind: 'fact', claim: '他周六不上班', status: 'active', confidence: 0.5, reinforcements: 0, tags: [], evidence: [], createdAt: 10, lastAt: 10, evidenceStats: {} },
] as any
const picked = pickMemories(dupMems, 5, 10)
check('同主题只出一条', picked.filter((m) => m.claim.includes('工具')).length === 1)

// ---------------------------------------------------------------- 闭环
console.log('== 闭环：观察 → 总结 → 整理 ==')
const TURN_IDS: string[] = []
const seen: string[] = []
const llm = async (req: any) => {
  seen.push(req.kind)
  if (req.kind === 'neutral') {
    return JSON.stringify({ segments: [{ text: '他说了一件具体的事', quote: (req.user.split('\n').pop() || '').slice(0, 6) }], tags: ['工作'] })
  }
  if (req.kind === 'her') return JSON.stringify({ herSummary: '有点被冒犯', used: [] })
  if (req.kind === 'merge') {
    const ids = [...req.user.matchAll(/\[([0-9a-f-]{36})\]/g)].map((m) => m[1])
    TURN_IDS.push(...ids)
    return JSON.stringify({ memories: [{ kind: 'fact', subject: 'user', claim: '他反复强调别把他当工具人', evidence: ids.slice(0, 2), tags: ['工作'] }] })
  }
  return '{}'
}

const mem = new Memory({ dir: path.join(TMP, 'fish'), cfg: { memory: { consolidateCap: 5 } } })
for (let i = 0; i < 5; i++) mem.observe({ note: `用户: 第${i}次说别把我当工具\n助手: 知道了${i}`, salience: 0.3, affect: { valence: -0.3, arousal: 0.5, guilt: 0, longing: 0 }, scope: { kind: 'session', id: 's1' } })
check('五轮先落盘（零 LLM）', mem.view().turns.length === 5)

const rep = await mem.tick({ llm, by: { model: 'fake' } })
check('补了两条总结', rep.neutral + rep.her >= 2, JSON.stringify(rep))
check('中性总结写入', mem.view().turns.filter((t) => t.neutral).length >= 1)

let ticked: any = { merged: 0 }
for (let i = 0; i < 12 && !ticked.merged; i++) ticked = await mem.tick({ llm, by: { model: 'fake' } })
const v2 = mem.view()
check('攒够上限后整理出合并记忆', v2.memories.length >= 1, `memories=${v2.memories.length}`)
check('水位线推进到 5', v2.watermark === 5)
check('合并记忆带证据与溯源', v2.memories[0].evidence.length >= 2 && !!v2.memories[0].by)
check('状态是 active', v2.memories[0].status === 'active')

const beforeCount = mem.view().memories.length
await mem.tick({ llm, by: { model: 'fake' } })
check('水位线推进后不再重复整理', mem.view().memories.length === beforeCount)

console.log('== 积压也会整理（不必等满 20 轮） ==')
const idle = new Memory({ dir: path.join(TMP, 'fish-idle'), cfg: { memory: { consolidateCap: 20 } } })
for (let i = 0; i < 3; i++) idle.observe({ note: `用户: 第${i}次\n助手: 嗯`, salience: 0.3, ts: Date.now() - 11 * 60_000 - i })
let idleRep: any = { merged: 0 }
for (let i = 0; i < 12 && !idleRep.merged; i++) idleRep = await idle.tick({ llm, by: { model: 'fake' }, maxCalls: 4 })
check('三轮积压十分钟后自动整理', idleRep.merged >= 1, JSON.stringify(idleRep))
check('水位线推进到 3', idle.view().watermark === 3)
console.log('== 失败不丢批 ==')
const flaky = async (req: any) => {
  if (req.kind === 'merge') throw new Error('429')
  if (req.kind === 'neutral') return JSON.stringify({ segments: [{ text: '一句话', quote: 'a' }], tags: [] })
  return JSON.stringify({ herSummary: '嗯', used: [] })
}
const mem2 = new Memory({ dir: path.join(TMP, 'fish2'), cfg: { memory: { consolidateCap: 5 } } })
for (let i = 0; i < 5; i++) mem2.observe({ note: `第${i}轮`, salience: 0.1, scope: { kind: 'session', id: 's1' } })
for (let i = 0; i < 8; i++) await mem2.tick({ llm: flaky })
const v3 = mem2.view()
check('总结失败不影响轮次本身', v3.turns.length === 5)
const merged = await mem2.tick({ llm: flaky })
const v4 = mem2.view()
check('整理失败留下尝试记录', v4.attempts.length === 1 && !v4.attempts[0].ok)
check('失败后水位线不动（这批还会被重试）', v4.watermark === 0)
check('失败不产生记忆', v4.memories.length === 0)
const retry = await mem2.tick({ llm: flaky })
check('失败后进入退避，不立刻重试', retry.skipped.length >= 1, JSON.stringify(retry.skipped))

console.log('== 零产出不吞批 ==')
const emptyMerge = async (req: any) => {
  if (req.kind === 'merge') return JSON.stringify({ memories: [] })
  if (req.kind === 'neutral') return JSON.stringify({ segments: [{ text: '一句话', quote: 'a' }], tags: [] })
  return JSON.stringify({ herSummary: '嗯', used: [] })
}
const mem3 = new Memory({ dir: path.join(TMP, 'fish3'), cfg: { memory: { consolidateCap: 5 } } })
for (let i = 0; i < 5; i++) mem3.observe({ note: `第${i}轮`, salience: 0.1, scope: { kind: 'session', id: 's1' } })
for (let i = 0; i < 6 && mem3.view().attempts.length === 0; i++) await mem3.tick({ llm: emptyMerge, force: true })
check('零产出不推进水位线', mem3.view().watermark === 0)
check('零产出留下失败尝试', mem3.view().attempts.length >= 1 && mem3.view().attempts.at(-1)!.ok === false)
for (let i = 0; i < 8 && mem3.view().watermark === 0; i++) await mem3.tick({ llm: emptyMerge, force: true })
check('连续三次零产出才放弃并推进', mem3.view().watermark === 5, 'watermark=' + mem3.view().watermark)

const wmBefore = mem.view().watermark
mem.rewindTo(0)
check('rewind 可以把水位线退回去', mem.view().watermark === 0, 'before=' + wmBefore)
mem.rewindTo(5)
console.log('== 检索全文 ==')
const found = mem.search('工具人', { limit: 3 })
check('搜得到合并记忆', found.length > 0 && found[0].kind === 'memory')

console.log('== 写锁 ==')
const lockDir = path.join(TMP, 'lock')
fs.mkdirSync(lockDir, { recursive: true })
const la = acquireWriterLock(lockDir)
check('第一次拿到写锁', la.status.ok)
const lb = acquireWriterLock(lockDir)
check('同进程的第二个实例被挡下', !lb.status.ok && lb.status.holder?.pid === process.pid)
la.release()
const lc = acquireWriterLock(lockDir)
check('释放后可以再拿', lc.status.ok)
lc.release()
fs.writeFileSync(path.join(lockDir, '.writer.lock'), JSON.stringify({ pid: 999999, at: Date.now() }))
const ld = acquireWriterLock(lockDir)
check('死进程留下的锁可以被接管', ld.status.ok && ld.status.stale === true)
fs.writeFileSync(path.join(lockDir, '.writer.lock'), JSON.stringify({ pid: process.pid, at: Date.now() - 10 * 60_000 }))
const le = acquireWriterLock(lockDir)
check('pid 被系统复用（心跳过期）也能接管', le.status.ok && le.status.stale === true)
le.release()
ld.release()

console.log('== 快照（删了能重算） ==')
const snapDir = path.join(TMP, 'snap')
const sm = new Memory({ dir: snapDir, cfg: { memory: { consolidateCap: 5 } } })
for (let i = 0; i < 25; i++) sm.observe({ note: `第${i}轮`, salience: 0.1, scope: { kind: 'session', id: 's1' } })
check('攒够事件后写了快照', fs.existsSync(path.join(snapDir, 'snapshot.json')))
const snapShape = `${sm.view().turns.length}|${sm.view().watermark}`
const sm2 = new Memory({ dir: snapDir })
check('新实例读快照得到同样的视图', `${sm2.view().turns.length}|${sm2.view().watermark}` === snapShape)
fs.rmSync(path.join(snapDir, 'snapshot.json'), { force: true })
const sm3 = new Memory({ dir: snapDir })
check('删掉快照照样能重算', `${sm3.view().turns.length}|${sm3.view().watermark}` === snapShape)
for (const x of [sm, sm2, sm3]) x.close()

console.log('== 向量融合（默认关） ==')
check('余弦', Math.abs(cosine([1, 0], [1, 0]) - 1) < 1e-9 && Math.abs(cosine([1, 0], [0, 1])) < 1e-9)
const fused = rrf([[{ id: 'a' }, { id: 'b' }], [{ id: 'b' }, { id: 'c' }]])
check('RRF 把两路都出现的顶上来', fused[0].id === 'b')

const fakeEmbedder = {
  id: 'fake:1',
  async embed(texts: string[]) {
    return texts.map((t) => (/劳力|工具/.test(t) ? [1, 0, 0] : [0, 1, 0]))
  },
}
const vm = new Memory({ dir: path.join(TMP, 'vec'), embedder: fakeEmbedder })
vm.ledger.append({ t: 'merged', id: 'v1', ts: 1, kind: 'fact', subject: 'user', claim: '他讨厌被当成劳力', evidence: [], status: 'active' } as any)
vm.ledger.append({ t: 'merged', id: 'v2', ts: 2, kind: 'fact', subject: 'user', claim: '今天天气不错', evidence: [], status: 'active' } as any)
check('纯 BM25 搜不到「工具」', vm.search('工具', { limit: 3 }).length === 0)
const hy = await vm.searchHybrid('工具', { limit: 3 })
check('开了向量就能召回来', hy.some((h) => h.id === 'v1'))
vm.close()
const noEmb = new Memory({ dir: path.join(TMP, 'vec2') })
check('没配置 embedder 时等于 BM25', (await noEmb.searchHybrid('工具', { limit: 3 })).length === 0)
noEmb.close()

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURES'}`)
process.exit(failures === 0 ? 0 : 1)
