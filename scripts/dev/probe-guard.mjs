import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'

const { createBinding, normalizeConfig, createConstraints } = await import('file:///D:/fish-memory/packages/app/src/index.js')

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-'))
const cfg = normalizeConfig({ stateDir, appraiser: { kind: 'deepseek', apiKey: 'x' } })
const b = createBinding(cfg)
const f = b.birth('守门鱼', { kind: 'session', id: 'se1', workspace: 'D:\\ws-e2e' })
let g = null
createConstraints(null, b, cfg, {
  guard: (fn) => { g = fn; return () => {} },
  onSessionEvent: () => () => {},
  preExecute: () => () => {},
  agentFor: () => null,
})

const sess = { id: 'se1', header: { cwd: 'D:\\ws-e2e' } }
const exec = (fp) => ({ agent: { session: sess }, data: { toolName: 'write', arguments: JSON.stringify({ file_path: fp }) } })

console.log('manages:', b.manages('se1'))
console.log('occupant:', b.occupantOf({ sessionId: 'se1' })?.meta?.name)
console.log('home:', path.join(f.store.dir, 'home', 'x.txt'))
console.log('inside:', g(exec(path.join(f.store.dir, 'home', 'x.txt'))))
console.log('outside:', g(exec('C:/Windows/System32/drivers/etc/hosts')))
