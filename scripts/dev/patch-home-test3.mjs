import fs from 'node:fs'
const p = 'packages/plugin/test/unit.test.ts'
let t = fs.readFileSync(p, 'utf8')
const anchor = "check('同一天再写一篇不覆盖旧的', diaryFiles.length === 2 && fs.readFileSync(path.join(memDir, 'home', 'diary', '2026-11-01-2.md'), 'utf8').includes('第二篇'))"
if (!t.includes('家目录')) t = t.replace(anchor, anchor + "\ncheck('家目录与日记/小纸条目录已创建', fs.existsSync(path.join(memDir, 'home', 'diary')) && fs.existsSync(path.join(memDir, 'home', 'notes')))")
fs.writeFileSync(p, t)
console.log('patched', t.includes('家目录'))
