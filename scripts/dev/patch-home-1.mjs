import fs from 'node:fs'

// being index 导出
{
  const p = 'packages/being/src/index.ts'
  let t = fs.readFileSync(p, 'utf8')
  if (!t.includes("home.ts")) t = t.replace("export * from './permits.ts'", "export * from './permits.ts'\nexport * from './home.ts'")
  fs.writeFileSync(p, t)
}

// Creature.open 时保证 home 存在并迁移旧日记
{
  const p = 'packages/being/src/creature.ts'
  let t = fs.readFileSync(p, 'utf8')
  if (!t.includes('ensureHome')) {
    t = t.replace("import { recordDiary,", "import { ensureHome } from './home.ts'\nimport { recordDiary,")
    t = t.replace("  static open(dir: string, opts: any = {}): Creature {", "  static open(dir: string, opts: any = {}): Creature {\n    // 家目录：home/（日记与笔记都搬到这里）")
    // 在 open 返回前调用 ensureHome
    t = t.replace("    return new Creature(store", "    const c = new Creature(store")
    // 找到 open 的结尾 return 语句替换（脆弱）
  }
  fs.writeFileSync(p, t)
}

// 日记/笔记写进 home
{
  const p = 'packages/being/src/journal-facets.ts'
  let t = fs.readFileSync(p, 'utf8')
  t = t.replace("import { uid } from '../../affect/src/index.ts'", "import { uid } from '../../affect/src/index.ts'\nimport { homeDiaryDir, homeNotesDir } from './home.ts'")
  t = t.replace("const dir = path.join(creature.store.dir, 'diary')", "const dir = homeDiaryDir(creature)")
  t = t.replace("const dir = path.join(creature.store.dir, 'notes')", "const dir = homeNotesDir(creature)")
  fs.writeFileSync(p, t)
  console.log('facets', t.includes('homeDiaryDir'))
}
