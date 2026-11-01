import fs from 'node:fs'
const p = 'packages/plugin/test/unit.test.ts'
let t = fs.readFileSync(p, 'utf8')

t = t.replace("const e2eInjected: string[] = []", "const e2eInjected: string[] = []\nconst e2eSections: any[] = []\nlet e2eCreated: any = null")
t = t.replace("  onAgentCreated: () => () => {},", "  onAgentCreated: (fn: any) => { e2eCreated = fn; return () => {} },\n  stateSection: (_a: any, fn: any) => { e2eSections.push(fn) },")
t = t.replace("const e2eSession = { id: 'se1', header: { cwd: 'D:\\\\ws-e2e' } }", "const e2eSession = { id: 'se1', header: { cwd: 'D:\\\\ws-e2e' } }\ne2eCreated?.({ agent: e2eAgent })")
t = t.replace("check('注入用的是新渲染', e2eInjected.some((t) => t.startsWith('[fishbowl 状态]')))",
  "const e2eBuild = () => String(e2eSections.at(-1)?.({ agent: { session: e2eSession } }) ?? '')\ncheck('状态块由动态系统提示段提供', e2eBuild().startsWith('[fishbowl 状态]'))")
t = t.replace("check('许可进入注入（事实，不是命令）', e2eInjected.some((t) => t.includes('他允许你的事')))",
  "check('许可进入状态块（事实，不是命令）', e2eBuild().includes('他允许你的事'))")
fs.writeFileSync(p, t)
console.log('test patched', t.includes('e2eSections'), t.includes('状态块由动态'))
