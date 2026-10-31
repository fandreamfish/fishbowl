/**
 * 设置页后端（M7）：鱼是第一公民。
 *
 * 路由（同源）：
 *   GET  /fish                     列表（含住处、状态、记忆、请求数）
 *   POST /fish                     生一条新鱼（可带住处）
 *   POST /fish/:id/occupy          搬进工作区/会话（互斥，冲突 409）
 *   POST /fish/:id/release         搬出去（不归任何会话）
 *   GET  /fish/:id/diary           日记
 *   GET  /fish/:id/notes           小纸条
 *   GET  /fish/:id/requests        请求（含历史与答复）
 *   POST /fish/:id/requests/:rid/answer  补答 {answer:'yes'|'no'}
 *   GET/POST /config               成长率与来历（来历出生后只读）
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROUTE = '/fishbowl-ui'

export function decodeWorkspace(dirName) {
    let s = dirName.slice(2, -2).replace(/~([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    if (!s) return null
    const drive = /^[A-Za-z]$/.test(s[0]) ? s[0].toUpperCase() + ':' : null
    const rest = drive ? s.slice(1) : s
    const memo = new Map()
    function go(i, acc) {
      if (i >= rest.length) return fs.existsSync(acc) ? acc : null
      const key = i + '|' + acc
      if (memo.has(key)) return memo.get(key)
      let out = null
      if (rest[i] === '-') {
        out = go(i + 1, acc + '-') || go(i + 1, acc + '\\')
      } else {
        out = go(i + 1, acc + rest[i])
      }
      memo.set(key, out)
      return out
    }
    const full = go(0, drive ?? '')
    return full && fs.existsSync(full) ? full : null
  }



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
    case 'diary': return { text: e.text.slice(0, 60), meta: '日记' }
    case 'note': return { text: e.text, meta: '小纸条' }
    case 'request': return { text: e.text, meta: '请求' }
    case 'request-answered': return { text: e.ref.slice(0, 8), meta: e.answer === 'yes' ? '同意' : '不同意' }
    case 'reinforce': return { text: e.ref.slice(0, 8), meta: '又提到' }
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

/** seed 是否被这次请求改动（纯函数，便于测试）。 */
export function seedChanged(prev, next) {
  return !!next && (String(next.name ?? '') !== String(prev?.name ?? '') || String(next.background ?? '') !== String(prev?.background ?? ''))
}

