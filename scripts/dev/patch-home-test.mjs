import fs from 'node:fs'
const p = 'packages/plugin/test/unit.test.ts'
let t = fs.readFileSync(p, 'utf8')
t = t.replaceAll("path.join(memDir, 'diary'", "path.join(memDir, 'home', 'diary'")
fs.writeFileSync(p, t)
console.log('patched', t.includes("'home', 'diary'"))
