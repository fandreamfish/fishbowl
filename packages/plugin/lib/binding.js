/**
 * 会话 ↔ 个体绑定。
 * 新会话第一次出现时创建一个个体：气质随机（不可指定），状态全在独立目录。
 */
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Creature } from '../../../src/core/creature.ts'
import { DEFAULT_TEMPERAMENT } from '../../../src/core/types.ts'
import { mulberry32 } from '../../../src/core/util.ts'

/** @param {import('./types.js').FishbowlConfig} cfg */
export function createBinding(cfg) {
  fs.mkdirSync(cfg.stateDir, { recursive: true })
  const bindingsPath = path.join(cfg.stateDir, 'bindings.json')

  /** @type {Record<string,string>} */
  let bindings = {}
  try {
    bindings = JSON.parse(fs.readFileSync(bindingsPath, 'utf8'))
  } catch {
    /* 首次运行 */
  }

  const cache = new Map()

  function save() {
    fs.writeFileSync(bindingsPath, JSON.stringify(bindings, null, 2))
  }

  /** 出生：气质随机，不可指定。 */
  function randomTemperament() {
    const rng = mulberry32((Date.now() ^ (Math.random() * 2 ** 31)) >>> 0)
    return {
      ...DEFAULT_TEMPERAMENT,
      reactivity: 0.6 + rng() * 0.8,       // 0.6–1.4
      baselineArousal: 0.2 + rng() * 0.6,  // 0.2–0.8
      decayRate: 0.7 + rng() * 0.25,       // 0.70–0.95
      baselineValence: -0.2 + rng() * 0.4, // -0.2–+0.2
    }
  }

  /**
   * @param {string} sessionId
   * @returns {Creature}
   */
  function creatureFor(sessionId) {
    let cid = bindings[sessionId]
    if (!cid) {
      cid = randomUUID()
      bindings[sessionId] = cid
      save()
      const meta = {
        schemaVersion: 1,
        creatureId: cid,
        name: `fish-${cid.slice(0, 8)}`,
        bornAt: new Date().toISOString(),
        timezone: cfg.timezone,
        model: { id: cfg.model, pinned: true },
        temperament: randomTemperament(),
      }
      Creature.create(path.join(cfg.stateDir, cid), meta)
    }
    let c = cache.get(cid)
    if (!c) {
      c = Creature.open(path.join(cfg.stateDir, cid))
      cache.set(cid, c)
    }
    return c
  }

  /** 会话有没有被这个插件管理 */
  function manages(sessionId) {
    if (cfg.sessionFilter.length === 0) return true
    return cfg.sessionFilter.includes(sessionId)
  }

  return { dir: cfg.stateDir, bindings, creatureFor, manages }
}
