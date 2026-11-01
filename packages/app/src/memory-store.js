/**
 * 记忆实例的接线：目录与配置怎么取由 app 决定，缓存逻辑在 memory 包。
 * 收集器与「memory_search」工具共用同一份。
 */
import path from 'node:path'
import { createInstanceStore, createHttpEmbedder } from '../../memory/src/index.ts'
import { configFor } from './fishcfg.js'

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
  const embedder = embedderFor(cfg)
  return createInstanceStore({
    dirOf: (creature) => path.join(cfg.stateDir, creature.meta.creatureId),
    configOf: (creature) => configFor(cfg, creature).memory,
    lockOf: () => cfg.memory?.singleWriter ?? 'warn',
    embedder,
  })
}