/**
 * 设置页的后端：把个体状态暴露给同源的 client UI。
 * 路由：/fishbowl-ui/state（GET）· /fishbowl-ui/config（GET/POST）
 */
import fs from 'node:fs'
import path from 'node:path'

const ROUTE = '/fishbowl-ui'

/** 事件 → 一行摘要（给时间线用）。 */
export function summarizeEvent(e) {
  switch (e.t) {
    case 'episode': return { text: (e.note ?? '').slice(0, 80) || '（一轮对话）', meta: `v=${Number(e.appraisal?.goalCongruence ?? 0).toFixed(2)}` }
    case 'semantic': return { text: e.claim, meta: `置信 ${Number(e.confidence).toFixed(2)}` }
    case 'procedure': return { text: `${e.trigger} → ${e.action}`, meta: `置信 ${Number(e.confidence).toFixed(2)}` }
    case 'self': return { text: e.claim, meta: `证据 ${e.evidence?.length ?? 0}` }
    case 'commitment': return { text: e.text, meta: '承诺' }
    case 'commitment-resolved': return { text: e.ref.slice(0, 8), meta: e.status === 'broken' ? '违诺' : '已兑现' }
    case 'activity': return { text: e.title, meta: e.status === 'started' ? '开始' : '结束' }
    case 'identity': return { text: e.name, meta: '名字' }
    case 'freeze': return { text: '封存', meta: '' }
    case 'unfreeze': return { text: '解封', meta: '' }
    default: return { text: e.t, meta: '' }
  }
}

/** 合并 UI 保存的配置（ui-config.json）到配置对象。 */
export function mergeUiConfig(raw, ui) {
  if (!ui || typeof ui !== 'object') return raw
  const out = { ...raw }
  if (typeof ui.growth === 'number' && Number.isFinite(ui.growth)) out.growth = ui.growth
  if (ui.seed && typeof ui.seed === 'object') out.seed = { name: String(ui.seed.name ?? ''), background: String(ui.seed.background ?? '') }
  return out
}

export function uiConfigPath(stateDir) {
  return path.join(stateDir, 'ui-config.json')
}

export function createUiRoute(ctx, cfg, binding) {
  // Cordis：未在 inject 里声明的服务不能直接访问 ctx.webServer；
  // 用 ctx.get 取可选服务（dsh-pet 同款），没有 webServer 的 profile 也能正常激活。
  const webServer = typeof ctx.get === 'function' ? ctx.get('webServer') : null
  if (!webServer || typeof webServer.register !== 'function') return () => {}
  const stateDir = cfg.stateDir

  function buildState() {
    const creatures = []
    for (const [sessionId, creatureId] of Object.entries(binding.bindings)) {
      try {
        const c = binding.creatureFor(sessionId)
        const affect = c.fold().affect
        const memory = c.memorySummary(cfg.growth)
        const events = c.store.readEvents().slice(-40)
        creatures.push({
          sessionId,
          creatureId,
          name: c.meta.name,
          frozen: c.isFrozen(),
          affect: { v: affect.valence, a: affect.arousal, guilt: affect.guilt, longing: affect.longing },
          memory,
          temperament: c.meta.temperament,
          outbox: c.store.readOutbox().filter(o => !o.delivered).length,
          episodes: c.store.readEvents().filter(e => e.t === 'episode').length,
          events: events.map(e => ({ t: e.t, ts: e.ts, ...summarizeEvent(e) })),
        })
      } catch { /* 单个个体坏了不影响整体 */ }
    }
    return {
      config: { growth: cfg.growth, seed: cfg.seed ?? null, appraiser: cfg.appraiser?.kind, relation: cfg.relation?.kind, wake: cfg.wake?.enabled },
      creatures,
    }
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      req.on('error', reject)
    })
  }

  let dispose
  try {
    dispose = webServer.register({
      kind: 'prefix',
      path: ROUTE,
      handler: async (req, res) => {
      try {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const sub = url.pathname.slice(ROUTE.length)
        const send = (obj) => {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify(obj))
        }
        if (sub === '/state' && req.method === 'GET') return send(buildState())
        if (sub === '/config' && req.method === 'GET') return send({ growth: cfg.growth, seed: cfg.seed ?? null })
        if (sub === '/config' && req.method === 'POST') {
          const body = JSON.parse(await readBody(req) || '{}')
          const ui = mergeUiConfig({}, body)
          fs.writeFileSync(uiConfigPath(stateDir), JSON.stringify({ growth: ui.growth, seed: ui.seed ?? null }, null, 2))
          // 运行中立即生效（下次会话时 seed 会进入声音段）
          if (typeof ui.growth === 'number') cfg.growth = ui.growth
          if (ui.seed) cfg.seed = ui.seed
          return send({ ok: true, growth: cfg.growth, seed: cfg.seed ?? null })
        }
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('not found')
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end(String(e?.message ?? e))
      }
      },
    })
  } catch {
    // 同一路由被另一个实例注册过（例如条目重复加载）：不影响功能，另一个实例会服务
    return () => {}
  }
  return typeof dispose === 'function' ? dispose : () => {}
}
