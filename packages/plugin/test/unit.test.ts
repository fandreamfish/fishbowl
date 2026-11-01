/** 插件单元测试：评价器、注入摘要、约束决策、会话↔个体绑定。 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ACTIVITY_RE, mergePendingText, parseActivity } from '../../being/src/index.ts'
import { ContactGate } from '../../schedule/src/index.ts'
import { COMMITMENT_RE, parseBroken, parseCommitment, REQUEST_RE } from '../../being/src/index.ts'
import * as sc from '../../../src/scenarios.ts'
import { appraiseScripted, APPRAISER_SYSTEM_PROMPT } from '../../app/src/index.js'
import { createBinding } from '../../app/src/index.js'
import { normalizeConfig } from '../../app/src/index.js'
import { guardVerdict, refuseReason, verifyDecision, askableDecision, budgetVerdict, createConstraints } from '../../app/src/index.js'
import { forgivenessOf } from '../../app/src/index.js'
import { isFishbowlInjection, messageText, textOf, toolNameOf, wakeOf } from '../../app/src/index.js'
import { IDENTITY_RE, parseIdentity } from '../../app/src/index.js'
import { injectMessage, stateKey, summaryText } from '../../app/src/index.js'
import { absenceHours, createWakeLoop, proactivePrompt, shouldRecordAbsence, wakeReason, wakeSituation, wakeTrigger } from '../../app/src/index.js'
import { mergeUiConfig, pickRoutineConfig, seedChanged, summarizeEvent, validateMemoryConfig, pickMemoryConfig, subjectOf, memoryDetail, otherWriter } from '../../adapter-dsh/src/index.js'
import { configFor, halfLivesFor, migrateFishConfigs, pickFishPatch, readFishConfig, writeFishConfig } from '../../app/src/index.js'
import { HER_SYSTEM, NEUTRAL_SYSTEM } from '../../memory/src/index.ts'
import { Memory } from '../../memory/src/index.ts'
import { createMemoryTool, formatHit } from '../memory/tool.js'
import { buildTranscript, createCollector } from '../../app/src/index.js'
import { Creature, dialogOnly } from '../../being/src/index.ts'
import { recentDialog as signalRecentDialog } from '../../being/src/index.ts'
import { DEFAULT_TEMPERAMENT } from '../../affect/src/index.ts'
import { canAsk, inDiaryWindow, localDate, parseDiary, parseNote, parseRequest } from '../../journal/src/index.js'
import { scopeKey, scopeTitle } from '../../app/src/index.js'
import { recallBlock, recentBlock } from '../../app/src/index.js'
import { findConflict, resolveOccupant } from '../../being/src/index.ts'
import { VOICE_RULES, voiceRulesFor } from '../../voice/src/index.js'
import { isRelationClaim, layerInterval, layerRate, memoryWindowDays, minEvidence } from '../../affect/src/index.ts'

let failures = 0
function check(name: string, cond: boolean, detail = ''): void {
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${name}${detail ? '  ' + detail : ''}`)
  if (!cond) failures++
}

const stateDir = path.join(process.cwd(), 'test-tmp', 'plugin')
const cfg = normalizeConfig({ stateDir })

console.log('== 评价器（关键词版） ==')
const rej = appraiseScripted('这个方案不行，重做。')
check('否定 → goalCongruence -0.45', Math.abs(rej.goalCongruence + 0.45) < 1e-9, `gc=${rej.goalCongruence}`)
const sorry = appraiseScripted('抱歉，是我的错，我保证下次不会了。')
check('道歉 → 自归因 + 违诺', sorry.attribution === 'self' && sorry.normViolation > 0,
  `att=${sorry.attribution} nv=${sorry.normViolation}`)
const praise = appraiseScripted('谢谢，做得很好，我很喜欢。')
check('夸奖 → 正向关系影响', praise.relationalImpact > 0, `ri=${praise.relationalImpact}`)
const plain = appraiseScripted('下午三点开会。')
check('中性 → 全默认', plain.goalCongruence === 0 && plain.normViolation === 0 && plain.attribution === 'circumstance')

console.log('== 注入摘要 ==')
const bias = { verbosity: 0.14, thresholdRefuse: 0.23, thresholdVerify: 0.78, riskAppetite: 0.83, disclosure: 0.30, patience: 0.17 }
const affect = { valence: -0.68, arousal: 0.74, guilt: 0.6, longing: 0, mood: 0, named: {} }
const summary = summaryText(bias, affect)
check('包含六个旋钮数值', ['0.14', '0.23', '0.78', '0.83', '0.30', '0.17'].every(v => summary.includes(v)))
check('愧疚以事实形式出现', summary.includes('未平复的愧疚'))
check('不含情绪台词', !summary.includes('难过') && !summary.includes('生气'))
check('明示"影响怎么做"', summary.includes('怎么做，而不是怎么说'))
check('声明快照≠人格（防自我叙事固化）', summary.includes('不是人格') && summary.includes('还没有足够的经历'))
check('状态摘要不含声音规则（声音走独立机制）', !summary.includes('不表演认错'))

console.log('== 声音规则（few-shot 语域） ==')
check('禁止表演式认错', VOICE_RULES.includes('不表演认错'))
check('包含真实对话样例', VOICE_RULES.includes('哪不行？说具体点，我改。'))
check('禁止自我剖析', VOICE_RULES.includes('不分析自己'))

console.log('== 注入消息形状（事故回归测试） ==')
const m1 = injectMessage('hello')
const m2 = injectMessage('hello')
check('role 必须是 user', m1.role === 'user')
check('id 是合法 UUID 且每次不同',
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(m1.id ?? '') && m1.id !== m2.id)
check('content 是 text 块', m1.content?.[0]?.type === 'text' && m1.content?.[0]?.text === 'hello')
check('source 标记 fishbowl', m1.source?.kind === 'fishbowl')

console.log('== 事件提取（真机字段形状回归） ==')
const userEv = { type: 'user/message', data: { role: 'user', id: 'x', content: [{ type: 'text', text: '你好' }], source: { kind: 'user' } } }
const asstEv = { type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text: '好的' }] } } }
const toolEv = { type: 'tool/result', data: { message: { role: 'tool', content: [{ type: 'text', text: 'ok' }] }, toolName: 'bash' } }
check('user/message：data 即消息', textOf(userEv) === '你好')
check('assistant/message：文本在 data.message（真机 bug 修复点）', textOf(asstEv) === '好的')
check('tool/result：文本在 data.message', textOf(toolEv) === 'ok')
check('tool 名字优先 data.toolName', toolNameOf(toolEv) === 'bash')
check('tool 名字回退 content 块', toolNameOf({ type: 'tool/result', data: { message: { content: [{ toolName: 'pwsh' }] } } }) === 'pwsh')
check('messageText 忽略空块', messageText({ content: [{ type: 'text', text: '' }, { type: 'text', text: 'hi' }] }) === 'hi')
check('自己注入的状态块被识别', isFishbowlInjection({ type: 'user/message', data: { source: { kind: 'fishbowl' } } }) === true)
check('普通用户消息不算注入', isFishbowlInjection(userEv) === false)

console.log('== P0：唤醒回合的出处（situation） ==')
const wakeMsg = injectMessage('（醒一醒。现在是 20:00。你很久没跟他说过话了。）', { mode: 'contact', reason: '很久没好好说话了' })
check('唤醒消息带 wake 出处', wakeMsg.source?.wake?.mode === 'contact')
check('普通注入不带 wake 出处', m1.source?.wake === undefined)
const wakeEv = { type: 'user/message', data: wakeMsg }
check('wakeOf 认出唤醒消息', wakeOf(wakeEv)?.mode === 'contact' && wakeOf(wakeEv)?.reason === '很久没好好说话了')
check('wakeOf 对普通注入返回 null', wakeOf({ type: 'user/message', data: m1 }) === null)
const wakeTranscript = buildTranscript([
  { role: 'situation', text: '（醒一醒。现在是 20:00。）' },
  { role: 'assistant', text: '嗯。' },
], 2400)
check('situation 进入转录', wakeTranscript.includes('situation:') && wakeTranscript.includes('assistant:'))
check('评价器知道 situation 不是用户', APPRAISER_SYSTEM_PROMPT.includes('situation'))
check('她的总结知道 situation 不是用户', HER_SYSTEM.includes('situation'))
check('中性总结知道 situation 不是用户', NEUTRAL_SYSTEM.includes('situation'))
check('dialogOnly 丢掉 situation，只留对话', dialogOnly('situation: xx\nassistant: 嗯') === 'assistant: 嗯')
check('dialogOnly 保留旧 episode 的无前缀原文', dialogOnly('这个方案不行') === '这个方案不行')

console.log('== 状态指纹（防每轮重复注入） ==')
const baseBias = { verbosity: 0.5, thresholdRefuse: 0.5, thresholdVerify: 0.5, riskAppetite: 0.5, disclosure: 0.5, patience: 0.5 }
const baseAff = { valence: -0.03, arousal: 0.67, guilt: 0, longing: 0, mood: 0, named: {} }
check('0.001 级漂移被吸收', stateKey(baseBias, { ...baseAff, valence: -0.029 }) === stateKey(baseBias, baseAff))
check('0.1 级变化触发新指纹', stateKey(baseBias, { ...baseAff, valence: -0.63 }) !== stateKey(baseBias, baseAff))
check('旋钮 0.1 级变化触发新指纹', stateKey({ ...baseBias, verbosity: 0.2 }, baseAff) !== stateKey(baseBias, baseAff))
check('愧疚出现触发新指纹', stateKey(baseBias, { ...baseAff, guilt: 0.6 }) !== stateKey(baseBias, baseAff))

console.log('== M2.3：成长率分层 ==')
check('layerRate：战术 4×', Math.abs(layerRate('tactic', 1) - 4) < 1e-9)
check('layerRate：自我认知 0.1×', Math.abs(layerRate('self', 1) - 0.1) < 1e-9)
check('layerInterval：g=1 战术 3 轮', Math.abs(layerInterval('tactic', 1) - 3) < 1e-9)
check('layerInterval：g=1 自我认知 120 轮', Math.abs(layerInterval('self', 1) - 120) < 1e-9)
check('minEvidence：自我 ≥2，关系 ≥3', minEvidence('self') === 2 && minEvidence('relation') === 3 && minEvidence('tactic') === 1)
check('记忆窗口：g 高忘得快', memoryWindowDays(1) === 90 && memoryWindowDays(4) === 22.5)
check('关系类事实识别', isRelationClaim('我们之间的信任在变好') && !isRelationClaim('他喜欢猫'))

console.log('== M2.4：承诺与关系原型 ==')
check('承诺预筛', COMMITMENT_RE.test('我明天帮你整理。') && COMMITMENT_RE.test('可以。') && COMMITMENT_RE.test('行。你笔记在哪儿？') && !COMMITMENT_RE.test('今天天气不错。'))
check('请求预筛', REQUEST_RE.test('明天帮我整理一下可以吗？') && !REQUEST_RE.test('今天天气不错。'))
check('承诺解析', parseCommitment('{"committed":true,"text":"明天整理笔记"}') === '明天整理笔记')
check('承诺解析：未承诺 → null', parseCommitment('{"committed":false}') === null)
check('违诺解析：越界拒绝', parseBroken('{"broken":true,"index":5}', 2) === null)
check('违诺解析', parseBroken('{"broken":true,"index":0}', 2) === 0)
check('声音：companion 有额外语域', voiceRulesFor('companion').length > VOICE_RULES.length)
check('声音：未知原型回退', voiceRulesFor('nonsense') === VOICE_RULES)

const namedSd = fs.mkdtempSync(path.join(os.tmpdir(), 'named-'))
const named = createBinding(normalizeConfig({ stateDir: namedSd })).birth('小鱼')
named.recordCommitment('明天整理你的笔记')
const oc = named.openCommitments()
check('未了结承诺可见', oc.some(c => c.text === '明天整理你的笔记'))
const newest = oc.filter(c => c.text === '明天整理你的笔记').at(-1) ?? oc.at(-1)!
named.resolveCommitment(newest.id, 'broken')
const oc2 = named.openCommitments()
check('broken 的承诺不消失（没翻篇）', oc2.some(c => c.broken))
const commitsNamed = oc2.slice(-2).map((x) => (x.broken ? '⚠ ' : '') + x.text)
check('注入含未完成的承诺（⚠ 标记）', commitsNamed.some((c) => c.includes('⚠')))
console.log('== M3.0：清醒与主动联系（纯决策） ==')
check('唤醒由头：先还债', (wakeReason({ openBroken: 1, longing: 0.9 })?.reason ?? '').includes('答应过'))
check('唤醒由头：再想念', (wakeReason({ openBroken: 0, longing: 0.5 })?.reason ?? '').includes('很久没'))
check('无事不开口', wakeReason({ openBroken: 0, longing: 0.2 }).reason === null)
check('proactivePrompt 含由头与声音规则', proactivePrompt('很久没好好说话了', '名字：大肥鱼').includes('很久没好好说话了'))
check('舞台提示只给处境、不写祈使句', wakeTrigger(1793433715546, wakeSituation('很久没好好说话了')).includes('很久没跟他说过话'))
check('舞台提示带时间', wakeTrigger(1793433715546, 'x').includes('醒一醒'))
check('自处提示带由头', wakeTrigger(1793433715546, '你在整理今天的事', 'self').includes('整理今天的事'))
const m3cfg = normalizeConfig({ stateDir })
check('wake 默认关闭（先观察后打开）', m3cfg.wake.enabled === false)
check('contact 默认配额', m3cfg.contact.dailyMax === 2 && m3cfg.contact.unansweredStop === 3)
const wakeCfg = normalizeConfig({ stateDir, wake: { enabled: true } })
check('wake 可显式打开', wakeCfg.wake.enabled === true)

console.log('== M3.2：共享活动与积压合并 ==')
check('活动预筛', ACTIVITY_RE.test('我们一起看《三体》吧') && !ACTIVITY_RE.test('今天天气不错'))
check('活动解析', parseActivity('{"changed":true,"title":"看《三体》","status":"started"}')?.title === '看《三体》')
check('活动解析：无变化 → null', parseActivity('{"changed":false}') === null)
named.recordActivity('看《三体》', 'started')
check('当前活动可见', named.currentActivity() === '看《三体》')
named.recordActivity('看《三体》', 'ended')
check('活动结束后清空', named.currentActivity() === null)
check('注入含活动行', summaryText(baseBias, baseAff, { activity: '看《三体》' }).includes('正在一起做的事'))
const mp = mergePendingText([{ id: 'a', text: 'x1' }, { id: 'b', text: 'x2' }, { id: 'c', text: 'x3' }, { id: 'd', text: 'x4' }])
check('积压 >3 合并成一条', mp.text !== null && mp.ids.length === 4 && (mp.text ?? '').includes('前阵子'))
check('积压 ≤3 不合并', mergePendingText([{ id: 'a', text: 'x1' }]).text === null)

console.log('== M5：设置页后端 ==')
check('事件摘要：episode', summarizeEvent({ t: 'episode', note: '你好', appraisal: { goalCongruence: -0.4 } }).text === '你好')
check('事件摘要：semantic', summarizeEvent({ t: 'semantic', claim: '他喜欢猫', confidence: 0.8 }).text === '他喜欢猫')
check('UI 配置合并 growth', mergeUiConfig({ growth: 1 }, { growth: 2.5 }).growth === 2.5)
check('UI 配置合并 seed', mergeUiConfig({}, { seed: { name: '大肥鱼', background: 'x' } }).seed.name === '大肥鱼')
check('UI 配置非法值被忽略', mergeUiConfig({ growth: 1 }, { growth: 'x' }).growth === 1)
check('seed 默认 null', normalizeConfig({}).seed === null)
check('seed 可配置', normalizeConfig({ seed: { name: 'a', background: 'b' } }).seed.name === 'a')

console.log('== 工具约束（纯决策函数） ==')
const hot = { verbosity: 0.5, thresholdRefuse: 0.1, thresholdVerify: 0.78, riskAppetite: 0.5, disclosure: 0.5, patience: 0.5 }
check('高验证门槛 → bash 先 ask', verifyDecision(hot, 'bash', cfg)?.kind === 'ask')
check('低验证门槛 → 放行', verifyDecision({ ...hot, thresholdVerify: 0.3 }, 'bash', cfg) === null)
check('非名单工具 → 放行', verifyDecision(hot, 'read', cfg) === null)
const strict = normalizeConfig({ stateDir, refuseTools: ['bash'] })
check('低拒绝门槛 → 拒绝破坏性工具', (refuseReason({ ...hot, thresholdRefuse: 0.1 }, 'bash', strict) ?? '').includes('拒绝'))
check('高拒绝门槛 → 放行', refuseReason({ ...hot, thresholdRefuse: 0.5 }, 'bash', strict) === null)
check('rc.5：放行必须是 undefined（null 会被当成拒绝理由）', guardVerdict(null) === undefined)
check('rc.5：拒绝理由原样返回', guardVerdict('x') === 'x')
check('对照组 control=true 时约束关闭', normalizeConfig({ stateDir, control: true }).control === true)

console.log('== 会话 ↔ 个体绑定 ==')
const binding = createBinding(cfg)
const SID = 'session-a-' + Date.now()
const c1 = binding.birth('测试鱼', { kind: 'session', id: SID })
const c2 = binding.occupantOf({ sessionId: SID })
const other = binding.birth('另一条', { kind: 'session', id: 'session-b' })
check('同一会话绑定同一个体', c1.meta.creatureId === c2?.meta.creatureId)
check('不同会话是不同个体', c1.meta.creatureId !== other.meta.creatureId)
check('没有住户的会话没有鱼', binding.occupantOf({ sessionId: 'nobody-' + Date.now() }) === null)
check('气质是随机的（不写死在代码里）', typeof c1.meta.temperament.reactivity === 'number'
  && c1.meta.temperament.reactivity >= 0.6 && c1.meta.temperament.reactivity <= 1.4)
check('时区写入 meta（搬迁不变量）', c1.meta.timezone === cfg.timezone)
check('模型随个体绑定', c1.meta.model.pinned === true)

const T0 = 0
for (let i = 0; i < 3; i++) c1.recordEpisode('rejected', sc.rejection(), undefined, T0)
check('三连否定后耐心显著下降', c1.bias().patience < 0.30, `pati=${c1.bias().patience.toFixed(2)}`)
check('个体目录已落盘', fs.existsSync(path.join(stateDir, c1.meta.creatureId, 'log.ndjson')))
check('住处表已落盘（scopes.json）', fs.existsSync(path.join(stateDir, 'scopes.json')))

console.log('== 配置默认值 ==')
const d = normalizeConfig({})
check('默认时区 Asia/Shanghai', d.timezone === 'Asia/Shanghai')
check('默认评价器 scripted（离线可用）', d.appraiser.kind === 'scripted')
check('默认状态目录在用户目录下（不进仓库）', d.stateDir.includes('.fishbowl'))

console.log('== M6：来历出生后只读 ==')
check('seed 未改 → 不锁', seedChanged({ name: 'a', background: '' }, { name: 'a', background: '' }) === false)
check('seed 改动 → 锁', seedChanged({ name: 'a' }, { name: 'b' }) === true)

console.log('== M7：住处（工作区/会话）互斥与解析 ==')
const W = 'D:\\ws-' + Date.now()
check('工作区冲突：同工作区', findConflict({ kind: 'workspace', id: W }, [{ creatureId: 'a', occupancy: { kind: 'workspace', id: W } }]) === 'a')
check('工作区冲突：其会话被占也算', findConflict({ kind: 'workspace', id: W }, [{ creatureId: 'b', occupancy: { kind: 'session', id: 's1', workspace: W } }]) === 'b')
check('会话冲突：同会话', findConflict({ kind: 'session', id: 's1', workspace: W }, [{ creatureId: 'c', occupancy: { kind: 'session', id: 's1', workspace: W } }]) === 'c')
check('会话冲突：工作区被占也算', findConflict({ kind: 'session', id: 's9', workspace: W }, [{ creatureId: 'd', occupancy: { kind: 'workspace', id: W } }]) === 'd')
check('不同工作区不冲突', findConflict({ kind: 'workspace', id: 'D:\\other' }, [{ creatureId: 'e', occupancy: { kind: 'workspace', id: W } }]) === null)
check('解析：会话级优先', resolveOccupant({ sessionId: 's1', workspace: W }, [{ creatureId: 'ws', occupancy: { kind: 'workspace', id: W } }, { creatureId: 'se', occupancy: { kind: 'session', id: 's1', workspace: W } }])?.creatureId === 'se')
check('解析：没有住户 → null', resolveOccupant({ sessionId: 's2', workspace: 'D:\\z' }, [{ creatureId: 'ws', occupancy: { kind: 'workspace', id: W } }]) === null)

const fishA = binding.birth('甲鱼', { kind: 'workspace', id: W })
const fishB = binding.birth('乙鱼')
let conflictMsg = ''
try { binding.assign(fishB.meta.creatureId, { kind: 'session', id: 'session-x', workspace: W }) } catch (e) { conflictMsg = e.message }
check('工作区被占 → 会话也进不去', conflictMsg.includes('已经住着'))
binding.release(fishA.meta.creatureId)
let relOk = false
try { binding.assign(fishB.meta.creatureId, { kind: 'session', id: 'session-x-' + Date.now(), workspace: W }); relOk = true } catch { relOk = false }
check('释放后可以搬进去', relOk)
check('住处写进个体自己的 meta（不是会话表）', !!binding.get(fishB.meta.creatureId)?.meta.occupancy)
check('新鱼默认未分配', binding.birth('丙鱼').meta.occupancy === null)
check('新鱼必须有名字', (() => { try { binding.birth(''); return false } catch { return true } })())

console.log('== M7：日记 / 小纸条 / 请求 ==')
const nowJ = Date.now()
check('本地日期', localDate(nowJ, 'Asia/Shanghai').length === 10)
check('请求配额：今天没问过 → 可以', canAsk(nowJ, [], 'Asia/Shanghai').ok === true)
check('请求配额：今天问过 → 不行', canAsk(nowJ, [nowJ - 3600_000], 'Asia/Shanghai').ok === false)
check('请求配额：本周满三次 → 不行', canAsk(nowJ, [nowJ - 3 * 86400_000, nowJ - 4 * 86400_000, nowJ - 5 * 86400_000], 'Asia/Shanghai').ok === false)
check('日记解析', parseDiary('  今天他来了，我有点高兴。  ') === '今天他来了，我有点高兴。')
check('日记解析：空 → null', parseDiary('   ') === null)
check('纸条解析：带引号也剥掉', parseNote('“别熬夜。”') === '别熬夜。')
check('请求解析：ask=false → null', parseRequest('{"ask":false}') === null)
check('请求解析：ask=true', parseRequest('{"ask":true,"text":"能让我看看那个视频吗"}') === '能让我看看那个视频吗')

console.log('== M9：入住改名 ==')
check('入住会话 → 名字的房间', scopeTitle('小肥鱼', { kind: 'session', id: 's' }) === '小肥鱼的房间')
check('入住工作区 → 名字 的屋子', scopeTitle('小肥鱼', { kind: 'workspace', id: 'w' }) === '小肥鱼 的屋子')
check('没住处 → 空标题', scopeTitle('小肥鱼', null) === '')
check('住处键：会话', scopeKey({ kind: 'session', id: 's1' }) === 'session:s1')
check('住处键：工作区', scopeKey({ kind: 'workspace', id: 'D:\\x' }) === 'workspace:D:\\x')
console.log('== M13：同一工作区的多个会话共享一只鱼 ==')
const shareWs = 'D:\\ws-share-' + Date.now()
const shared = binding.birth('共享鱼', { kind: 'workspace', id: shareWs })
const s1 = { sessionId: 'share-a-' + Date.now(), workspace: shareWs }
const s2 = { sessionId: 'share-b-' + Date.now(), workspace: shareWs }
const cA = binding.resolve(s1)
const cB = binding.resolve(s2)
check('两个会话解析到同一只鱼', cA && cB && cA.meta.creatureId === cB.meta.creatureId && cA.meta.creatureId === shared.meta.creatureId)
const shareDir = path.join(cfg.stateDir, shared.meta.creatureId)
const memShared = new Memory({ dir: shareDir, lock: 'off' })
memShared.observe({
  note: 'user: 我每天早上七点起 assistant: 记下了',
  scope: { kind: 'workspace', id: shareWs },
  appraisal: { goalCongruence: 0.5, selfAttribution: 0, normViolation: 0, relationshipImpact: 0.3, arousalSpike: 0 },
  salience: 0.4,
  affect: { valence: 0.2, arousal: 0.5, guilt: 0, longing: 0 },
  injected: [],
  ts: Date.now(),
})
const memShared2 = new Memory({ dir: shareDir, lock: 'off' })
check('记忆共享（同一个体）', memShared2.view().turns.length >= 1)
check('情绪共享（同一个体状态）', cA.store.readEvents().length === cB.store.readEvents().length)
check('工作区里的会话级解析也指向它', binding.occupantOf(s1)?.meta.creatureId === shared.meta.creatureId)
console.log('== M14：跨会话原文记忆 ==')
const rd = signalRecentDialog(shared, 5)
check('最近对话含原文', rd.length >= 1 && rd[rd.length - 1].text.includes('七点'))
check('按话题翻原文', memShared.view().turns.some((t) => String(t.note).includes('七点')))
check('无关话题翻不到', !memShared.view().turns.some((t) => String(t.note).includes('量子力学')))
memShared.close(); memShared2.close()
check('最近对话渲染', recentBlock([{ ts: Date.now(), text: 'abc' }]).includes('abc'))
check('最近对话有上限', recentBlock(Array.from({ length: 50 }, (_, i) => ({ ts: Date.now(), text: 'x'.repeat(200) + i })), 800).length <= 900)

console.log('== M17：记忆配置 ==')
const goodCfg = normalizeConfig({}).memory
check('默认配置本身合法', validateMemoryConfig(goodCfg).length === 0, JSON.stringify(validateMemoryConfig(goodCfg)))
check('整理阈值不能小于记录间隔', validateMemoryConfig({ ...goodCfg, turnsPerRecord: 5, consolidateCap: 3 }).length === 1)
check('召回池装不下注入条数 → 报错', validateMemoryConfig({ ...goodCfg, recallPool: 5, memoryRatio: 8, turnRatio: 4 }).length === 1)
check('两个配比都是 0 → 报错', validateMemoryConfig({ ...goodCfg, memoryRatio: 0, turnRatio: 0 }).length === 1)
check('空标签词表 → 报错', validateMemoryConfig({ ...goodCfg, tags: [] }).length === 1)
check('pick 只认认识的键', JSON.stringify(pickMemoryConfig({ turnsPerRecord: 2, bogus: 1, tags: [' 工作 ', ''] })) === JSON.stringify({ turnsPerRecord: 2, tags: ['工作'] }))
check('越界值被钳回范围', normalizeConfig({ memory: { turnsPerRecord: 99 } }).memory.turnsPerRecord === 20
  && normalizeConfig({ memory: { injectBudget: 1 } }).memory.injectBudget === 300)

console.log('== M17：记忆详情（旧数据兼容映射） ==')
check('主语：关于他', subjectOf('用户的生日是 5 月 21 日') === 'user')
check('主语：关于我', subjectOf('AI 给自己取名大肥鱼') === 'self')
check('主语：关于我们', subjectOf('我们之间的信任变少了') === 'between')
check('主语：关于世界', subjectOf('这个项目用 TS 写') === 'world')

const memDir = path.join(stateDir, 'mem-fixture')
fs.rmSync(memDir, { recursive: true, force: true })
const memFish = Creature.create(memDir, {
  schemaVersion: 1,
  creatureId: 'mem-fixture',
  name: '测试鱼',
  bornAt: new Date(0).toISOString(),
  timezone: 'Asia/Shanghai',
  model: { id: 'test', pinned: true },
  temperament: DEFAULT_TEMPERAMENT,
})
memFish.recordEpisode('turn', { goalCongruence: -0.5, agency: 0.5, certainty: 0.5, normViolation: 0, relationalImpact: -0.3, stake: 0.6, attribution: 'other' }, 'user: 这个方案不行\nassistant: 我改。')
memFish.recordSemantic('用户讨厌被当成工具人', ['1', '2'], 0.8)
memFish.recordDiary('2026-11-01', '日记正文', new Date(2026, 10, 1, 10, 30).getTime())
check('日记落成单独文件', fs.existsSync(path.join(memDir, 'diary', '2026-11-01.md')) && fs.readFileSync(path.join(memDir, 'diary', '2026-11-01.md'), 'utf8').includes('日记正文'))
memFish.recordDiary('2026-11-01', '第二篇', new Date(2026, 10, 1, 11, 0).getTime())
const diaryFiles = fs.readdirSync(path.join(memDir, 'diary'))
check('同一天再写一篇不覆盖旧的', diaryFiles.length === 2 && fs.readFileSync(path.join(memDir, 'diary', '2026-11-01-2.md'), 'utf8').includes('第二篇'))
// 许可与审计
const { recordPermit, findPermit, consumePermit, activePermits, recordBreach, recentBreaches } = await import('../../being/src/index.ts')
const permitDir = path.join(stateDir, 'permit-fixture')
fs.rmSync(permitDir, { recursive: true, force: true })
const permitFish = Creature.create(permitDir, {
  schemaVersion: 1, creatureId: 'permit-fixture', name: '许可鱼', bornAt: new Date(0).toISOString(),
  timezone: 'Asia/Shanghai', model: { id: 'test', pinned: true }, temperament: DEFAULT_TEMPERAMENT,
})
const perm = recordPermit(permitFish, { action: 'comment.post', target: 'BV1xx', uses: 2, ttlMs: 60_000 })
check('许可签发后能找到', findPermit(permitFish, 'comment.post', 'BV1xx')?.id === perm.id)
consumePermit(permitFish, perm)
consumePermit(permitFish, perm)
check('次数用完就不再有效', findPermit(permitFish, 'comment.post', 'BV1xx') === null && activePermits(permitFish).length === 0)
recordBreach(permitFish, { action: 'comment.post', target: 'BV1xx', detail: '没等同意就发了' })
check('违规会被记下', recentBreaches(permitFish).length === 1)
memFish.recordNote('纸条正文', new Date(2026, 10, 1, 11, 0).getTime())
const noteFiles = fs.existsSync(path.join(memDir, 'notes')) ? fs.readdirSync(path.join(memDir, 'notes')) : []
check('小纸条单独成文件', noteFiles.length === 1 && fs.readFileSync(path.join(memDir, 'notes', noteFiles[0]), 'utf8').includes('纸条正文'))
memFish.recordProcedure('他抱怨方案时', '先问哪里不对再改', ['2'], 0.7)
const semEv = memFish.store.readEvents().find((e) => e.t === 'semantic')
if (semEv) memFish.recordReinforce(semEv.id)
const memView = memoryDetail(memFish, cfg)
check('旧数据 → legacy 视图', memView.view === 'legacy')
check('episode 映射成轮次记录', memView.stats.turnTotal === 1)
check('semantic + procedure → 两条记忆', memView.stats.memoryTotal === 2)
check('reinforce 计入提及次数', memView.memories.some((m) => m.reinforcements === 1))
check('证据标记为行号（无法回溯）', memView.memories.every((m) => m.evidenceMode === 'lines'))
check('旧数据不假装有待整理', memView.stats.pending === null)
check('按类型计数正确', memView.stats.byKind.fact === 1 && memView.stats.byKind.lesson === 1)
check('配置随详情一起返回', !!memView.config && memView.config.consolidateCap === goodCfg.consolidateCap)

console.log('== M17：memory_search 工具 ==')
const emptyMem = () => ({ search: () => [], searchHybrid: async () => [], recordHit: () => {} })
const tool = createMemoryTool({ resolve: () => null }, cfg, emptyMem)
check('工具名与参数', tool.name === 'memory_search' && tool.parameters.required[0] === 'query')
check('没有会话 → 明确说翻不了', (await tool.execute({ query: 'x' }, {})).includes('翻不了'))
check('没有鱼住 → 明确说没记忆', (await tool.execute({ query: 'x' }, { agent: { session: { id: 's1' } } })).includes('没有鱼住'))

const occupant = { resolve: () => ({ meta: { creatureId: 'c1' } }) }
const toolEmpty = createMemoryTool(occupant, cfg, emptyMem)
check('找不到 → 如实说没翻到', (await toolEmpty.execute({ query: '量子' }, { agent: { session: { id: 's1' } } })).includes('没翻到'))

const hits = [{
  kind: 'memory',
  id: 'm1',
  text: '他讨厌被当成工具人',
  record: { kind: 'fact', claim: '他讨厌被当成工具人', evidence: ['a', 'b'], attitude: '有点心疼' },
}]
const toolHit = createMemoryTool(occupant, cfg, () => ({ search: () => hits, searchHybrid: async () => hits, recordHit: () => {} }))
const out = await toolHit.execute({ query: '工具' }, { agent: { session: { id: 's1' } } })
check('命中 → 结论 + 证据数 + 态度', out.includes('他讨厌被当成工具人') && out.includes('2 轮') && out.includes('有点心疼'))

const turnLine = formatHit({ kind: 'turn', record: { ts: 0, neutral: '他说了句早', note: 'user: 早\nassistant: 早' } }, 0)
check('轮次命中给出原话', turnLine.includes('他说了句早') && turnLine.includes('原话'))

console.log('== M17：收集器端到端（scripted，不联网） ==')
const e2eDir = path.join(stateDir, 'e2e')
fs.rmSync(e2eDir, { recursive: true, force: true })
const e2eCfg = normalizeConfig({ stateDir: e2eDir, appraiser: { kind: 'scripted' } })
const e2eBinding = createBinding(e2eCfg)
const e2eFish = e2eBinding.birth('端到端鱼', { kind: 'session', id: 'se1', workspace: 'D:\\ws-e2e' })
let e2eHandler: any = null
const e2eInjected: string[] = []
const e2eAgent = { id: 'se1', session: { id: 'se1', header: { cwd: 'D:\\ws-e2e' } } }
createCollector(null, e2eBinding, e2eCfg, {
  onSessionEvent: (fn: any) => { e2eHandler = fn; return () => {} },
  onAgentCreated: () => () => {},
  agentFor: () => e2eAgent,
  inject: async (_a: any, msg: any) => { e2eInjected.push(msg.content[0].text) },
  wake: async () => {},
  voice: () => {},
  listAgents: () => [],
  listScopes: () => ({ workspaces: [], sessions: [] }),
  registerRoute: () => () => {},
  guard: () => {},
  preExecute: () => {},
  titleOf: () => '',
  nameScope: () => ({ ok: true }),
  services: () => ({}),
} as any)
const e2eSession = { id: 'se1', header: { cwd: 'D:\\ws-e2e' } }
e2eHandler(e2eSession, { type: 'turn/start', data: {} })
e2eHandler(e2eSession, { type: 'user/message', data: { role: 'user', id: 'u1', content: [{ type: 'text', text: '今天下雨了' }] } })
e2eHandler(e2eSession, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '带伞了吗' }] } } })
e2eHandler(e2eSession, { type: 'turn/end', data: {} })
await new Promise((r) => setTimeout(r, 250))
const e2eEvents = e2eFish.store.readEvents()
check('一轮结束落了一条 turn（不再写 episode）', e2eEvents.some((e: any) => e.t === 'turn') && !e2eEvents.some((e: any) => e.t === 'episode'))
check('turn 里存的是完整转录', String(e2eEvents.find((e: any) => e.t === 'turn')?.note ?? '').includes('带伞了吗'))
check('注入用的是新渲染', e2eInjected.some((t) => t.startsWith('[fishbowl 状态]')))
check('情绪跟着 turn 重放（valence 有变化）', Math.abs(e2eFish.fold().affect.valence) > 0)

// P0 回归：唤醒回合也必须带出处；否则总结会替她编一个"对方"。
e2eHandler(e2eSession, { type: 'turn/start', data: {} })
const wakeEvent = { type: 'user/message', data: injectMessage('（醒一醒。现在是 20:07。你很久没跟他说过话了。）', { mode: 'contact', reason: '很久没好好说话了' }) }
e2eHandler(e2eSession, wakeEvent)
e2eHandler(e2eSession, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '嗯。' }] } } })
e2eHandler(e2eSession, { type: 'turn/end', data: {} })
await new Promise((r) => setTimeout(r, 250))
const wakeTurn = e2eFish.store.readEvents().filter((e: any) => e.t === 'turn').slice(-1)[0]
check('唤醒回合落了一条 turn', !!wakeTurn)
check('唤醒回合的 note 有 situation', String(wakeTurn?.note ?? '').includes('situation:'))
check('唤醒回合的 note 只有 situation + assistant', String(wakeTurn?.note ?? '').includes('assistant:') && !String(wakeTurn?.note ?? '').includes('user:'))
check('recentDialog 不把 situation 当对话', !signalRecentDialog(e2eFish, 10).some((d) => d.text.includes('醒一醒')))
check('signals.recentDialog 也不把 situation 当对话', !signalRecentDialog(e2eFish, 10).some((d) => d.text.includes('醒一醒')))

// 「你没事可以刷刷 B 站」是许可：落 grant 事件，并进入下一轮注入。
e2eHandler(e2eSession, { type: 'turn/start', data: {} })
e2eHandler(e2eSession, { type: 'user/message', data: { role: 'user', id: 'u-grant', content: [{ type: 'text', text: '你没事可以刷刷 B 站' }] } })
e2eHandler(e2eSession, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '行。' }] } } })
e2eHandler(e2eSession, { type: 'turn/end', data: {} })
await new Promise((r) => setTimeout(r, 250))
e2eHandler(e2eSession, { type: 'turn/start', data: {} })
await new Promise((r) => setTimeout(r, 150))
check('许可落成 grant 事件', e2eFish.activeGrants('browse').length === 1)
check('许可进入注入（事实，不是命令）', e2eInjected.some((t) => t.includes('他允许你的事')))

console.log('== M17.1：审批策略 never 时不问 ==')
const askDec = verifyDecision({ thresholdVerify: 0.9 } as any, 'pwsh', cfg)
check('高验证门槛 → 本该 ask', askDec?.kind === 'ask')
check('策略 ask → 照问', askableDecision(askDec, 'ask')?.kind === 'ask')
check('策略 never → 不问（否则会被自动拒、还写成「用户拒绝」）', askableDecision(askDec, 'never') === null)
check('策略未知 → 照问（保守）', askableDecision(askDec, null)?.kind === 'ask')
check('本来就没决定 → null', askableDecision(null, 'ask') === null)

console.log('== M17.2：每轮工具预算 ==')
check('预算内放行', budgetVerdict(1, 3) === null && budgetVerdict(3, 3) === null)
check('超预算拒绝', typeof budgetVerdict(4, 3) === 'string')
check('0 = 不限', budgetVerdict(99, 0) === null)

const guardFns: any[] = []
const limitCfg = normalizeConfig({ stateDir: path.join(stateDir, 'limit-probe'), maxToolCallsPerTurn: 2 })
const limitBinding = createBinding(limitCfg)
limitBinding.birth('限额鱼', { kind: 'session', id: 'sl1', workspace: 'D:\\ws-limit' })
createConstraints(null, limitBinding, limitCfg, {
  guard: (fn: any) => { guardFns.push(fn); return () => {} },
  preExecute: () => () => {},
  onSessionEvent: () => () => {},
} as any)
const limitGuard = guardFns[0]
const limitExec = { agent: { session: { id: 'sl1', header: { cwd: 'D:\\ws-limit' } } }, toolName: 'glob' }
check('第 1 次放行', limitGuard(limitExec) === undefined)
check('第 2 次放行', limitGuard(limitExec) === undefined)
const overBudget = limitGuard(limitExec)
check('第 3 次被预算拦下', typeof overBudget === 'string' && overBudget.includes('这一轮'))
check('理由不甩锅给他', !String(overBudget).includes('用户'))
check('默认不限制（显示问题不该用行为去补）', normalizeConfig({}).maxToolCallsPerTurn === 0)
check('要限制时按配置生效', normalizeConfig({ maxToolCallsPerTurn: 6 }).maxToolCallsPerTurn === 6)

const freeExec = { agent: { session: { id: 'no-fish-session', header: { cwd: 'D:\\elsewhere' } } }, toolName: 'glob' }
let freeAllowed = true
for (let i = 0; i < 10; i++) if (limitGuard(freeExec) !== undefined) freeAllowed = false
check('没有鱼住的会话不受预算限制', freeAllowed)

console.log('== M17：双写检测 ==')
const lockDir = path.join(stateDir, 'lock-probe')
fs.rmSync(lockDir, { recursive: true, force: true })
fs.mkdirSync(lockDir, { recursive: true })
check('没有锁文件 → 不算双写', otherWriter(lockDir) === null)
fs.writeFileSync(path.join(lockDir, '.writer.lock'), JSON.stringify({ pid: process.pid, at: Date.now() }))
check('自己持有的锁不算别的写者', otherWriter(lockDir) === null)
fs.writeFileSync(path.join(lockDir, '.writer.lock'), JSON.stringify({ pid: 999999, at: Date.now() }))
check('死进程的锁不算活着的写者', otherWriter(lockDir) === null)
fs.writeFileSync(path.join(lockDir, '.writer.lock'), JSON.stringify({ pid: process.ppid, at: Date.now() }))
check('活着的别的进程会被报出来', otherWriter(lockDir)?.pid === process.ppid)
console.log('== M18：清醒与缺席 ==')
const H = 3_600_000
const evs = [{ t: 'episode', ts: 1_000_000 }]
check('沉默时长算得对', Math.abs((absenceHours(evs, 1_000_000 + 5 * H) ?? 0) - 5) < 1e-9)
check('没聊过 → null', absenceHours([], Date.now()) === null)
check('超过阈值 → 该记缺席', shouldRecordAbsence(evs, 1_000_000 + 9 * H, 8) === true)
check('没超过 → 不记', shouldRecordAbsence(evs, 1_000_000 + 7 * H, 8) === false)
check('同一次冷落只记一次', shouldRecordAbsence([...evs, { t: 'absence', ts: 1_000_000 + 9 * H }], 1_000_000 + 10 * H, 8) === false)
check('他回来后又冷落 → 重新记', shouldRecordAbsence([...evs, { t: 'episode', ts: 1_000_000 + 11 * H }, { t: 'absence', ts: 1_000_000 + 9 * H }], 1_000_000 + 20 * H, 8) === true)
console.log('== M19：作息配置 ==')
const r1 = pickRoutineConfig({ wake: { enabled: true, absenceHours: 99, activeWindow: ['08:00', '23:30'], interval: { mode: 'fixed', min: '60m' } } })
check('作息：合法字段保留', r1.wake.enabled === true && r1.wake.activeWindow[0] === '08:00')
check('作息：缺席阈值被钳制', r1.wake.absenceHours === 72)
check('作息：非法时段被丢弃', pickRoutineConfig({ wake: { activeWindow: ['25:00', '8:00'] } }).wake === undefined)
const r2 = pickRoutineConfig({ contact: { dailyMax: 99, minGap: '2h', window: ['09:00', '22:30'] } })
check('联系：每日上限被钳制', r2.contact.dailyMax === 10)
check('联系：时段保留', r2.contact.window[1] === '22:30')
const merged = mergeUiConfig({}, { wake: { enabled: true }, contact: { dailyMax: 1 } })
check('UI 配置能合并进运行时配置', merged.wake.enabled === true && merged.contact.dailyMax === 1)
const r3 = pickRoutineConfig({ selfTime: { enabled: true, dailyMax: 99, window: ['09:00', '23:00'], minGap: '90m' } })
check('自处：上限被钳制', r3.selfTime.enabled === true && r3.selfTime.dailyMax === 6)
const merged2 = mergeUiConfig({}, { selfTime: { enabled: true }, browse: { enabled: false, perDay: 99 } })
check('自处/上网能合并进运行时配置', merged2.selfTime.enabled === true && merged2.browse.enabled === false && merged2.browse.perDay === 4)
check('上网配置默认值', normalizeConfig({}).browse.enabled === true && normalizeConfig({}).browse.perDay === 1)
console.log('== M20：主动联系跨重启 ==')
const lateGate = new ContactGate({ window: ['20:00', '02:00'], dailyMax: 2, minGap: '1h', burst: { max: 1, per: '2h' } }, 'Asia/Shanghai')
check('跨零点时段：凌晨 1 点在', lateGate.inWindow(new Date('2026-10-31T01:00:00+08:00').getTime()))
check('跨零点时段：中午不在', !lateGate.inWindow(new Date('2026-10-31T12:00:00+08:00').getTime()))
const gateT = new ContactGate({ window: ['00:00', '23:59'], dailyMax: 2, minGap: '3h', burst: { max: 1, per: '2h' } }, 'Asia/Shanghai')
const t0 = new Date('2026-10-31T10:00:00+08:00').getTime()
gateT.hydrate([t0 - 1000, t0 - 2000])
check('hydrate 后配额生效（今天已两次）', gateT.can(t0, true).ok === false)
const gateT2 = new ContactGate({ window: ['00:00', '23:59'], dailyMax: 5, minGap: '3h', burst: { max: 5, per: '2h' } }, 'Asia/Shanghai')
gateT2.hydrate([t0 - 60_000])
check('hydrate 后最小间隔生效', gateT2.can(t0, true).reason === 'min_gap')
const ocFish = binding.birth('联系鱼')
const vBefore = ocFish.fold().affect.valence
ocFish.recordOutreach('test', Date.now())
const vAfter = ocFish.fold().affect.valence
check('outreach 事件可读', ocFish.outreachTimes().length === 1)
check('outreach 不影响情绪重放', Math.abs(vBefore - vAfter) < 1e-9)
console.log('== M25：每条鱼的配置互相独立 ==')
{
  const sdF = fs.mkdtempSync(path.join(os.tmpdir(), 'fishcfg-'))
  const base = normalizeConfig({ stateDir: sdF, wake: { enabled: true } })
  const bF = createBinding(base)
  const fa = bF.birth('甲鱼')
  const fb = bF.birth('乙鱼')
  writeFishConfig(sdF, fa.meta.creatureId, { wake: { absenceHours: 3 }, memory: { consolidateCap: 7 } })
  check('A 的覆盖生效', configFor(base, fa).wake.absenceHours === 3 && configFor(base, fa).memory.consolidateCap === 7)
  check('B 不受影响', configFor(base, fb).wake.absenceHours === base.wake.absenceHours && configFor(base, fb).memory.consolidateCap === base.memory.consolidateCap)
  check('B 没有自己的文件（继承默认）', readFishConfig(sdF, fb.meta.creatureId) === null)
  check('非法时段被丢', pickFishPatch({ wake: { activeWindow: ['99:00', '08:00'] } }).wake === undefined)
  check('成长率被钳制', pickFishPatch({ growth: 99 }).growth === 5)
  const fc = bF.birth('丙鱼')
  const n = migrateFishConfigs(base, [fa, fb, fc], { wake: { absenceHours: 9 }, memory: { consolidateCap: 12 } })
  check('只迁移没有配置的鱼', n === 2, 'migrated=' + n)
  check('迁移后各自有一份', readFishConfig(sdF, fc.meta.creatureId).wake.absenceHours === 9)
  check('已有配置的鱼不被覆盖', configFor(base, fa).wake.absenceHours === 3)
  fs.rmSync(sdF, { recursive: true, force: true })
}
console.log('== M26：唤醒循环能真的叫醒（集成） ==')
{
  const sdW = fs.mkdtempSync(path.join(os.tmpdir(), 'wake-'))
  const cfgW = normalizeConfig({ stateDir: sdW, timezone: 'Asia/Shanghai', wake: { enabled: true, firstDelayMs: 20, activeWindow: ['00:00', '23:59'], interval: { mode: 'fixed', min: '1m' } }, contact: { window: ['00:00', '23:59'], dailyMax: 5, minGap: '1m', burst: { max: 5, per: '1m' } } })
  const bW = createBinding(cfgW)
  const fW = bW.birth('唤醒鱼')
  bW.assign(fW.meta.creatureId, { kind: 'session', id: 'sw' })
  fW.recordAbsence(24) // 攒够想念，制造一个有由头的场景
  const wakes = []
  const hostW = {
    listAgents: () => [{ session: { id: 'sw', header: { cwd: 'D:\\wake-ws' } } }],
    wake: async (_a, msg) => { wakes.push(msg.content[0].text) },
    inject: async () => {},
    agentFor: () => ({ session: { id: 'sw' } }),
    voice: () => {},
    listScopes: () => ({ workspaces: [], sessions: [] }),
    registerRoute: () => () => {},
    guard: () => {}, preExecute: () => {}, titleOf: () => '', nameScope: () => ({ ok: true }), services: () => ({}),
  }
  const offW = createWakeLoop({}, bW, cfgW, hostW)
  await new Promise((r) => setTimeout(r, 500))
  offW()
  check('唤醒真的发生了（不再被异常吞掉）', wakes.length >= 1, 'wakes=' + wakes.length)
  check('唤醒文本是舞台提示', wakes[0]?.includes('醒一醒'))
  const st = JSON.parse(fs.readFileSync(path.join(sdW, 'wake-state.json'), 'utf8'))
  check('状态文件写下她的由头', Array.isArray(st.entries) && st.entries.some((e) => e.reason))
  fs.rmSync(sdW, { recursive: true, force: true })
}
console.log('== M28：被原谅 → 愧疚下降 ==')
check('原谅的话能认出来', forgivenessOf('没事，别往心里去') && forgivenessOf('算了，翻篇了') && !forgivenessOf('今天天气不错'))
{
  const sdR = fs.mkdtempSync(path.join(os.tmpdir(), 'repair-'))
  const cR = createBinding(normalizeConfig({ stateDir: sdR })).birth('愧疚鱼')
  cR.recordEpisode('test', { goalCongruence: -0.5, agency: 0.5, certainty: 0.5, normViolation: 0.8, relationalImpact: -0.5, stake: 0.5, attribution: 'self' } as any)
  const g1 = cR.fold().affect.guilt
  check('违诺让愧疚升高', g1 > 0.5, 'guilt=' + g1.toFixed(2))
  cR.recordRepair(0.35)
  const g2 = cR.fold().affect.guilt
  check('修复让愧疚下降', g2 < g1 && Math.abs(g1 - g2 - 0.35) < 1e-6, 'guilt=' + g2.toFixed(2))
  fs.rmSync(sdR, { recursive: true, force: true })
}
console.log('== M31：半衰期可配 ==')
{
  const sdH = fs.mkdtempSync(path.join(os.tmpdir(), 'halflife-'))
  const baseH = normalizeConfig({ stateDir: sdH })
  const bH = createBinding(baseH)
  const fh = bH.birth('半衰鱼')
  fh.recordEpisode('broke-promise', { goalCongruence: -0.5, agency: 0.5, certainty: 0.5, normViolation: 0.8, relationalImpact: -0.5, stake: 0.5, attribution: 'self' } as any, undefined, 1_700_000_000_000)
  const g0 = fh.affectNow(1_700_000_000_000).guilt
  fh.recordEpisode('quiet', { goalCongruence: 0, agency: 0.5, certainty: 0.5, normViolation: 0, relationalImpact: 0, stake: 0.1, attribution: 'other' } as any, undefined, 1_700_000_000_000 + 86_400_000)
  const g1 = fh.fold().affect.guilt
  check('默认半衰期：一天后大约 0.79', Math.abs(g1 / g0 - Math.pow(0.5, 1 / 3)) < 0.02, 'ratio=' + (g1 / g0).toFixed(2))
  writeFishConfig(sdH, fh.meta.creatureId, { affect: { guiltDays: 1 } })
  check('按鱼配置生效', halfLivesFor(baseH, fh.meta.creatureId).guilt === 1)
  check('非法半衰期被钳制', pickFishPatch({ affect: { guiltDays: 9999 } }).affect.guiltDays === 60)
  const other = bH.birth('对照鱼')
  check('另一条鱼不受影响', halfLivesFor(baseH, other.meta.creatureId).guilt === 3)
  fs.rmSync(sdH, { recursive: true, force: true })
}
console.log('== M35：日记时间窗 ==')
{
  const at = (hm) => new Date(`2026-11-01T${hm}:00+08:00`).getTime()
  check('22:00 在日记时间窗里', inDiaryWindow(at('22:00'), '21:30', '23:59', 'Asia/Shanghai'))
  check('09:00 不在日记时间窗里', !inDiaryWindow(at('09:00'), '21:30', '23:59', 'Asia/Shanghai'))
  check('跨午夜的时间窗也能用', inDiaryWindow(at('01:00'), '23:00', '02:00', 'Asia/Shanghai'))
  check('日记默认开、补写默认开', normalizeConfig({}).diary.enabled === true && normalizeConfig({}).diary.catchUp === true)
  check('日记时间可配置且被校验', normalizeConfig({ diary: { start: '25:00' } }).diary.start === '21:30')
  check('按鱼配置日记窗', (() => {
    const sd = fs.mkdtempSync(path.join(os.tmpdir(), 'diary-'))
    const c = normalizeConfig({ stateDir: sd })
    const b = createBinding(c)
    const f = b.birth('日记鱼')
    writeFishConfig(sd, f.meta.creatureId, { diary: { start: '23:00', end: '23:30' } })
    const ok = configFor(c, f).diary.start === '23:00'
    fs.rmSync(sd, { recursive: true, force: true })
    return ok
  })())
}
console.log('== M37：能力可以按鱼关闭 ==')
{
  const sdC = fs.mkdtempSync(path.join(os.tmpdir(), 'caps-'))
  const base = normalizeConfig({ stateDir: sdC })
  const b = createBinding(base)
  const a = b.birth('会上网')
  const c = b.birth('不上网')
  check('默认能力全开', configFor(base, a).capabilities.browse !== false)
  writeFishConfig(sdC, c.meta.creatureId, { capabilities: { browse: false } })
  check('关掉后这条鱼没有上网能力', configFor(base, c).capabilities.browse === false)
  check('另一条鱼不受影响', configFor(base, a).capabilities.browse !== false)
  check('配置校验：只认布尔', pickFishPatch({ capabilities: { browse: 0 } }).capabilities.browse === true)
  fs.rmSync(sdC, { recursive: true, force: true })
}
console.log('== M38：设置页分支完整（回归） ==')
{
  const src = fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  for (const p of ['status', 'home', 'routine', 'browse', 'persona', 'memory']) {
    check(`页签 ${p} 有分支`, src.includes(`page === '${p}'`))
  }
  const cap = (p) => p[0].toUpperCase() + p.slice(1)
  for (const p of ['status', 'home', 'routine', 'browse', 'persona', 'memory']) {
    check(`页签 ${p} 有 render 函数`, src.includes(`function render${cap(p)}()`))
    check(`页签 ${p} 在分发表里`, src.includes(`body = render${cap(p)}()`))
  }
}
console.log('== M39：能力是唯一开关（不再有重复配置） ==')
{
  const sd = fs.mkdtempSync(path.join(os.tmpdir(), 'caps2-'))
  const base = normalizeConfig({ stateDir: sd })
  const b = createBinding(base)
  const f1 = b.birth('关掉能力')
  const f2 = b.birth('留着')
  writeFishConfig(sd, f1.meta.creatureId, { capabilities: { browse: false } })
  const c1 = configFor(base, f1)
  const c2 = configFor(base, f2)
  check('关上网 → 行为字段也关', c1.browse.enabled === false)
  check('说话是上网的细节，不随能力关', c1.comment.enabled === base.comment.enabled)
  check('记忆不是能力：没有 memory 开关', c1.capabilities.memory === undefined && c1.capabilities.browse === false)
  check('另一条鱼保持默认', c2.browse.enabled !== false && c2.memory.enabled !== false)
  fs.rmSync(sd, { recursive: true, force: true })
}
console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURES'}`)
process.exit(failures === 0 ? 0 : 1)
// ===== 新建鱼时的住处选择 =====
{
  const { normalizeHousing, housingToOccupancy } = await import('../../app/src/index.js')
  const fakeHost = {
    created: [],
    async createWorkspace(p) { this.created.push(['ws', p]); return { id: p, path: p, registryId: 'w1', title: 't' } },
    async createSession(o) { this.created.push(['ss', o]); return { id: 's1', workspace: o.path || '/x' } },
  }
  const throws = (fn) => { try { fn(); return false } catch { return true } }
  check('housing：必须给一个屋子', throws(() => normalizeHousing(undefined)))
  check('housing：旧的"不安排"不再允许', throws(() => normalizeHousing({ kind: 'none' })))
  check('housing：旧的"住进现有会话"不再允许', throws(() => normalizeHousing({ kind: 'existing', type: 'session', id: 's9' })))
  check('housing：旧的"整屋"不再允许', throws(() => normalizeHousing({ kind: 'new-workspace', path: 'D:/home' })))
  check('housing：现有屋子缺路径会报错', throws(() => normalizeHousing({ kind: 'new-session', workspace: '  ' })))
  check('housing：新屋子缺目录会报错', throws(() => normalizeHousing({ kind: 'new-both', path: '  ' })))

  const occ2 = await housingToOccupancy(fakeHost, { kind: 'new-session', workspace: 'D:/home' })
  check('housing：现有屋子 → 新建一间房', occ2.kind === 'session' && occ2.id === 's1' && fakeHost.created[0][1].path === 'D:/home')
  fakeHost.created = []
  const occ3 = await housingToOccupancy(fakeHost, { kind: 'new-both', path: 'D:/home' })
  check('housing：新屋子 → 先建屋子再建房间，房间归鱼', occ3.kind === 'session' && fakeHost.created.length === 2 && fakeHost.created[0][0] === 'ws' && fakeHost.created[1][0] === 'ss')
  check('housing：不再产生工作区级住处', occ2.kind === 'session' && occ3.kind === 'session')
}
