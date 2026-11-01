/**
 * 记忆模块的公开入口。
 * 设计见 docs/MEMORY.md；抽取决策见 docs/MEMORY-MODULE.md。
 */
export { Memory } from './memory.ts'
export { readWriterLock } from './lock.ts'
export { createInstanceStore } from './instance.ts'
export type { Llm, LlmRequest, TickReport } from './memory.ts'

export { MEMORY_DEFAULTS, DEFAULT_TAGS, normalizeMemory, validateMemory } from './config.ts'

export type {
  Kind, Subject, Role, Affect4, Appraisal, TurnEvent, SummaryEvent, MergedEvent,
  RetireEvent, ReviseEvent, ConfigEvent, MemoryEvent, Provenance, ScopeRef,
} from './events.ts'
export { MIN_EVIDENCE, MAX_EVIDENCE, MAX_SEGMENTS } from './events.ts'

export type { TurnRecord, MemoryRecord, LedgerView } from './records.ts'
export { buildView, weightOf, evidenceOk } from './records.ts'

export type { RenderInput } from './render.ts'
export { renderText, pickMemories, fingerprint, renderStateBlock } from './render.ts'

export { RecallIndex, tokenize } from './recall.ts'

export { createHttpEmbedder, cosine, rrf, VectorStore } from './embed.ts'
export type { Embedder } from './embed.ts'

export {
  MERGE_SYSTEM, buildMergeUser, parseMerge, gateMemories, similarity, dedupeAgainst,
} from './consolidate.ts'

export {
  HER_SYSTEM, NEUTRAL_SYSTEM, buildHerUser, buildNeutralUser,
  parseHer, parseNeutral, locateQuote, splitSegments,
} from './summarize.ts'
