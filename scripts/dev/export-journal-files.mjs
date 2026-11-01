import fs from 'node:fs'
import path from 'node:path'

const root = path.join(process.env.USERPROFILE, '.fishbowl', 'creatures')
const pad = (n) => String(n).padStart(2, '0')
let wrote = 0
for (const name of fs.readdirSync(root)) {
  const dir = path.join(root, name)
  const log = path.join(dir, 'log.ndjson')
  if (!fs.existsSync(log)) continue
  for (const line of fs.readFileSync(log, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue
    let e
    try { e = JSON.parse(line) } catch { continue }
    if (e.t === 'diary') {
      const d = new Date(e.ts)
      const out = path.join(dir, 'home', 'diary')
      fs.mkdirSync(out, { recursive: true })
      const file = path.join(out, `${e.date}.md`)
      fs.writeFileSync(file, `# ${e.date} ${pad(d.getHours())}:${pad(d.getMinutes())}\n\n${String(e.text).trim()}\n`, 'utf8')
      wrote++
      console.log('diary', file)
    } else if (e.t === 'note') {
      const d = new Date(e.ts)
      const out = path.join(dir, 'home', 'notes')
      fs.mkdirSync(out, { recursive: true })
      const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
      let file = path.join(out, `${stamp}.md`)
      let n = 1
      while (fs.existsSync(file)) file = path.join(out, `${stamp}-${n++}.md`)
      fs.writeFileSync(file, String(e.text).trim() + '\n', 'utf8')
      wrote++
      console.log('note ', file)
    }
  }
}
console.log('wrote', wrote)
