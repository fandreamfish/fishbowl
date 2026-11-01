import fs from 'node:fs'
const p = 'scripts/dev/export-journal-files.mjs'
let t = fs.readFileSync(p, 'utf8')
t = t.replace("const out = path.join(dir, 'diary')", "const out = path.join(dir, 'home', 'diary')")
t = t.replace("const out = path.join(dir, 'notes')", "const out = path.join(dir, 'home', 'notes')")
fs.writeFileSync(p, t)
console.log('export script', t.includes("'home', 'diary'"))

// host 注释同步
const q = 'packages/adapter-dsh/src/host.js'
let h = fs.readFileSync(q, 'utf8')
h = h.replace('// 她的数据目录在房间之外（creatures/<id>）：workspace-write 会拒绝写入，改成完全访问', '// 她的家（creatures/<id>/home）在房间之外：workspace-write 会拒绝写入，改成完全访问（写入范围由工具层守卫限制）')
fs.writeFileSync(q, h)
console.log('host comment', h.includes('她的家（creatures/<id>/home）'))
