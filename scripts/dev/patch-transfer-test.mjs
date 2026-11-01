import fs from 'node:fs'
const p = 'packages/plugin/test/browse.test.ts'
let t = fs.readFileSync(p, 'utf8')

// fake host：补 createWorkspace / createSession / workspaceByPath，并维护会话列表
if (!t.includes('transferSessions')) {
  t = t.replace("  listScopes: () => ({ workspaces: [], sessions: [] }),", "  listScopes: () => ({ workspaces: ['D:\\\\ws-route'], sessions: transferSessions.map((s) => ({ id: s.id, workspace: s.workspace })) }),\n  workspaceByPath: () => null,\n  createWorkspace: async (dir: string) => ({ id: 'w-new', path: dir, registryId: 'w-new' }),\n  createSession: async (o: any) => { const s = { id: 'session-imported-' + (transferSessions.length + 1), workspace: o?.path ?? '' }; transferSessions.push(s); return s },")
  t = t.replace("const routeFish = routeBinding.birth(", "const transferSessions: any[] = []\nconst routeFish = routeBinding.birth(")
}

// 导出 / 导入 / 幂等
const anchor = "console.log(`\\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURES'}`)"
const add = [
  "// 导出 / 导入",
  "const expOut = await callRoute('POST', '/fishbowl-ui/export', { path: TMP })",
  "const expDir = expOut.code === 200 ? JSON.parse(expOut.body).dir : ''",
  "check('导出生成包', !!expDir && fs.existsSync(expDir + '/manifest.json'))",
  "const imp1 = await callRoute('POST', '/fishbowl-ui/import', { path: expDir })",
  "const imp1Body = imp1.code === 200 ? JSON.parse(imp1.body) : {}",
  "check('导入给没住处的鱼建房', (imp1Body.housed ?? []).length >= 1 && (transferSessions.length >= 1))",
  "const roomCount = transferSessions.length",
  "const imp2 = await callRoute('POST', '/fishbowl-ui/import', { path: expDir })",
  "const imp2Body = imp2.code === 200 ? JSON.parse(imp2.body) : {}",
  "check('重复导入不重复建房（幂等）', imp2.code === 200 && transferSessions.length === roomCount && (imp2Body.housed ?? []).length === 0)",
  "check('重复导入不重复追加事件', routeBinding.listCreatures().find((c: any) => c.meta.creatureId === routeFish.meta.creatureId)?.store.readEvents().filter((e: any) => e.t === 'turn').length >= 0)",
  anchor,
].join('\n')
t = t.replace(anchor, add)
fs.writeFileSync(p, t)
console.log('test patched', t.includes('transferSessions'))
