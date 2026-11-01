import fs from 'node:fs'
const p = 'packages/plugin/test/unit.test.ts'
let t = fs.readFileSync(p, 'utf8')
const anchor = "const e2eEvents = e2eFish.store.readEvents()"
const add = [
  "// 写保护：只有 home/ 可以改",
  "let e2eGuard: any = null",
  "createConstraints(null, e2eBinding, e2eCfg, {",
  "  guard: (fn: any) => { e2eGuard = fn; return () => {} },",
  "  onSessionEvent: () => () => {},",
  "  preExecute: () => () => {},",
  "  agentFor: () => e2eAgent,",
  "} as any)",
  "const execWrite = (filePath: string) => ({ agent: { session: e2eSession }, data: { toolName: 'write', arguments: JSON.stringify({ file_path: filePath }) } })",
  "const homePath = path.join(e2eFish.store.dir, 'home', 'x.txt')",
  "check('能改自己家目录里的文件', e2eGuard(execWrite(homePath)) === undefined)",
  "check('不能改家目录以外的东西', String(e2eGuard(execWrite('C:/Windows/System32/drivers/etc/hosts')) || '').includes('只能改你自己的文件夹'))",
  anchor,
].join('\n')
if (!t.includes('e2eGuard')) t = t.replace(anchor, add)
fs.writeFileSync(p, t)
console.log('patched', t.includes('e2eGuard'))
