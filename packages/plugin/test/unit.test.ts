/** 插件单元测试：评价器、注入摘要、约束决策、会话↔个体绑定。 */
import fs from 'node:fs'
import path from 'node:path'
import { dedupeConsolidation, parseConsolidation, shouldConsolidate } from '../../../src/core/consolidation.ts'
import { ACTIVITY_RE, mergePendingText, parseActivity } from '../../../src/core/activity.ts'
import { CHANNELS, memoryForChannel } from '../../../src/core/channels.ts'
import { COMMITMENT_RE, parseBroken, parseCommitment, REQUEST_RE } from '../../../src/core/commitment.ts'
import { parseSelf, shouldSelfConsolidate } from '../../../src/core/selfmodel.ts'
import * as sc from '../../../src/scenarios.ts'
import { appraiseScripted } from '../lib/appraiser.js'
import { createBinding } from '../lib/binding.js'
import { normalizeConfig } from '../lib/config.js'
import { guardVerdict, refuseReason, verifyDecision } from '../lib/constraints.js'
import { isFishbowlInjection, messageText, textOf, toolNameOf } from '../lib/extract.js'
import { IDENTITY_RE, parseIdentity } from '../lib/identity.js'
import { injectMessage, stateKey, summaryText } from '../lib/injector.js'
import { proactivePrompt, wakeReason } from '../lib/life.js'
import { mergeUiConfig, seedChanged, summarizeEvent } from '../lib/ui-route.js'
import { canAsk, localDate, parseDiary, parseNote, parseRequest } from '../lib/journal.js'
import { scopeKey, scopeTitle } from '../lib/rename.js'
import { matchClaims } from '../../../src/core/recall.ts'
import { recallBlock, recentBlock } from '../lib/injector.js'
import { findConflict, resolveOccupant } from '../../../src/core/tenancy.ts'
import { VOICE_RULES, voiceRulesFor } from '../lib/voice.js'
import { isRelationClaim, layerInterval, layerRate, memoryWindowDays, minEvidence } from '../../../src/core/growth.ts'

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

console.log('== M2：巩固与身份 ==')
check('战术层 g=1：2 轮触发', shouldConsolidate({ episodesSince: 2, salienceSince: 0, sinceLast: 99, g: 1, layer: 'tactic' }))
check('战术层 g=1：1 轮不触发', !shouldConsolidate({ episodesSince: 1, salienceSince: 0, sinceLast: 99, g: 1, layer: 'tactic' }))
check('偏好层 g=1：5 轮触发', shouldConsolidate({ episodesSince: 5, salienceSince: 0, sinceLast: 99, g: 1, layer: 'preference' }))
check('偏好层 g=1：4 轮不触发', !shouldConsolidate({ episodesSince: 4, salienceSince: 0, sinceLast: 99, g: 1, layer: 'preference' }))
check('关系层 g=1：10 轮触发', shouldConsolidate({ episodesSince: 10, salienceSince: 0, sinceLast: 99, g: 1, layer: 'relation' }))
check('关系层 g=1：9 轮不触发', !shouldConsolidate({ episodesSince: 9, salienceSince: 0, sinceLast: 99, g: 1, layer: 'relation' }))
check('g=2 偏好层：3 轮触发（成长更快）', shouldConsolidate({ episodesSince: 3, salienceSince: 0, sinceLast: 99, g: 2, layer: 'preference' }))
check('高显著度单轮触发', shouldConsolidate({ episodesSince: 1, salienceSince: 0.7, sinceLast: 99, g: 1 }))
check('冷却期：刚巩固过不触发', !shouldConsolidate({ episodesSince: 5, salienceSince: 1, sinceLast: 1, g: 1 }))
const dc = dedupeConsolidation(
  parseConsolidation('{"semantics":[{"claim":"他喜欢猫","evidence":["1"],"confidence":0.8}],"procedures":[]}'),
  { semantics: ['他喜欢猫'], procedures: [] },
)
check('去重：已有事实不再落盘', dc.semantics.length === 0)
const pc = parseConsolidation('{"semantics":[{"claim":"他喜欢猫","evidence":["1","2"],"confidence":0.8}],"procedures":[{"trigger":"他说不行","action":"先问清楚","evidence":["3"],"confidence":0.7}]}')
check('巩固解析：语义与教训', pc.semantics.length === 1 && pc.procedures.length === 1 && pc.semantics[0].claim === '他喜欢猫')
check('巩固解析：垃圾输入得空数组', parseConsolidation('垃圾').semantics.length === 0)
check('巩固解析：语义上限 3', parseConsolidation('{"semantics":[{"claim":"a","evidence":["1","2"]},{"claim":"b","evidence":["1","2"]},{"claim":"c","evidence":["1","2"]},{"claim":"d","evidence":["1","2"]}]}').semantics.length === 3)
check('巩固解析：偏好需 ≥2 证据', parseConsolidation('{"semantics":[{"claim":"他喜欢猫","evidence":["1"],"confidence":0.9}]}').semantics.length === 0)
check('巩固解析：关系类需 ≥3 证据', parseConsolidation('{"semantics":[{"claim":"我们之间的信任在变好","evidence":["1","2"],"confidence":0.9}]}').semantics.length === 0)
check('巩固解析：关系类 3 证据通过', parseConsolidation('{"semantics":[{"claim":"我们之间的信任在变好","evidence":["1","2","3"],"confidence":0.9}]}').semantics.length === 1)
check('身份正则预筛', IDENTITY_RE.test('我给你起个名字叫大肥鱼') && !IDENTITY_RE.test('今天天气不错'))
check('身份解析', parseIdentity('{"named":true,"name":"大肥鱼"}') === '大肥鱼')
check('身份解析：未命名 → null', parseIdentity('{"named":false}') === null)

