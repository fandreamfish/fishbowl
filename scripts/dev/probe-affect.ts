import { Creature } from '../../src/core/creature.ts'
const c = Creature.open('C:/Users/24358/.fishbowl/creatures/bbec32a5-a3a2-4be7-9d46-5d73b9cd11d9')
const a = c.affectNow()
console.log('效价', a.valence.toFixed(2), '唤醒', a.arousal.toFixed(2), '愧疚', a.guilt.toFixed(2), '想念', a.longing.toFixed(2))
