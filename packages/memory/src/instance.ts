/**
 * 进程内"一只鱼一个 Memory 实例"的缓存。
 * 宿主无关：目录、配置、锁模式都由调用方给。
 */
import { Memory } from './memory.ts'

export interface InstanceOptions {
  dirOf: (creature: any) => string
  configOf: (creature: any) => any
  lockOf?: (creature: any) => 'off' | 'warn' | 'strict'
  embedder?: any
}

export function createInstanceStore({ dirOf, configOf, lockOf, embedder }: InstanceOptions) {
  const map = new Map()

  function memoryFor(creature: any) {
    const id = creature?.meta?.creatureId
    let m = map.get(id)
    if (!m) {
      m = new Memory({
        dir: dirOf(creature),
        lock: lockOf ? lockOf(creature) : 'warn',
        embedder,
      })
      map.set(id, m)
    }
    m.setConfig(configOf(creature))
    return m
  }

  /** 卸载时放掉写锁，别留下一个「幽灵持有者」。 */
  function closeAll() {
    for (const m of map.values()) {
      try { m.close() } catch { /* 尽力 */ }
    }
    map.clear()
  }

  memoryFor.closeAll = closeAll
  return memoryFor
}
