/**
 * M0 验收：数值与 Python 原型一致 + 两个可搬迁性验证。
 * 运行：node src/test.ts（Node ≥ 22.18，原生类型剥离，无需构建）
 */
import fs from 'node:fs'
import path from 'node:path'
import { ContactGate } from '../../packages/schedule/src/index.ts'
import { Creature } from '../../packages/being/src/index.ts'
import { applyElapse, toBias } from '../../packages/affect/src/index.ts'
import { freshAffect } from '../../packages/affect/src/index.ts'
import { Scheduler } from '../../packages/schedule/src/index.ts'
import { wakingSecondsBetween } from '../../packages/affect/src/index.ts'
import { BASELINE_BIAS, DEFAULT_TEMPERAMENT } from '../../packages/affect/src/index.ts'
import type { Bias, CreatureMeta } from '../../packages/affect/src/index.ts'
import * as sc from './scenarios.ts'

let failures = 0
function check(name: string, cond: boolean, detail = ''): void {
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${name}${detail ? '  ' + detail : ''}`)
  if (!cond) failures++
}

const near = (a: number, b: number, eps = 0.02) => Math.abs(a - b) <= eps

function biasNear(b: Bias, expected: number[], eps = 0.02): boolean {
  const vals = [b.verbosity, b.thresholdRefuse, b.thresholdVerify, b.riskAppetite, b.disclosure, b.patience]
  return vals.every((v, i) => Math.abs(v - expected[i]) <= eps)
}

function biasDiff(a: Bias, b: Bias, eps: number): boolean {
  const va = [a.verbosity, a.thresholdRefuse, a.thresholdVerify, a.riskAppetite, a.disclosure, a.patience]
  const vb = [b.verbosity, b.thresholdRefuse, b.thresholdVerify, b.riskAppetite, b.disclosure, b.patience]
  return va.every((v, i) => Math.abs(v - vb[i]) <= eps)
}

const TMP = path.join(process.cwd(), 'test-tmp')
const TZ = 'Asia/Shanghai'
const T0 = 0 // 所有事件同一时间戳 → 无时间衰减，与 Python 逐事件演算严格可比

function meta(id: string): CreatureMeta {
  return {
    schemaVersion: 1,
    creatureId: id,
    name: id,
    bornAt: new Date(0).toISOString(),
    timezone: TZ,
    model: { id: 'test', pinned: true },
    temperament: DEFAULT_TEMPERAMENT,
  }
}

function mk(id: string): Creature {
  const dir = path.join(TMP, id)
  fs.rmSync(dir, { recursive: true, force: true })
  return Creature.create(dir, meta(id))
}

// ---------------------------------------------------------------- S1 / S2
console.log('== 数值与 Python 原型一致 ==')

const s1 = mk('s1')
const pati1: number[] = []
for (let i = 0; i < 3; i++) {
  s1.recordEpisode('rejected', sc.rejection(), undefined, T0)
  pati1.push(s1.bias().patience)
}
const b1 = s1.bias()
check('S1 全向量与 Python 一致', biasNear(b1, [0.01, 0.12, 0.60, 0.94, 0.22, 0.06]),
  JSON.stringify([b1.verbosity, b1.thresholdRefuse, b1.thresholdVerify, b1.riskAppetite, b1.disclosure, b1.patience].map(v => v.toFixed(2))))
check('S1 耐心显著下降', b1.patience < 0.30, `pati=${b1.patience.toFixed(2)}`)
check('S1 更难被说服', b1.thresholdRefuse < 0.35, `refu=${b1.thresholdRefuse.toFixed(2)}`)

const s2 = mk('s2')
const pati2: number[] = []
for (let i = 0; i < 4; i++) {
  s2.recordEpisode('hurried', sc.hurry(), undefined, T0)
  pati2.push(s2.bias().patience)
}
check('同样三次刺激，温和事件更轻', pati2[2] > pati1[2] + 0.05,
  `pati=${pati2[2].toFixed(2)} vs ${pati1[2].toFixed(2)}`)

// ---------------------------------------------------------------- S3 违诺
const s3 = mk('s3')
s3.recordEpisode('broke-promise', sc.promiseBroken(), undefined, T0)
const aff0 = s3.fold().affect
check('违诺当刻：效价触底', near(aff0.valence, -1.0, 0.05), `v=${aff0.valence.toFixed(2)}`)
check('违诺当刻：愧疚 0.60', near(aff0.guilt, 0.60, 0.02), `guilt=${aff0.guilt.toFixed(2)}`)
for (let i = 0; i < 6; i++) s3.recordEpisode('quiet', sc.neutral(), undefined, T0)
const aff6 = s3.fold().affect
check('六轮平静后情绪平复', aff6.valence > aff0.valence + 0.3, `v ${aff0.valence.toFixed(2)} -> ${aff6.valence.toFixed(2)}`)
check('同一时刻的六轮平静不改愧疚', near(aff6.guilt, aff0.guilt, 1e-9), `guilt=${aff6.guilt.toFixed(2)}`)
check('六轮平静后仍保持警惕', s3.bias().thresholdVerify > 0.65, `veri=${s3.bias().thresholdVerify.toFixed(2)}`)
check('verify 与 Python 一致', near(s3.bias().thresholdVerify, 0.78), '')

// ---------------------------------------------------------------- 心情随时间
const s5 = mk('s5')
s5.recordEpisode('broke-promise', sc.promiseBroken(), undefined, T0)
const g0 = s5.fold().affect.guilt
s5.recordEpisode('quiet', sc.neutral(), undefined, T0 + 3 * 86_400_000)
const g3d = s5.fold().affect.guilt
check('愧疚三天减半', near(g3d, g0 / 2, 0.02), `guilt ${g0.toFixed(2)} -> ${g3d.toFixed(2)}`)
const s6 = mk('s6')
s6.recordAbsence(72, T0)
const l0 = s6.fold().affect.longing
s6.recordEpisode('quiet', sc.neutral(), undefined, T0 + 2 * 86_400_000)
const l2 = s6.fold().affect.longing
check('想念两天减半', near(l2, l0 / 2, 0.02), `longing ${l0.toFixed(2)} -> ${l2.toFixed(2)}`)
const s7 = mk('s7')
// wary 的条件：对方造成的负面关系影响 + 不确定
s7.recordEpisode('wary', { goalCongruence: -0.2, agency: 0.3, certainty: 0.4, normViolation: 0, relationalImpact: -0.6, stake: 0.4, attribution: 'other' }, undefined, T0)
const w0 = s7.fold().affect.named.wary ?? 0
s7.recordEpisode('quiet', sc.neutral(), undefined, T0 + 2 * 86_400_000)
const w2 = s7.fold().affect.named.wary ?? 0
check('警惕也会随时间淡', w0 > 0.1 && w2 < w0, `wary ${w0.toFixed(2)} -> ${w2.toFixed(2)}`)
// ---------------------------------------------------------------- 只有负面情绪跟设置走
{
  const t0 = DEFAULT_TEMPERAMENT
  const af = freshAffect(t0)
  af.named.warm = 1
  af.named.curious = 1
  af.named.wary = 1
  af.guilt = 1
  applyElapse(af, 3 * 86_400, t0, { guilt: 1, longing: 1, negative: 0.1 })
  check('负面状态跟设置走（0.1 天半衰）', af.named.wary < 0.05, `wary=${af.named.wary.toFixed(3)}`)
  check('愧疚跟设置走（1 天半衰）', near(af.guilt, 0.125, 0.01), `guilt=${af.guilt.toFixed(3)}`)
  check('正面不跟设置走（温暖 3 天半衰）', near(af.named.warm, 0.5, 0.02), `warm=${af.named.warm.toFixed(2)}`)
  check('好奇按自己的固定节奏', af.named.curious < 0.05, `curious=${af.named.curious.toFixed(3)}`)
}
// ---------------------------------------------------------------- S4 缺席
const s4 = mk('s4')
s4.recordAbsence(72, T0)
const alone = s4.fold().affect
check('72 小时缺席：想念封顶', near(alone.longing, 1.0, 0.01), `longing=${alone.longing.toFixed(2)}`)
check('72 小时缺席：低落 -0.35', near(alone.valence, -0.35, 0.02), `v=${alone.valence.toFixed(2)}`)
check('72 小时缺席：披露意愿 0.70', near(s4.bias().disclosure, 0.70, 0.02), `disc=${s4.bias().disclosure.toFixed(2)}`)
s4.recordEpisode('reunion', sc.reunion(), undefined, T0)
s4.recordContact(0.6, T0)
const back = s4.fold().affect
check('重逢：效价回升 0.32', near(back.valence, 0.32, 0.03), `v=${back.valence.toFixed(2)}`)
check('重逢：想念释放 60%', near(back.longing, 0.40, 0.01), `longing=${back.longing.toFixed(2)}`)

// ---------------------------------------------------------------- 想念随时间涨
{
  const sl = mk('sl')
  const T1 = 1_800_000_000_000
  sl.recordEpisode('turn', sc.neutral(), 'user: 在吗 assistant: 在', T1)
  const l1 = sl.affectNow(T1 + 1 * 3_600_000).longing
  const l12 = sl.affectNow(T1 + 12 * 3_600_000).longing
  const l48 = sl.affectNow(T1 + 48 * 3_600_000).longing
  check('想念随时间增长', l1 < l12 && l12 < l48, `${l1.toFixed(2)} -> ${l12.toFixed(2)} -> ${l48.toFixed(2)}`)
  sl.recordEpisode('turn', sc.neutral(), 'user: 我回来了 assistant: 嗯', T1 + 48 * 3_600_000)
  const after = sl.affectNow(T1 + 48 * 3_600_000).longing
  check('互动后想念回落', after < 0.05, `after=${after.toFixed(2)}`)
}
// ---------------------------------------------------------------- 想念只算清醒时段
{
  const T = new Date('2026-11-01T00:00:00+08:00').getTime()
  const h = wakingSecondsBetween(T, T + 86_400_000, ['08:00', '23:30'], 'Asia/Shanghai') / 3600
  check('一整天有 15.5 小时清醒', near(h, 15.5, 0.1), `h=${h.toFixed(2)}`)
  const sw = mk('sw')
  const Tw = T + 20 * 3_600_000 // 当天 20:00
  sw.recordEpisode('turn', sc.neutral(), 'x', Tw)
  const awake = sw.affectNow(T + 32 * 3_600_000).longing // 次日 08:00：只醒了 3.5h
  sw.waking = { window: ['08:00', '23:30'], timezone: 'Asia/Shanghai' }
  const slept = sw.affectNow(T + 32 * 3_600_000).longing
  check('睡着的时间不算想念', slept < awake - 0.1, `with=${awake.toFixed(2)} without=${slept.toFixed(2)}`)
}
// ---------------------------------------------------------------- 死区
const db = mk('db')
for (let i = 0; i < 20; i++) db.recordEpisode('tiny', sc.tiny(), undefined, T0)
const dbAff = db.fold().affect
const dbBias = toBias(dbAff, db.meta.temperament)
check('死区：二十件小事不产生任何偏置', biasDiff(dbBias, BASELINE_BIAS, 1e-9),
  `v=${dbAff.valence.toFixed(3)} a=${dbAff.arousal.toFixed(3)}`)
check('死区数值与 Python 一致', near(dbAff.valence, 0.032, 0.005) && near(dbAff.arousal, 0.417, 0.005),
  `v=${dbAff.valence.toFixed(3)} a=${dbAff.arousal.toFixed(3)}`)

// ---------------------------------------------------------------- 联系限流
console.log('== 主动联系限流 ==')
const CONFIG = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'src', 'fixtures', 'wake-config.json'), 'utf8'))
const gate = new ContactGate(CONFIG.contact, TZ)
const at = (h: number, m: number, reason = true): string => {
  const now = Date.UTC(2026, 9, 30, h - 8, m)
  const r = gate.can(now, reason)
  if (r.ok) gate.consume(now)
  return r.reason
}
check('09:10 允许', at(9, 10) === 'ok')
check('09:40 被 min_gap 拦', at(9, 40) === 'min_gap')
check('12:40 允许', at(12, 40) === 'ok')
check('18:00 被 daily_max 拦', at(18, 0) === 'daily_max')
check('无由头被拦', at(19, 0, false) === 'no_reason')
const g2 = new ContactGate(CONFIG.contact, TZ)
check('07:30 静默时段', g2.can(Date.UTC(2026, 9, 29, 23, 30), true).reason === 'quiet_hours')
const g3 = new ContactGate(CONFIG.contact, TZ)
g3.unanswered = 3
check('连续未回应 → 停止主动', g3.can(Date.UTC(2026, 9, 30, 7, 0), true).reason === 'unanswered_stop')

// ---------------------------------------------------------------- 清醒节律
console.log('== 清醒节律 ==')
const sch = new Scheduler(CONFIG.wake, TZ, 7)
let now = Date.UTC(2026, 9, 30, 0, 0)
let inWindowAll = true
let spacedAll = true
let prev = now
for (let i = 0; i < 200; i++) {
  const nxt = sch.nextWake(now, 'active', true)
  if (nxt === null) { inWindowAll = false; break }
  if (!sch.inWindow(nxt)) inWindowAll = false
  if (nxt - prev < 30 * 60_000 - 1) spacedAll = false
  prev = nxt
  now = nxt + sch.dwellSeconds() * 1000
}
check('200 次清醒全部落在窗口内', inWindowAll)
check('间隔不小于 30 分钟下限', spacedAll)
check('idle_skip：无事可做不醒', sch.nextWake(now, 'active', false) === null)
{
  const a = sch.nextWake(now, 'active', true)!
  const b = sch.nextWake(now, 'dormant', true)!
  check('休眠态节律放慢 24 倍', b - now > (a - now) * 10,
    `${Math.round((b - now) / 60_000)}min vs ${Math.round((a - now) / 60_000)}min`)
}

// ---------------------------------------------------------------- 可搬迁性
console.log('== 可搬迁性 ==')
const migA = mk('mig-a')
for (let i = 0; i < 3; i++) migA.recordEpisode('rejected', sc.rejection(), undefined, T0)
migA.recordEpisode('broke-promise', sc.promiseBroken(), undefined, T0)
const biasA = migA.bias()

fs.cpSync(path.join(TMP, 'mig-a'), path.join(TMP, 'mig-b'), { recursive: true })
const migB = Creature.open(path.join(TMP, 'mig-b'))
const biasB = migB.bias()
check('复制目录 → 重开 → 行为一致', biasDiff(biasA, biasB, 1e-9))

migB.store.dropCache()
const biasB2 = migB.bias()
check('删投影缓存 → 全量重算 → 结果一致', biasDiff(biasB, biasB2, 1e-9))

migA.store.dropCache()
check('原实例删缓存重放也一致', biasDiff(migA.bias(), biasA, 1e-9))

// ---------------------------------------------------------------- M4 封存
console.log('== M4：封存（停止时间） ==')
const fz = mk('freeze')
const T1 = 1_000_000
fz.recordEpisode('rejected', sc.rejection(), undefined, T1)
const vBefore = fz.fold().affect.valence
fz.recordFreeze(T1 + 1000)
fz.recordUnfreeze(T1 + 1000 + 61 * 60_000) // 封存 61 分钟
fz.recordEpisode('quiet', sc.neutral(), undefined, T1 + 1000 + 61 * 60_000 + 1000)
const vAfter = fz.fold().affect.valence
// 注意：quiet 事件本身自带一次 0.85 事件衰减；时间衰减（61 分钟）应被跳过
check('封存期间时间不流逝（只剩一次事件衰减，61 分钟未计入）',
  Math.abs(vAfter - 0.85 * vBefore) < 0.01,
  `v ${vBefore.toFixed(3)} -> ${vAfter.toFixed(3)}（预期 ${(0.85 * vBefore).toFixed(3)}）`)
check('封存状态可查', fz.isFrozen() === false)
fz.recordFreeze()
check('封存后 isFrozen = true', fz.isFrozen() === true)
fz.recordUnfreeze()
check('解封恢复', fz.isFrozen() === false)

// ----------------------------------------------------------------
console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURES'}`)
process.exit(failures === 0 ? 0 : 1)
