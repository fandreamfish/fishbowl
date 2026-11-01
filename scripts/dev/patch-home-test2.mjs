import fs from 'node:fs'
const p = 'packages/plugin/test/unit.test.ts'
let t = fs.readFileSync(p, 'utf8')
t = t.replaceAll("path.join(memDir, 'notes'", "path.join(memDir, 'home', 'notes'")
fs.writeFileSync(p, t)
console.log('patched', t.includes("'home', 'notes'"))