console.log('== M2.2：自我认知（证据门槛） ==')
check('自我巩固：默认 120 轮触发', shouldSelfConsolidate({ episodesSince: 120, sinceLast: 99, g: 1 }))
check('自我巩固：119 轮不触发', !shouldSelfConsolidate({ episodesSince: 119, sinceLast: 99, g: 1 }))
check('自我巩固：冷却', !shouldSelfConsolidate({ episodesSince: 121, sinceLast: 50, g: 1 }))
check('自我巩固：interval 覆盖（测试用）', shouldSelfConsolidate({ episodesSince: 12, sinceLast: 99, g: 1, interval: 12 }))
const ps = parseSelf('{"self":[{"claim":"被否定时先问清楚","evidence":["2","5","8"],"confidence":0.9},{"claim":"容易生气","evidence":["3"],"confidence":0.8}]}')
check('证据门槛：单证据的自我描述被拒', ps.length === 1 && ps[0].claim === '被否定时先问清楚')
check('置信度按证据数换算', Math.abs(ps[0].confidence - 1) < 1e-9)
check('自我认知垃圾输入 → 空', parseSelf('垃圾').length === 0)

const bindingM2 = createBinding(cfg)
const named = bindingM2.birth('大肥鱼', { kind: 'session', id: 'session-m2-named' })
named.recordIdentity('大肥鱼')
check('起名：meta 更新 + 事件落盘', named.meta.name === '大肥鱼'
  && named.store.readEvents().some((e: any) => e.t === 'identity'))
named.recordSemantic('他喜欢猫', ['1', '2'], 0.8)
named.recordProcedure('他说不行', '先问清楚', ['3'], 0.7)
const ms = named.memorySummary()
check('记忆摘要：名字 + 语义 + 教训', ms.name === '大肥鱼'
  && ms.semantics.includes('他喜欢猫') && ms.procedures.includes('他说不行 → 先问清楚'))
const namedSummary = summaryText(baseBias, baseAff, ms)
check('注入含名字与记忆', namedSummary.includes('大肥鱼')
  && namedSummary.includes('记得的事') && namedSummary.includes('教训'))
check('未起名个体不含名字行', !summaryText(baseBias, baseAff, { name: null, semantics: [], procedures: [] }).includes('名字:'))
check('记忆变化触发新指纹', stateKey(baseBias, baseAff, { name: '大肥鱼', semantics: ['x'], procedures: [] })
  !== stateKey(baseBias, baseAff, { name: null, semantics: [], procedures: [] }))

named.recordSelf('被否定时先问清楚而不是辩解', ['2', '5'], 0.67)
const ms2 = named.memorySummary()
check('memorySummary 含自我认知', ms2.self.includes('被否定时先问清楚而不是辩解'))
const selfSummary = summaryText(baseBias, baseAff, ms2)
check('注入含自我认知区', selfSummary.includes('自我认知:'))
check('无自我认知时引导说"还不确定"', summaryText(baseBias, baseAff).includes('还没有足够的经历'))
check('自我认知变化触发新指纹', stateKey(baseBias, baseAff, { name: null, semantics: [], procedures: [], self: ['x'] })
  !== stateKey(baseBias, baseAff, { name: null, semantics: [], procedures: [], self: [] }))

