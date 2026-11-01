import fs from 'node:fs'
const p = 'packages/plugin/test/unit.test.ts'
let t = fs.readFileSync(p, 'utf8')
const anchor = "check('日记默认开、补写默认开', normalizeConfig({}).diary.enabled === true && normalizeConfig({}).diary.catchUp === true)"
const add = [
  anchor,
  "check('默认不要求许可', normalizeConfig({}).browse.requirePermit === false && normalizeConfig({}).comment.requirePermit === false)",
  "check('浏览许可开关可配置', normalizeConfig({ browse: { requirePermit: true } }).browse.requirePermit === true)",
  "check('说话许可开关可配置', normalizeConfig({ comment: { requirePermit: true } }).comment.requirePermit === true)",
  "check('单鱼配置保留许可开关', pickFishPatch({ browse: { requirePermit: true } }).browse.requirePermit === true && pickFishPatch({ comment: { requirePermit: true } }).comment.requirePermit === true)",
].join('\n')
if (!t.includes('默认不要求许可')) t = t.replace(anchor, add)
fs.writeFileSync(p, t)
console.log('patched', t.includes('默认不要求许可'))
