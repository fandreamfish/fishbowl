import fs from 'node:fs'
const p = 'packages/plugin/test/unit.test.ts'
let t = fs.readFileSync(p, 'utf8')
const anchor = "check('不能改家目录以外的东西', String(e2eGuard(execWrite('C:/Windows/System32/drivers/etc/hosts')) || '').includes('只能改你自己的文件夹'))"
const add = [
  anchor,
  "const execSh = (command: string) => ({ agent: { session: e2eSession }, data: { toolName: 'pwsh', arguments: JSON.stringify({ command }) } })",
  "check('不能写相对路径（cwd 在房间里）', String(e2eGuard(execSh('Set-Content x.txt hi')) || '').includes('绝对路径'))",
  "check('写自己家目录可以', e2eGuard(execSh('Set-Content \"' + homePath + '\" hi')) === undefined)",
].join('\n')
if (!t.includes('不能写相对路径')) t = t.replace(anchor, add)
fs.writeFileSync(p, t)
console.log('patched', t.includes('不能写相对路径'))
