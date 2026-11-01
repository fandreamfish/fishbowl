/** 跑全部测试套件：以退出码为准（不是靠数 [FAIL] 行）。 */
import { spawnSync } from 'node:child_process'

const suites = [
  'src/test.ts',
  'packages/memory/test/unit.test.ts',
  'packages/plugin/test/unit.test.ts',
  'packages/plugin/test/browse.test.ts',
  'packages/plugin/test/bili.test.ts',
  'packages/bridge-qq/test/unit.test.ts',
  'scripts/smoke/m7-apply-smoke.ts',
]

let bad = 0
for (const s of suites) {
  const r = spawnSync(process.execPath, [s], { stdio: 'inherit' })
  if (r.status !== 0) {
    bad++
    console.error(`\n[FAIL] ${s} exit=${r.status}`)
  }
}
if (bad) {
  console.error(`\n${bad} 套件失败`)
  process.exit(1)
}
console.log('\n全部通过')
