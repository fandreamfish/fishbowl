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
import path from 'node:path'
import { renameScopeAsync, restoreOriginalAsync } from '../../app/src/rename.js'
import { injectMessage } from '../../app/src/injector.js'
import { normalizeConfig } from '../../app/src/config.js'
import { createDshHost } from './host.js'
import { workspaceOf } from '../../app/src/extract.js'
import { wakeStatePath, wakeSituation, wakeTrigger, selfSituation } from '../../app/src/wake.js'
import { createViews } from './views.js'
export { summarizeEvent } from './views.js'
export { subjectOf, otherWriter, memoryDetail } from './views-memory.js'
import { browseStatus, lookForCreature, markSelfTime } from '../../bilibili/src/runtime.js'
import { clearRisk, riskState } from '../../bilibili/src/risk.js'
import { history as browseHistory } from '../../bilibili/src/store.js'
import { readAuth, publicAuth, saveAuth, saveAccount, clearCookie } from '../../bilibili/src/auth.js'
import { commentStatus, scanDueReplies } from '../../bilibili/src/comment.js'
import { createClient } from '../../bilibili/src/client.js'
import { normalizeBrowseConfig } from '../../bilibili/src/browse.ts'
import { recordWake } from '../../being/src/signals.ts'
import { buildView } from '../../memory/src/records.ts'
import { validateMemory } from '../../memory/src/config.ts'
import { pickCommentConfig, pickMemoryConfig, pickRoutineConfig } from '../../app/src/cfgkeys.js'
import { fishConfigView, halfLivesFor, hasFishConfig, pickFishPatch, writeFishConfig } from '../../app/src/fishcfg.js'
export { pickCommentConfig, pickMemoryConfig, pickRoutineConfig } from '../../app/src/cfgkeys.js'

const ROUTE = '/fishbowl-ui'


/** 合并 UI 保存的配置（ui-config.json）到配置对象。 */
export function mergeUiConfig(raw, ui) {
  if (!ui || typeof ui !== 'object') return raw
  const out = { ...raw }
  if (typeof ui.growth === 'number' && Number.isFinite(ui.growth)) out.growth = ui.growth
  if (ui.seed && typeof ui.seed === 'object') out.seed = { name: String(ui.seed.name ?? ''), background: String(ui.seed.background ?? '') }
  if (ui.memory && typeof ui.memory === 'object') out.memory = { ...(raw.memory || {}), ...ui.memory }
  if (ui.wake && typeof ui.wake === 'object') out.wake = pickRoutineConfig({ wake: ui.wake }).wake
  if (ui.contact && typeof ui.contact === 'object') out.contact = pickRoutineConfig({ contact: ui.contact }).contact
  if (ui.selfTime && typeof ui.selfTime === 'object') out.selfTime = pickRoutineConfig({ selfTime: ui.selfTime }).selfTime
  if (ui.browse && typeof ui.browse === 'object') out.browse = normalizeBrowseConfig(ui.browse)
  if (ui.comment && typeof ui.comment === 'object') out.comment = pickCommentConfig(ui.comment)
  if (ui.relation && typeof ui.relation === 'object' && typeof ui.relation.kind === 'string') {
    out.relation = { kind: ['companion', 'friend'].includes(ui.relation.kind) ? ui.relation.kind : 'companion' }
  }
  return out
}

export function validateMemoryConfig(c) {
  return validateMemory(c)
}



export function uiConfigPath(stateDir) {
  return path.join(stateDir, 'ui-config.json')
}

/** 读-改-写 UI 配置（保留不认识的键，避免存记忆配置时把成长率冲掉）。 */
export function saveUiConfig(stateDir, patch) {
  let cur = {}
  try { cur = JSON.parse(fs.readFileSync(uiConfigPath(stateDir), 'utf8')) } catch { /* 首次 */ }
  const next = { ...(cur && typeof cur === 'object' ? cur : {}), ...patch }
  fs.writeFileSync(uiConfigPath(stateDir), JSON.stringify(next, null, 2))
  return next
}

