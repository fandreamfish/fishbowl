import fs from 'node:fs'
for (const p of ['packages/adapter-dsh/src/resources/fish.js', 'packages/adapter-dsh/src/resources/transfer.js']) {
  let t = fs.readFileSync(p, 'utf8')
  t = t.replaceAll('dataDir: c.store.dir', 'dataDir: homeDir(c)')
  if (!t.includes('homeDir }')) {
    if (p.endsWith('fish.js')) t = t.replace("import { recordPermit } from '../../../being/src/index.ts'", "import { homeDir, recordPermit } from '../../../being/src/index.ts'")
    else t = t.replace("import { injectMessage, moveInText } from '../../../app/src/index.js'", "import { injectMessage, moveInText } from '../../../app/src/index.js'\nimport { homeDir } from '../../../being/src/index.ts'")
  }
  fs.writeFileSync(p, t)
  console.log(p, t.includes('homeDir(c)'))
}
