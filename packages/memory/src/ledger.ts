/**
 * 账本：唯一真相，append-only。
 * 只做三件事：读（带缓存）、追加、按类型取。不解释语义。
 */
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { MemoryEvent } from './events.ts'

export class Ledger {
  readonly file: string
  private cache: MemoryEvent[] | null = null
  private size = -1

  constructor(dir: string, file = 'log.ndjson') {
    fs.mkdirSync(dir, { recursive: true })
    this.file = path.join(dir, file)
  }

  /** 全量事件（按写入顺序）。文件被别人改了会自动重读。 */
  read(): MemoryEvent[] {
    let st
    try {
      st = fs.statSync(this.file)
    } catch {
      this.cache = []
      this.size = 0
      return this.cache
    }
    if (this.cache && st.size === this.size) return this.cache
    const text = fs.readFileSync(this.file, 'utf8')
    const out = []
    for (const line of text.split('\n')) {
      const s = line.trim()
      if (!s) continue
      try {
        out.push(JSON.parse(s))
      } catch {
        // 坏行跳过：一行毒不死整本账
      }
    }
    this.cache = out
    this.size = st.size
    return out
  }

  /** 当前文件字节数（快照缓存用它判断有没有新事件）。 */
  get byteSize(): number {
    if (this.size >= 0) return this.size
    try {
      return fs.statSync(this.file).size
    } catch {
      return 0
    }
  }

  append(ev: MemoryEvent): MemoryEvent {
    const full = { ...ev, id: ev.id || randomUUID(), ts: ev.ts || Date.now() }
    fs.appendFileSync(this.file, JSON.stringify(full) + '\n')
    if (this.cache) this.cache.push(full)
    try {
      this.size = fs.statSync(this.file).size
    } catch {
      this.size = -1
    }
    return full
  }

  ofType(t: string): any[] {
    return this.read().filter((e) => e.t === t)
  }

  /** 测试与诊断用：把缓存丢掉，下一次 read 重新解析。 */
  invalidate(): void {
    this.cache = null
    this.size = -1
  }
}

export function newId(): string {
  return randomUUID()
}
