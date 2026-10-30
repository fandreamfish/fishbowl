/** 演示：四组剧本 + 死区 + 联系限流 + 清醒节律。输出格式对齐 Python 原型。 */
import fs from 'node:fs'
import path from 'node:path'
import { ContactGate } from './core/contact.ts'
import { Creature } from './core/creature.ts'
import { toBias } from './core/engine.ts'
import { Scheduler } from './core/scheduler.ts'
import { BASELINE_BIAS, DEFAULT_TEMPERAMENT } from './core/types.ts'
import type { Bias, CreatureMeta } from './core/types.ts'
import * as sc from './scenarios.ts'

const TMP = path.join(process.cwd(), 'demo-tmp')
const TZ = 'Asia/Shanghai'
const T0 = 0

function mk(id: string): Creature {
  const meta: CreatureMeta = {
    schemaVersion: 1, creatureId: id, name: id, bornAt: new Date(0).toISOString(),
    timezone: TZ, model: { id: 'demo', pinned: true }, temperament: DEFAULT_TEMPERAMENT,
  }
  const dir = path.join(TMP, id)
  fs.rmSync(dir, { recursive: true, force: true })
  return Creature.create(dir, meta)
}

const COLS: { key: keyof Bias; label: string }[] = [
  { key: 'verbosity', label: 'verb' },
  { key: 'thresholdRefuse', label: 'refu' },
  { key: 'thresholdVerify', label: 'veri' },
  { key: 'riskAppetite', label: 'risk' },
  { key: 'disclosure', label: 'disc' },
  { key: 'patience', label: 'pati' },
]

function header(): void {
  console.log(''.padEnd(18) + '     v     a  guilt  ' + COLS.map(c => c.label.padStart(5)).join(' '))
}

function row(label: string, v: number, a: number, guilt: number, b: Bias): void {
  console.log(label.padEnd(18)
    + `${v.toFixed(2).padStart(6)}${a.toFixed(2).padStart(6)}${guilt.toFixed(2).padStart(7)}`
    + COLS.map(c => b[c.key].toFixed(2).padStart(6)).join(''))
}

function baselineRow(): void {
  row('baseline', 0, 0.35, 0, BASELINE_BIAS)
}

// ---------------------------------------------------------------- 剧本
function runScenario(id: string, steps: { label: string; record: (c: Creature) => void }[]): void {
  const c = mk(id)
  header()
  baselineRow()
  for (const s of steps) {
    s.record(c)
    const aff = c.fold().affect
    row(s.label, aff.valence, aff.arousal, aff.guilt, toBias(aff, c.temperament))
  }
}

console.log('=== S1  连续三次被否定 ===')
runScenario('s1', [1, 2, 3].map(i => ({
  label: `${i}. rejected`,
  record: c => c.recordEpisode('rejected', sc.rejection(), undefined, T0),
})))

console.log('\n=== S2  连续四次被催 ===')
runScenario('s2', [1, 2, 3, 4].map(i => ({
  label: `${i}. hurried`,
  record: c => c.recordEpisode('hurried', sc.hurry(), undefined, T0),
})))

console.log('\n=== S3  违背承诺，然后六轮平静 ===')
runScenario('s3', [
  { label: 'broke promise', record: c => c.recordEpisode('broke', sc.promiseBroken(), undefined, T0) },
  ...[1, 2, 3, 4, 5, 6].map(i => ({
    label: `${i}. quiet`,
    record: c => c.recordEpisode('quiet', sc.neutral(), undefined, T0),
  })),
])

console.log('\n=== S4  72 小时缺席，然后重逢 ===')
{
  const c = mk('s4')
  header()
  baselineRow()
  c.recordAbsence(72, T0)
  let aff = c.fold().affect
  row('72h alone', aff.valence, aff.arousal, aff.guilt, toBias(aff, c.temperament))
  c.recordEpisode('reunion', sc.reunion(), undefined, T0)
  c.recordContact(0.6, T0)
  aff = c.fold().affect
  row('reunion', aff.valence, aff.arousal, aff.guilt, toBias(aff, c.temperament))
}

console.log('\n=== 死区：二十次微不足道的事件 ===')
{
  const c = mk('db')
  for (let i = 0; i < 20; i++) c.recordEpisode('tiny', sc.tiny(), undefined, T0)
  const aff = c.fold().affect
  console.log(`  v=${aff.valence.toFixed(3)}  a=${aff.arousal.toFixed(3)}  → bias=${JSON.stringify(toBias(aff, c.temperament))}`)
}

// ---------------------------------------------------------------- 联系与节律
console.log('\n=== 主动联系：分层限流 ===')
{
  const CONFIG = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'src', 'config.json'), 'utf8'))
  const gate = new ContactGate(CONFIG.contact, TZ)
  const at = (h: number, m: number, reason = true): void => {
    const now = Date.UTC(2026, 9, 30, h - 8, m)
    const r = gate.can(now, reason)
    const hh = String(h).padStart(2, '0')
    const mm = String(m).padStart(2, '0')
    console.log(`  ${hh}:${mm}  ${r.ok ? 'ALLOW' : 'BLOCK'}  ${r.reason}`)
    if (r.ok) gate.consume(now)
  }
  at(9, 10)
  at(9, 40)
  at(12, 40)
  at(18, 0)
  at(19, 0, false)

  const g2 = new ContactGate(CONFIG.contact, TZ)
  const r2 = g2.can(Date.UTC(2026, 9, 29, 23, 30), true)
  console.log(`  07:30  ${r2.ok ? 'ALLOW' : 'BLOCK'}  ${r2.reason}`)

  const g3 = new ContactGate(CONFIG.contact, TZ)
  g3.unanswered = 3
  const r3 = g3.can(Date.UTC(2026, 9, 30, 7, 0), true)
  console.log(`  15:00  ${r3.ok ? 'ALLOW' : 'BLOCK'}  ${r3.reason}  (unanswered_stop)`)

  console.log('\n=== 清醒节律：24 小时采样 ===')
  const sch = new Scheduler(CONFIG.wake, TZ, 7)
  let now = Date.UTC(2026, 9, 30, 0, 0)
  for (let i = 0; i < 12; i++) {
    const nxt = sch.nextWake(now, 'active', true)
    if (nxt === null) break
    const d = new Date(nxt)
    const hh = String(d.getUTCHours() + 8).padStart(2, '0')
    const mm = String(d.getUTCMinutes()).padStart(2, '0')
    console.log(`  10-30 ${hh}:${mm}`)
    now = nxt + sch.dwellSeconds() * 1000
  }
}