export function createUiRoute(ctx, cfg, binding) {
  const webServer = typeof ctx.get === 'function' ? ctx.get('webServer') : null
  if (!webServer || typeof webServer.register !== 'function') return () => {}
  const stateDir = cfg.stateDir

  function fishView(c, sessions) {
    const affect = c.fold().affect
    const events = c.store.readEvents()
    const memory = c.memorySummary(cfg.growth)
    return {
      id: c.meta.creatureId,
      name: c.meta.name,
      bornAt: c.meta.bornAt,
      frozen: c.isFrozen(),
      occupancy: c.meta.occupancy
        ? { ...c.meta.occupancy, workspace: c.meta.occupancy.kind === 'session' ? (c.meta.occupancy.workspace || (sessions || []).find(s => s.id === c.meta.occupancy.id)?.workspace || '') : undefined }
        : null,
      episodes: events.filter(e => e.t === 'episode').length,
      affect: { v: affect.valence, a: affect.arousal, guilt: affect.guilt, longing: affect.longing },
      memory,
      pendingRequests: c.pendingRequests(),
      requests: c.requests().slice(-10).reverse(),
      notes: c.notes(5),
      diary: c.diaries(3),
      metaBytes: JSON.stringify(c.meta).length,
      outbox: c.store.readOutbox().filter(o => !o.delivered).length,
      events: events.slice(-40).map(e => ({ t: e.t, ts: e.ts, ...summarizeEvent(e) })),
    }
  }

  /**
   * 枚举 DSH 的全部工作区与会话（sessions/<编码路径>/session-<id>）。
   * 工作区目录名是编码过的（`--C-Users-x-.dsh-fish-home--`），
   * 用「把 - 当分隔符试遍所有切分 + 路径存在性校验」还原真实路径。
   */
  function scopesRoots() {
    const out = []
    if (process.env.DSH_HOME) out.push(path.join(process.env.DSH_HOME, 'sessions'))
    out.push(path.join(os.homedir(), '.dsh', 'sessions'))
    return [...new Set(out)].filter((r) => r && fs.existsSync(r))
  }

  function enumerateScopes() {
    const workspaces = []
    const sessions = []
    const roots = scopesRoots()
    let scanned = 0
    let decoded = 0
    for (const root of roots) {
      try {
        for (const d of fs.readdirSync(root, { withFileTypes: true })) {
          if (!d.isDirectory() || !d.name.startsWith('--') || !d.name.endsWith('--')) continue
          scanned += 1
          const ws = decodeWorkspace(d.name)
          if (!ws) continue
          decoded += 1
          if (!workspaces.includes(ws)) workspaces.push(ws)
          let names = []
          try { names = fs.readdirSync(path.join(root, d.name), { withFileTypes: true }) } catch { /* 读不到就跳过 */ }
          for (const n of names) {
            if (n.isDirectory() && n.name.startsWith('session-') && !sessions.some(x => x.id === n.name)) {
              sessions.push({ id: n.name, workspace: ws })
            }
          }
        }
      } catch { /* 单个 root 失败不影响其他 */ }
    }
    const debug = {
      homedir: os.homedir(),
      dshHomeEnv: process.env.DSH_HOME ?? null,
      roots,
      scanned,
      decoded,
      workspaces: workspaces.length,
      sessions: sessions.length,
    }
    try { fs.writeFileSync(path.join(cfg.stateDir, 'scopes-debug.json'), JSON.stringify(debug, null, 2)) } catch { /* 忽略 */ }
    return { workspaces, sessions, debug }
  }
  /** 枚举结果 + 插件已记录的住处（主题目录不同时两边互补）。 */
  function allScopes() {
    const e = enumerateScopes()
    const workspaces = [...e.workspaces]
    for (const w of (binding.scopes?.workspaces ?? [])) if (!workspaces.includes(w)) workspaces.push(w)
    const sessions = [...e.sessions]
    for (const s of (binding.scopes?.sessions ?? [])) {
      if (s && s.id && !sessions.some(x => x.id === s.id)) sessions.push({ id: s.id, workspace: s.workspace || '' })
    }
    return { workspaces, sessions, debug: e.debug }
  }

  function stateView() {
    const scopes = allScopes()
    const fish = binding.listCreatures().map((c) => fishView(c, scopes.sessions))
    return {
      born: fish.some(f => f.episodes > 0),
      scopes,
      config: { growth: cfg.growth, seed: cfg.seed ?? null, appraiser: cfg.appraiser?.kind, relation: cfg.relation?.kind, wake: cfg.wake?.enabled },
      fish,
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

  const send = (res, obj, code = 200) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(obj))
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
          const parts = sub.split('/').filter(Boolean)

          // —— 鱼列表 / 新生 ——
          if (parts[0] === 'fish' && parts.length === 1 && req.method === 'GET') return send(res, stateView())
          if (parts[0] === 'fish' && parts.length === 1 && req.method === 'POST') {
            const body = JSON.parse(await readBody(req) || '{}')
            const occ = body.occupancy && body.occupancy.kind
              ? { kind: body.occupancy.kind, id: String(body.occupancy.id ?? ''), workspace: body.occupancy.workspace ? String(body.occupancy.workspace) : undefined }
              : null
            if (occ) {
              const conflict = binding.conflictFor('', occ)
              if (conflict) return send(res, { ok: false, error: `这个住处已经住着「${conflict.name}」了` }, 409)
            }
            const c = binding.birth(occ)
            return send(res, { ok: true, fish: fishView(c) })
          }

          // —— 单条鱼 ——
          if (parts[0] === 'fish' && parts.length >= 3) {
            const c = binding.get(parts[1])
            if (!c) return send(res, { ok: false, error: '找不到这条鱼' }, 404)
            const action = parts[2]
            if (action === 'occupy' && req.method === 'POST') {
              const body = JSON.parse(await readBody(req) || '{}')
              if (body.kind !== 'workspace' && body.kind !== 'session') return send(res, { ok: false, error: '住处类型不对' }, 400)
              const occ = body.kind === 'workspace'
                ? { kind: 'workspace', id: String(body.id ?? '') }
                : { kind: 'session', id: String(body.id ?? ''), workspace: body.workspace ? String(body.workspace) : undefined }
              if (!occ.id) return send(res, { ok: false, error: '住处的 id 不能为空' }, 400)
              try {
                binding.assign(parts[1], occ)
                return send(res, { ok: true, fish: fishView(binding.get(parts[1])) })
              } catch (e) {
                return send(res, { ok: false, error: String(e?.message ?? e) }, e?.code === 'OCCUPIED' ? 409 : 400)
              }
            }
            if (action === 'release' && req.method === 'POST') {
              binding.release(parts[1])
              return send(res, { ok: true, fish: fishView(binding.get(parts[1])) })
            }
            if (action === 'diary' && req.method === 'GET') return send(res, { ok: true, diary: c.diaries(30) })
            if (action === 'notes' && req.method === 'GET') return send(res, { ok: true, notes: c.notes(30) })
            if (action === 'requests' && req.method === 'GET') return send(res, { ok: true, requests: c.requests().slice(-30).reverse() })
            if (action === 'requests' && parts.length >= 5 && parts[4] === 'answer' && req.method === 'POST') {
              const body = JSON.parse(await readBody(req) || '{}')
              if (body.answer !== 'yes' && body.answer !== 'no') return send(res, { ok: false, error: 'answer 只能是 yes 或 no' }, 400)
              c.answerRequest(parts[3], body.answer)
              return send(res, { ok: true, requests: c.requests().slice(-30).reverse() })
            }
          }

          // —— 兼容旧路径 ——
          if (sub === '/state' && req.method === 'GET') return send(res, stateView())
          if (sub === '/config' && req.method === 'GET') return send(res, { growth: cfg.growth, seed: cfg.seed ?? null })
          if (sub === '/config' && req.method === 'POST') {
            const body = JSON.parse(await readBody(req) || '{}')
            const ui = mergeUiConfig({}, body)
            // 公理 A1：她出生后来历只读——历史会被铭记，只能说服，不能修改
            if (stateView().born && seedChanged(cfg.seed, ui.seed)) {
              return send(res, { ok: false, error: '她已经出生了，来历不能再改（历史会被铭记，只能说服不能修改）' }, 409)
            }
            fs.writeFileSync(uiConfigPath(stateDir), JSON.stringify({ growth: ui.growth, seed: ui.seed ?? null }, null, 2))
            if (typeof ui.growth === 'number') cfg.growth = ui.growth
            if (ui.seed && !stateView().born) cfg.seed = ui.seed
            return send(res, { ok: true, growth: cfg.growth, seed: cfg.seed ?? null })
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