console.log('== M2.4：承诺与关系原型 ==')
check('承诺预筛', COMMITMENT_RE.test('我明天帮你整理。') && COMMITMENT_RE.test('可以。') && COMMITMENT_RE.test('行。你笔记在哪儿？') && !COMMITMENT_RE.test('今天天气不错。'))
check('请求预筛', REQUEST_RE.test('明天帮我整理一下可以吗？') && !REQUEST_RE.test('今天天气不错。'))
check('承诺解析', parseCommitment('{"committed":true,"text":"明天整理笔记"}') === '明天整理笔记')
check('承诺解析：未承诺 → null', parseCommitment('{"committed":false}') === null)
check('违诺解析：越界拒绝', parseBroken('{"broken":true,"index":5}', 2) === null)
check('违诺解析', parseBroken('{"broken":true,"index":0}', 2) === 0)
check('声音：companion 有额外语域', voiceRulesFor('companion').length > VOICE_RULES.length)
check('声音：未知原型回退', voiceRulesFor('nonsense') === VOICE_RULES)

named.recordCommitment('明天整理你的笔记')
const oc = named.openCommitments()
check('未了结承诺可见', oc.some(c => c.text === '明天整理你的笔记'))
const newest = oc.filter(c => c.text === '明天整理你的笔记').at(-1) ?? oc.at(-1)!
named.resolveCommitment(newest.id, 'broken')
const oc2 = named.openCommitments()
check('broken 的承诺不消失（没翻篇）', oc2.some(c => c.broken))
const ms3 = named.memorySummary()
check('注入含未完成的承诺（⚠ 标记）', ms3.commitments.some(c => c.includes('⚠')))
check('摘要含承诺区', summaryText(baseBias, baseAff, ms3).includes('未完成的承诺'))

console.log('== M3.0：清醒与主动联系（纯决策） ==')
check('唤醒由头：先还债', (wakeReason({ openBroken: 1, longing: 0.9 })?.reason ?? '').includes('答应过'))
check('唤醒由头：再想念', (wakeReason({ openBroken: 0, longing: 0.5 })?.reason ?? '').includes('很久没'))
check('无事不开口', wakeReason({ openBroken: 0, longing: 0.2 }).reason === null)
check('proactivePrompt 含由头与声音规则', proactivePrompt('很久没好好说话了', '名字：大肥鱼').includes('很久没好好说话了'))
const m3cfg = normalizeConfig({ stateDir })
check('wake 默认关闭（先观察后打开）', m3cfg.wake.enabled === false)
check('contact 默认配额', m3cfg.contact.dailyMax === 2 && m3cfg.contact.unansweredStop === 3)
const wakeCfg = normalizeConfig({ stateDir, wake: { enabled: true } })
check('wake 可显式打开', wakeCfg.wake.enabled === true)

console.log('== M3.1：通道与投递队列 ==')
const fullMem = { name: '大肥鱼', semantics: ['他喜欢猫'], procedures: ['x'], self: ['y'], commitments: ['z'] }
check('intimate 全给', memoryForChannel(fullMem, 'intimate').semantics.length === 1)
check('social 只给名字', memoryForChannel(fullMem, 'social').semantics.length === 0 && memoryForChannel(fullMem, 'social').name === '大肥鱼')
check('public 什么都不给', memoryForChannel(fullMem, 'public').name === null && memoryForChannel(fullMem, 'public').commitments.length === 0)
check('通道表：qq-group 是 public', CHANNELS['qq-group'].register === 'public')
check('通道表：dsm-session 是 intimate', CHANNELS['dsm-session'].register === 'intimate')

const q = named.store
const oid = 'o-' + Date.now()
q.appendOutbox({ id: oid, ts: Date.now(), text: 'hi', channel: 'dsm-session', delivered: false })
check('投递队列：入队可读', q.readOutbox().some(o => o.id === oid && !o.delivered))
q.appendOutbox({ id: oid, ts: Date.now(), text: 'dup', channel: 'dsm-session', delivered: false })
check('投递队列：id 幂等去重', q.readOutbox().filter(o => o.id === oid).length === 1)
q.markOutboxDelivered(oid)
check('投递队列：标记已投', q.readOutbox().some(o => o.id === oid && o.delivered))

console.log('== M3.2：共享活动与积压合并 ==')
check('活动预筛', ACTIVITY_RE.test('我们一起看《三体》吧') && !ACTIVITY_RE.test('今天天气不错'))
check('活动解析', parseActivity('{"changed":true,"title":"看《三体》","status":"started"}')?.title === '看《三体》')
check('活动解析：无变化 → null', parseActivity('{"changed":false}') === null)
named.recordActivity('看《三体》', 'started')
check('当前活动可见', named.currentActivity() === '看《三体》')
named.recordActivity('看《三体》', 'ended')
check('活动结束后清空', named.currentActivity() === null)
check('注入含活动行', summaryText(baseBias, baseAff, { ...ms3, activity: '看《三体》' }).includes('正在一起做的事'))
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

