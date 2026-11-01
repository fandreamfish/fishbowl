import { Creature } from '../../packages/being/src/creature.ts'
const c = Creature.open('C:/Users/24358/.fishbowl/creatures/bbec32a5-a3a2-4be7-9d46-5d73b9cd11d9')
let guilt = 0
let n = 0
for (const e of c.store.readEvents()) {
  if (e.t === 'turn' && e.appraisal && e.appraisal.normViolation > 0) {
    guilt = Math.min(1, guilt + 1.2 * e.appraisal.normViolation)
    n++
    if (n <= 8) console.log('第' + n + '次违诺 nv=' + e.appraisal.normViolation + ' → guilt=' + guilt.toFixed(2))
  }
  if (e.t === 'repair') { guilt = Math.max(0, guilt - e.amount); console.log('修复 -' + e.amount + ' → ' + guilt.toFixed(2)) }
}
console.log('最终 guilt =', guilt.toFixed(2), '| 修复事件数:', c.store.readEvents().filter(e=>e.t==='repair').length)
