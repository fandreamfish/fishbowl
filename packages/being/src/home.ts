/**
 * 她的家：creatures/<id>/home/
 *
 * 账本、meta、config 是她"不该改"的东西；日记、小纸条、她自己存的任何东西
 * 都放 home/ 里（diary/、notes/、随便什么）。
 */
import fs from 'node:fs'
import path from 'node:path'

export function homeDir(creature: any): string {
  return path.join(creature.store.dir, 'home')
}

export function homeDiaryDir(creature: any): string {
  return path.join(homeDir(creature), 'diary')
}

export function homeNotesDir(creature: any): string {
  return path.join(homeDir(creature), 'notes')
}

/** 建目录；把老位置（creatures/<id>/diary、notes）里的文件搬进来（幂等）。 */
export function ensureHome(creature: any): void {
  const home = homeDir(creature)
  fs.mkdirSync(homeDiaryDir(creature), { recursive: true })
  fs.mkdirSync(homeNotesDir(creature), { recursive: true })

  for (const [from, to] of [
    [path.join(creature.store.dir, 'diary'), homeDiaryDir(creature)],
    [path.join(creature.store.dir, 'notes'), homeNotesDir(creature)],
  ] as [string, string][]) {
    if (!fs.existsSync(from)) continue
    for (const name of fs.readdirSync(from)) {
      const s = path.join(from, name)
      const d = path.join(to, name)
      try {
        if (!fs.existsSync(d) && fs.statSync(s).isFile()) fs.renameSync(s, d)
      } catch { /* 搬不动就留着，不影响启动 */ }
    }
    try { if (fs.readdirSync(from).length === 0) fs.rmdirSync(from) } catch { /* 非空就留着 */ }
  }
}