console.log('== M6：记忆重量、折叠与回忆 ==')
const m6 = binding.birth('记忆鱼', { kind: 'session', id: 'session-m6-memory-' + Date.now() })
const nowMs = Date.now()
const dayMs = 86_400_000
m6.recordSemantic('他喜欢猫', ['e1', 'e2'], 0.6, nowMs - 1 * dayMs)
m6.recordSemantic('他讨厌被催', ['e1', 'e2'], 0.7, nowMs - 1 * dayMs)
const claims0 = m6.claimsWithWeight(1)
check('记忆带重量', claims0.length >= 2 && claims0[0].weight >= claims0[1].weight)
const before = m6.memorySummary(1).semantics
const favor = m6.findClaim('他喜欢猫')
check('按原文找到认知 id', typeof favor === 'string')
for (let i = 0; i < 4; i++) m6.recordReinforce(favor!, nowMs)
const after = m6.memorySummary(1).semantics
check('被反复提到 → 重量上升、优先注入', after[0] === '他喜欢猫', `before=${before.join('/')} after=${after.join('/')}`)
check('强化次数被记录', (m6.claimsWithWeight(1).find(c => c.text === '他喜欢猫')?.hits ?? 0) === 4)

const old = m6.claimTexts('semantic').length
m6.recordSemantic('很久以前的一件小事', ['e1', 'e2'], 0.9, nowMs - 200 * dayMs)
const ms6 = m6.memorySummary(1)
check('超过窗口的记忆被折叠（不逐个注入）', !ms6.semantics.includes('很久以前的一件小事') && ms6.folded >= 1, `folded=${ms6.folded}`)
check('折叠不等于删除（账本还在）', old + 1 === m6.claimTexts('semantic').length)
const rec = m6.recall(1, 8)
check('回忆能翻出旧事', rec.some(c => c.text === '很久以前的一件小事'))
check('注入含折叠提示', summaryText(baseBias, baseAff, ms6).includes('记不清'))

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
console.log('== M13：话题回忆 ==')
const claimsTest = [
  { id: 'a', kind: 'semantic', text: '用户讨厌被贬低自己喜欢的东西' },
  { id: 'b', kind: 'semantic', text: '用户周六休息，不上班' },
]
check('提到相关话题 → 想起来', matchClaims(claimsTest, '你还记得我讨厌什么吗', 2)[0]?.id === 'a')
check('无关话题 → 不想起来', matchClaims(claimsTest, '今天天气不错', 2).length === 0)
check('回忆块渲染', recallBlock([{ text: '用户讨厌被贬低' }]).includes('用户讨厌被贬低'))
check('空回忆 → 空串', recallBlock([]) === '')
console.log('== M13：同一工作区的多个会话共享一只鱼 ==')
const shareWs = 'D:\\ws-share-' + Date.now()
const shared = binding.birth('共享鱼', { kind: 'workspace', id: shareWs })
const s1 = { sessionId: 'share-a-' + Date.now(), workspace: shareWs }
const s2 = { sessionId: 'share-b-' + Date.now(), workspace: shareWs }
const cA = binding.resolve(s1)
const cB = binding.resolve(s2)
check('两个会话解析到同一只鱼', cA && cB && cA.meta.creatureId === cB.meta.creatureId && cA.meta.creatureId === shared.meta.creatureId)
shared.recordSemantic('他每天早上七点起', ['e1', 'e2'], 0.8)
shared.recordEpisode('joy', { goalCongruence: 1, agency: 0.5, certainty: 0.8, normViolation: 0, relationalImpact: 0.5, stake: 0.5, attribution: 'other' })
check('记忆共享（同一个体摘要）', cA.memorySummary().semantics.includes('他每天早上七点起'))
check('情绪共享（同一个体状态）', Math.abs(cA.fold().affect.valence - cB.fold().affect.valence) < 1e-9)
check('工作区里的会话级解析也指向它', binding.occupantOf(s1)?.meta.creatureId === shared.meta.creatureId)
console.log('== M14：跨会话原文记忆 ==')
shared.recordEpisode('turn', { goalCongruence: 0.5, agency: 0.5, certainty: 0.7, normViolation: 0, relationalImpact: 0.3, stake: 0.4, attribution: 'other' }, 'user: 我每天早上七点起 assistant: 记下了')
const rd = shared.recentDialog(5)
check('最近对话含原文', rd.length >= 1 && rd[rd.length - 1].text.includes('七点'))
check('按话题翻原文', shared.episodeMatches('我几点起', 2).length >= 1)
check('无关话题翻不到', shared.episodeMatches('量子力学', 2).length === 0)
check('最近对话渲染', recentBlock([{ ts: Date.now(), text: 'abc' }]).includes('abc'))
check('最近对话有上限', recentBlock(Array.from({ length: 50 }, (_, i) => ({ ts: Date.now(), text: 'x'.repeat(200) + i })), 800).length <= 900)
console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURES'}`)
process.exit(failures === 0 ? 0 : 1)
