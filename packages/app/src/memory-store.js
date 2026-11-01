/**
 * 一个进程内、一只鱼一个记忆实例。
 * 收集器与「memory_search」工具共用同一份，避免两套缓存各读一遍账本。
 */
import path from 'node:path'
import { Memory } from '../../memory/src/memory.ts'
import { configFor } from './fishcfg.js'
import { createHttpEmbedder } from '../../memory/src/embed.ts'

/** 向量检索默认关；开了才建 embedder，密钥沿用评价器那把（不另存一份）。 */
function embedderFor(cfg) {
  const e = cfg.memory?.embeddings
  if (!e?.enabled || !e.model) return undefined
  return createHttpEmbedder({
    baseUrl: e.baseUrl || cfg.appraiser?.baseUrl || '',
    apiKey: cfg.appraiser?.apiKey || '',
    model: e.model,
  })
}

export function createMemoryStore(cfg) {
  const map = new Map()
  const embedder = embedderFor(cfg)

  function memoryFor(creature) {
    const id = creature.meta.creatureId
    let m = map.get(id)
    if (!m) {
      m = new Memory({
        dir: path.join(cfg.stateDir, id),
        lock: cfg.memory?.singleWriter ?? 'warn',
        embedder,
      })
      map.set(id, m)
    }
    m.setConfig(configFor(cfg, creature).memory)
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