/** seed 是否被这次请求改动（纯函数，便于测试）。 */
export function seedChanged(prev, next) {
  return !!next && (String(next.name ?? '') !== String(prev?.name ?? '') || String(next.background ?? '') !== String(prev?.background ?? ''))
}

export function createUiRoute(ctx, cfg, binding, host, opts = {}) {
  host = host ?? createDshHost(ctx, cfg)
  if (typeof host.registerRoute !== 'function') return () => {}
  const stateDir = cfg.stateDir
  const { fishView, allScopes, stateView } = createViews({ cfg, binding, host, stateDir })


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
    dispose = host.registerRoute({
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
            const name = String(body.name ?? '').trim()
            if (!name) return send(res, { ok: false, error: '先给它起个名字' }, 400)
            const occ = body.occupancy && body.occupancy.kind
              ? { kind: body.occupancy.kind, id: String(body.occupancy.id ?? ''), workspace: body.occupancy.workspace ? String(body.occupancy.workspace) : undefined }
              : null
            if (occ) {
              const conflict = binding.conflictFor('', occ)
              if (conflict) return send(res, { ok: false, error: `这个住处已经住着「${conflict.name}」了` }, 409)
            }
            const c = binding.birth(name, occ)
            if (occ) renameScopeAsync(host, stateDir, occ, name)
            return send(res, { ok: true, fish: fishView(c) })
          }

          // —— 单条鱼 ——
          if (parts[0] === 'fish' && parts.length >= 3) {
            const c = binding.get(parts[1])
            if (!c) return send(res, { ok: false, error: '找不到这条鱼' }, 404)
            const action = parts[2]
            // —— 这条鱼自己的配置（作息 / 记忆 / 上网 / 评论 / 成长率） ——
            if (action === 'config') {
              if (req.method === 'GET') return send(res, { ok: true, config: fishConfigView(cfg, c), inherited: !hasFishConfig(stateDir, c.meta.creatureId) })
              if (req.method === 'POST') {
                const body = JSON.parse(await readBody(req) || '{}')
                writeFishConfig(stateDir, c.meta.creatureId, pickFishPatch(body))
                // 半衰期改了要立刻用在新值上（实例是缓存的）
                try { c.halfLives = halfLivesFor(cfg, c.meta.creatureId) } catch { /* 忽略 */ }
                // 能力开关变了：重新注册工具（全关就不注册）
                try { opts.refreshTools?.() } catch { /* 忽略 */ }
                return send(res, { ok: true, config: fishConfigView(cfg, c), inherited: false })
              }
            }
            if (action === 'occupy' && req.method === 'POST') {
              const body = JSON.parse(await readBody(req) || '{}')
              if (body.kind !== 'workspace' && body.kind !== 'session') return send(res, { ok: false, error: '住处类型不对' }, 400)
              const occ = body.kind === 'workspace'
                ? { kind: 'workspace', id: String(body.id ?? '') }
                : { kind: 'session', id: String(body.id ?? ''), workspace: body.workspace ? String(body.workspace) : undefined }
              if (!occ.id) return send(res, { ok: false, error: '住处的 id 不能为空' }, 400)
              try {
                const c0 = binding.get(parts[1])
                const prev = c0.meta.occupancy
                binding.assign(parts[1], occ)
                if (prev && (prev.kind !== occ.kind || prev.id !== occ.id)) restoreOriginalAsync(host, stateDir, prev)
                renameScopeAsync(host, stateDir, occ, c0.meta.name)
                return send(res, { ok: true, fish: fishView(binding.get(parts[1])) })
              } catch (e) {
                return send(res, { ok: false, error: String(e?.message ?? e) }, e?.code === 'OCCUPIED' ? 409 : 400)
              }
            }
            if (action === 'name' && req.method === 'POST') {
              const body = JSON.parse(await readBody(req) || '{}')
              const name = String(body.name ?? '').trim()
              if (!name) return send(res, { ok: false, error: '名字不能为空' }, 400)
              // 只允许给还没名字的鱼（默认 fish-xxxx）起名一次
              if (!/^fish-/.test(c.meta.name)) return send(res, { ok: false, error: '名字已经定过了' }, 409)
              c.recordIdentity(name)
              return send(res, { ok: true, fish: fishView(c) })
            }
            if (action === 'delete' && req.method === 'POST') {
              const prev = c.meta.occupancy
              binding.remove(parts[1])
              if (prev) restoreOriginalAsync(host, stateDir, prev)
              return send(res, { ok: true })
            }
            if (action === 'release' && req.method === 'POST') {
              const prev = c.meta.occupancy
              binding.release(parts[1])
              if (prev) restoreOriginalAsync(host, stateDir, prev)
              return send(res, { ok: true, fish: fishView(binding.get(parts[1])) })
            }
            if (action === 'diary' && req.method === 'GET') return send(res, { ok: true, diary: c.diaries(30) })
            if (action === 'notes' && req.method === 'GET') return send(res, { ok: true, notes: c.notes(30) })
            if (action === 'memory' && req.method === 'GET' && parts.length === 3) return send(res, { ok: true, ...memoryDetail(c, cfg) })
            if (action === 'browse' && req.method === 'GET' && parts.length === 3) {
              return send(res, { ok: true, ...browseStatus(c, cfg) })
            }
            if (action === 'browse' && parts[3] === 'history' && req.method === 'GET') {
              const url = new URL(req.url ?? '/', 'http://localhost')
              const days = Math.max(1, Math.min(365, Number(url.searchParams.get('days')) || 14))
              const page = Math.max(0, Number(url.searchParams.get('page')) || 0)
              const groups = browseHistory(c, days, Date.now(), cfg.timezone)
              const pageSize = 10
              const flat = groups.flatMap((g) => g.items.map((it) => ({ ...it, day: g.day })))
              const total = flat.length
              const pages = Math.max(1, Math.ceil(total / pageSize))
              const items = flat.slice(page * pageSize, page * pageSize + pageSize)
              return send(res, { ok: true, days, page, pages, total, items })
            }
            if (action === 'browse' && parts[3] === 'run' && req.method === 'POST') {
              const body = JSON.parse(await readBody(req) || '{}')
              const r = await lookForCreature(c, cfg, {
                what: body.what ?? 'home',
                keyword: body.keyword,
                bvid: body.bvid,
                mode: 'manual',
                force: true,
                log: (tag, msg) => {
                  try { fs.appendFileSync(path.join(stateDir, 'trace.ndjson'), JSON.stringify({ ts: Date.now(), event: 'browse', tag, msg: String(msg ?? '') }) + '\n') } catch { /* 忽略 */ }
                },
              })
              return send(res, { ok: !!r.ok, result: r, status: browseStatus(c, cfg) })
            }
            if (action === 'bili' && req.method === 'GET' && parts.length === 3) {
              return send(res, { ok: true, ...commentStatus(c, cfg) })
            }
            if (action === 'bili' && parts[3] === 'scan' && req.method === 'POST') {
              const r = await scanDueReplies(c, cfg, { force: true }).catch(() => ({ items: [], text: '' }))
              return send(res, { ok: true, items: r.items ?? [], text: r.text ?? '', status: commentStatus(c, cfg) })
            }
            if (action === 'requests' && req.method === 'GET') return send(res, { ok: true, requests: c.requests().slice(-30).reverse() })
            if (action === 'requests' && parts.length >= 5 && parts[4] === 'answer' && req.method === 'POST') {
              const body = JSON.parse(await readBody(req) || '{}')
              if (body.answer !== 'yes' && body.answer !== 'no') return send(res, { ok: false, error: 'answer 只能是 yes 或 no' }, 400)
              c.answerRequest(parts[3], body.answer)
              return send(res, { ok: true, requests: c.requests().slice(-30).reverse() })
            }
          }

          // —— 记忆配置（全局；改的是她的记忆行为，不是单个会话） ——
          if (parts[0] === 'memory' && parts[1] === 'config') {
            if (req.method === 'GET') return send(res, { ok: true, config: cfg.memory })
            if (req.method === 'POST') {
              const body = JSON.parse(await readBody(req) || '{}')
              const merged = { ...cfg.memory, ...pickMemoryConfig(body) }
              const errors = validateMemoryConfig(merged)
              if (errors.length) return send(res, { ok: false, error: errors.join('；') }, 400)
              // 再走一次归一化：钳制越界值，补齐缺失键
              cfg.memory = normalizeConfig({ ...cfg, memory: merged }).memory
              saveUiConfig(stateDir, { memory: cfg.memory })
              return send(res, { ok: true, config: cfg.memory })
            }
          }

          // —— 上网：全局配置 / 风控 ——
          if (sub === '/browse') {
            if (req.method === 'GET') {
              return send(res, { ok: true, config: cfg.browse, risk: riskState(stateDir), ffmpeg: false })
            }
            if (req.method === 'POST') {
              const body = JSON.parse(await readBody(req) || '{}')
              cfg.browse = normalizeBrowseConfig(body.browse ?? body)
              saveUiConfig(stateDir, { browse: cfg.browse })
              return send(res, { ok: true, config: cfg.browse })
            }
          }
          if (sub === '/browse/risk/reset' && req.method === 'POST') {
            clearRisk(stateDir)
            return send(res, { ok: true, risk: riskState(stateDir) })
          }

          // —— B 站登录 / 在评论区说话 ——
          if (sub === '/bili') {
            if (req.method === 'GET') {
              return send(res, { ok: true, auth: publicAuth(readAuth(stateDir)), comment: cfg.comment })
            }
            if (req.method === 'POST') {
              const body = JSON.parse(await readBody(req) || '{}')
              if (body.comment && typeof body.comment === 'object') {
                const picked = pickCommentConfig(body.comment) ?? {}
                cfg.comment = { ...cfg.comment, ...picked }
                saveUiConfig(stateDir, { comment: cfg.comment })
              }
              if (body.auth && typeof body.auth === 'object') {
                saveAuth(stateDir, body.auth)
              }
              return send(res, { ok: true, auth: publicAuth(readAuth(stateDir)), comment: cfg.comment })
            }
          }
          if (sub === '/bili/auth' && req.method === 'POST') {
            const body = JSON.parse(await readBody(req) || '{}')
            const r = saveAuth(stateDir, body)
            return send(res, { ok: r.ok !== false, note: r.note, auth: r.auth, missing: r.missing ?? [] })
          }
          if (sub === '/bili/auth/test' && req.method === 'POST') {
            const auth = readAuth(stateDir)
            if (!auth?.cookie) return send(res, { ok: false, error: '还没存 cookie' }, 400)
            try {
              const client = createClient({ cookie: auth.cookie })
              const me = await client.me()
              if (me?.isLogin) {
                saveAccount(stateDir, me)
                return send(res, { ok: true, me: { mid: me.mid, name: me.uname, canWrite: me.canWrite }, auth: publicAuth(readAuth(stateDir)), note: me.canWrite ? '能说话。' : (me.why || '登录了，但不能写。') })
              }
              return send(res, { ok: false, error: me?.why || 'cookie 已失效' }, 400)
            } catch (e) {
              return send(res, { ok: false, error: String(e?.message ?? e) }, 500)
            }
          }
          if (sub === '/bili/auth/clear' && req.method === 'POST') {
            return send(res, { ok: true, auth: clearCookie(stateDir) })
          }

          // —— 现在叫一次（测试用，绕过配额） ——
          if (sub === '/wake/now' && req.method === 'POST') {
            const body = JSON.parse(await readBody(req) || '{}')
            const mode = body.mode === 'self' ? 'self' : 'contact'
            let target = null
            let creature = null
            for (const a of host.listAgents?.() ?? []) {
              const sid = a?.session?.id ?? a?.id
              if (!sid) continue
              const c = binding.resolve({ sessionId: sid, workspace: workspaceOf(a?.session) })
              if (c) { target = a; creature = c; break }
            }
            if (!target || !creature) return send(res, { ok: false, error: '没有活着的会话' }, 400)
            const now = Date.now()
            if (mode === 'self') {
              const text = wakeTrigger(now, selfSituation(creature, cfg), 'self')
              try {
                await host.wake(target, injectMessage(text, { mode: 'self', reason: null }))
                recordWake(creature, 'self', null, now)
                markSelfTime(creature.meta.creatureId, now + 10 * 60_000)
                fs.appendFileSync(path.join(stateDir, 'trace.ndjson'), JSON.stringify({ ts: now, event: 'wake-manual', mode, creature: creature.meta.name, text }) + '\n')
                return send(res, { ok: true, mode, text })
              } catch (e) {
                return send(res, { ok: false, error: String(e?.message ?? e) }, 500)
              }
            }
            const reason = '你想主动找他（手动触发）'
            const text = wakeTrigger(now, wakeSituation(reason), 'contact')
            if (!text) return send(res, { ok: false, error: '生成失败' }, 500)
            try {
              await host.wake(target, injectMessage(text, { mode: 'contact', reason }))
              creature.recordOutreach('manual', now)
              recordWake(creature, 'contact', reason, now)
              fs.appendFileSync(path.join(stateDir, 'trace.ndjson'), JSON.stringify({ ts: now, event: 'wake-manual', mode, creature: creature.meta.name, text }) + '\n')
              return send(res, { ok: true, mode, text })
            } catch (e) {
              return send(res, { ok: false, error: String(e?.message ?? e) }, 500)
            }
          }
          // —— 诊断：服务可用性（排查改名问题用） ——
          if (sub === '/debug/services' && req.method === 'GET') {
            const svc = host.services()
            return send(res, svc)
          }

          // —— 兼容旧路径 ——
          if (sub === '/state' && req.method === 'GET') return send(res, stateView())
          if (sub === '/config' && req.method === 'GET') return send(res, { growth: cfg.growth, seed: cfg.seed ?? null, memory: cfg.memory, wake: cfg.wake, contact: cfg.contact, selfTime: cfg.selfTime, browse: cfg.browse, comment: cfg.comment, relation: cfg.relation })
          if (sub === '/config' && req.method === 'POST') {
            const body = JSON.parse(await readBody(req) || '{}')
            const ui = mergeUiConfig({}, body)
            // 公理 A1：她出生后来历只读——历史会被铭记，只能说服，不能修改
            if (stateView().born && seedChanged(cfg.seed, ui.seed)) {
              return send(res, { ok: false, error: '她已经出生了，来历不能再改（历史会被铭记，只能说服不能修改）' }, 409)
            }
            const routine = pickRoutineConfig(body)
            saveUiConfig(stateDir, {
              growth: ui.growth,
              seed: ui.seed ?? null,
              wake: { ...cfg.wake, ...(routine.wake ?? {}) },
              contact: { ...cfg.contact, ...(routine.contact ?? {}) },
              selfTime: { ...cfg.selfTime, ...(routine.selfTime ?? {}) },
              ...(ui.browse ? { browse: ui.browse } : {}),
              ...(ui.comment ? { comment: { ...cfg.comment, ...ui.comment } } : {}),
              relation: ui.relation ?? cfg.relation,
            })
            if (typeof ui.growth === 'number') cfg.growth = ui.growth
            if (ui.seed && !stateView().born) cfg.seed = ui.seed
            if (routine.wake) cfg.wake = { ...cfg.wake, ...routine.wake }
            if (routine.contact) cfg.contact = { ...cfg.contact, ...routine.contact }
            if (routine.selfTime) cfg.selfTime = { ...cfg.selfTime, ...routine.selfTime }
            if (ui.browse) cfg.browse = ui.browse
            if (ui.comment) cfg.comment = { ...cfg.comment, ...ui.comment }
            if (ui.relation) cfg.relation = ui.relation
            // 节律开关/时段是启动时读的：改了就重启唤醒循环
            if (routine.wake || routine.selfTime) { try { opts.restartWake?.() } catch { /* 忽略 */ } }
            return send(res, { ok: true, growth: cfg.growth, seed: cfg.seed ?? null, memory: cfg.memory, wake: cfg.wake, contact: cfg.contact, selfTime: cfg.selfTime, browse: cfg.browse, comment: cfg.comment, relation: cfg.relation })
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