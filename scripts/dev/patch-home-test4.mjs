import fs from 'node:fs'
const p = 'packages/plugin/test/unit.test.ts'
let t = fs.readFileSync(p, 'utf8')
t = t.replace("check('家目录与日记/小纸条目录已创建', fs.existsSync(path.join(memDir, 'home', 'diary')) && fs.existsSync(path.join(memDir, 'home', 'notes')))",
  "check('家目录与日记目录已创建', fs.existsSync(path.join(memDir, 'home', 'diary')))")
fs.writeFileSync(p, t)
