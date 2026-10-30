/**
 * 个体存储：creatures/<id>/
 *   meta.json        四条不变量（模型 / 时区 / schema / 气质）
 *   log.ndjson       事件日志（唯一真相，append-only）
 *   projection.json  投影缓存（可删、可重算）
 */
import fs from 'node:fs'
import path from 'node:path'
import type { CreatureEvent, CreatureMeta } from './types.ts'

export interface ProjectionCache {
  lastSeq: number
  affect: unknown
}

export class Store {
  readonly dir: string

  constructor(dir: string) {
    this.dir = dir
  }

  get metaPath(): string { return path.join(this.dir, 'meta.json') }
  get logPath(): string { return path.join(this.dir, 'log.ndjson') }
  get cachePath(): string { return path.join(this.dir, 'projection.json') }

  static create(dir: string, meta: CreatureMeta): Store {
    fs.mkdirSync(dir, { recursive: true })
    const s = new Store(dir)
    fs.writeFileSync(s.metaPath, JSON.stringify(meta, null, 2) + '\n')
    fs.writeFileSync(s.logPath, '')
    return s
  }

  readMeta(): CreatureMeta {
    return JSON.parse(fs.readFileSync(this.metaPath, 'utf8'))
  }

  appendEvent(ev: CreatureEvent): void {
    fs.appendFileSync(this.logPath, JSON.stringify(ev) + '\n')
  }

  readEvents(): CreatureEvent[] {
    const text = fs.readFileSync(this.logPath, 'utf8')
    return text.split('\n').filter(l => l.trim() !== '').map(l => JSON.parse(l))
  }

  readCache(): ProjectionCache | null {
    try {
      return JSON.parse(fs.readFileSync(this.cachePath, 'utf8'))
    } catch {
      return null
    }
  }

  writeCache(c: ProjectionCache): void {
    fs.writeFileSync(this.cachePath, JSON.stringify(c))
  }

  dropCache(): void {
    fs.rmSync(this.cachePath, { force: true })
  }
}
