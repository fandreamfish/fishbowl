/** 模块加载检查：所有包入口与插件入口都必须能 import。 */
const targets = [
  'packages/affect/src/index.ts',
  'packages/being/src/index.ts',
  'packages/memory/src/index.ts',
  'packages/schedule/src/index.ts',
  'packages/voice/src/index.js',
  'packages/journal/src/index.js',
  'packages/bilibili/src/index.js',
  'packages/app/src/index.js',
  'packages/adapter-dsh/src/index.js',
  'packages/plugin/index.js',
  'packages/bridge-qq/lib/pipeline.js',
]
const { pathToFileURL } = await import('node:url')
const path = await import('node:path')
let bad = 0
for (const t of targets) {
  try {
    await import(pathToFileURL(path.resolve(process.cwd(), t)).href)
    console.log('  ok  ' + t)
  } catch (e) {
    bad++
    console.error('  FAIL ' + t + ' — ' + String(e?.message || e))
  }
}
if (bad) process.exit(1)
console.log('模块加载检查通过')
