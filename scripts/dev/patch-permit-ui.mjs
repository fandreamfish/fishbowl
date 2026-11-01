import fs from 'node:fs'
const p = 'packages/plugin/client.js'
let t = fs.readFileSync(p, 'utf8')

// browse 页：需要许可开关
const anchor1 = "          e('div', { style: rowS, children: [\n            e('span', { style: lab, children: '上网时段' }, 'l'),"
const add1 = [
  "          e('div', { style: rowS, children: [",
  "            e('span', { style: lab, children: '看 B 站前要先得到我同意' }, 'pl'),",
  "            e(Toggle, { on: cfg.requirePermit === true, onChange: () => set('requirePermit', cfg.requirePermit !== true), k: 'permit' }),",
  "          ] }, 'permitrow'),",
  "          e('div', { style: { ...lab, fontSize: 11.5, marginBottom: 8 }, children: '打开后：没有许可时工具直接返回「需要许可才能调用」，她自己醒着时也一样。' }, 'permithint'),",
  anchor1,
].join('\n')
if (t.includes(anchor1) && !t.includes("'permitrow'")) t = t.replace(anchor1, add1)

// 说话卡片：需要许可开关
const anchor2 = "        e('div', { style: rowS, children: [\n          e('span', { style: lab, children: '有人回她时允许她回一句' }, 'l'),"
const add2 = [
  "        e('div', { style: rowS, children: [",
  "          e('span', { style: lab, children: '说话前要先得到我同意' }, 'pl'),",
  "          e(Toggle, { on: cm.requirePermit === true, onChange: () => setCm('requirePermit', cm.requirePermit !== true), k: 'permit' }),",
  "        ] }, 'cmpermit'),",
  anchor2,
].join('\n')
if (t.includes(anchor2) && !t.includes("'cmpermit'")) t = t.replace(anchor2, add2)

fs.writeFileSync(p, t)
console.log('ui', t.includes("'permitrow'"), t.includes("'cmpermit'"))
