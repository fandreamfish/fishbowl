/** /fish 资源：列表、新生、单条鱼的一切操作（含它下面的上网/评论子路径）。 */
import fs from 'node:fs'
import path from 'node:path'
import { renameScopeAsync, restoreOriginalAsync } from '../../../app/src/rename.js'
import { fishConfigView, halfLivesFor, hasFishConfig, pickFishPatch, writeFishConfig } from '../../../app/src/fishcfg.js'
import { memoryDetail } from '../views-memory.js'
import { browseStatus, lookForCreature } from '../../../bilibili/src/runtime.js'
import { history as browseHistory } from '../../../bilibili/src/store.js'
import { commentStatus, scanDueReplies } from '../../../bilibili/src/comment.js'

export async function handleFish({ cfg, binding, host, stateDir, opts, views, send, readBody }, req, res, parts) {
  if (parts[0] !== 'fish') return false
  const fishView = views.fishView

  if (parts.length === 1 && req.method === 'GET') { send(res, views.stateView()); return true }
  if (parts.length === 1 && req.method === 'POST') {
    const body = JSON.parse(await readBody(req) || '{}')
    const name = String(body.name ?? '').trim()
    if (!name) { send(res, { ok: false, error: '先给它起个名字' }, 400); return true }
    const occ = body.occupancy && body.occupancy.kind
      ? { kind: body.occupancy.kind, id: String(body.occupancy.id ?? ''), workspace: body.occupancy.workspace ? String(body.occupancy.workspace) : undefined }
      : null
    if (occ) {
      const conflict = binding.conflictFor('', occ)
      if (conflict) { send(res, { ok: false, error: `这个住处已经住着「${conflict.name}」了` }, 409); return true }
    }
    const c = binding.birth(name, occ)
    if (occ) renameScopeAsync(host, stateDir, occ, name)
    send(res, { ok: true, fish: fishView(c) })
    return true
  }
  if (parts.length < 3) return false

  const c = binding.get(parts[1])
  if (!c) { send(res, { ok: false, error: '找不到这条鱼' }, 404); return true }
  const action = parts[2]

  if (action === 'config') {
    if (req.method === 'GET') { send(res, { ok: true, config: fishConfigView(cfg, c), inherited: !hasFishConfig(stateDir, c.meta.creatureId) }); return true }
    if (req.method === 'POST') {
      const body = JSON.parse(await readBody(req) || '{}')
      writeFishConfig(stateDir, c.meta.creatureId, pickFishPatch(body))
      try { c.halfLives = halfLivesFor(cfg, c.meta.creatureId) } catch { /* 忽略 */ }
      try { opts.refreshTools?.() } catch { /* 忽略 */ }
      send(res, { ok: true, config: fishConfigView(cfg, c), inherited: false })
      return true
    }
  }
  if (action === 'occupy' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req) || '{}')
    if (body.kind !== 'workspace' && body.kind !== 'session') { send(res, { ok: false, error: '住处类型不对' }, 400); return true }
    const occ = body.kind === 'workspace'
      ? { kind: 'workspace', id: String(body.id ?? '') }
      : { kind: 'session', id: String(body.id ?? ''), workspace: body.workspace ? String(body.workspace) : undefined }
    if (!occ.id) { send(res, { ok: false, error: '住处的 id 不能为空' }, 400); return true }
    try {
      const c0 = binding.get(parts[1])
      const prev = c0.meta.occupancy
      binding.assign(parts[1], occ)
      if (prev && (prev.kind !== occ.kind || prev.id !== occ.id)) restoreOriginalAsync(host, stateDir, prev)
      renameScopeAsync(host, stateDir, occ, c0.meta.name)
      send(res, { ok: true, fish: fishView(binding.get(parts[1])) })
      return true
    } catch (e) {
      send(res, { ok: false, error: String(e?.message ?? e) }, e?.code === 'OCCUPIED' ? 409 : 400)
      return true
    }
  }
  if (action === 'name' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req) || '{}')
    const name = String(body.name ?? '').trim()
    if (!name) { send(res, { ok: false, error: '名字不能为空' }, 400); return true }
    if (!/^fish-/.test(c.meta.name)) { send(res, { ok: false, error: '名字已经定过了' }, 409); return true }
    c.recordIdentity(name)
    send(res, { ok: true, fish: fishView(c) })
    return true
  }
  if (action === 'delete' && req.method === 'POST') {
    const prev = c.meta.occupancy
    binding.remove(parts[1])
    if (prev) restoreOriginalAsync(host, stateDir, prev)
    send(res, { ok: true })
    return true
  }
  if (action === 'release' && req.method === 'POST') {
    const prev = c.meta.occupancy
    binding.release(parts[1])
    if (prev) restoreOriginalAsync(host, stateDir, prev)
    send(res, { ok: true, fish: fishView(binding.get(parts[1])) })
    return true
  }
  if (action === 'diary' && req.method === 'GET') { send(res, { ok: true, diary: c.diaries(30) }); return true }
  if (action === 'notes' && req.method === 'GET') { send(res, { ok: true, notes: c.notes(30) }); return true }
  if (action === 'memory' && req.method === 'GET' && parts.length === 3) { send(res, { ok: true, ...memoryDetail(c, cfg) }); return true }

  if (action === 'browse' && req.method === 'GET' && parts.length === 3) {
    send(res, { ok: true, ...browseStatus(c, cfg) })
    return true
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
    send(res, { ok: true, days, page, pages, total, items })
    return true
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
    send(res, { ok: !!r.ok, result: r, status: browseStatus(c, cfg) })
    return true
  }
  if (action === 'bili' && req.method === 'GET' && parts.length === 3) {
    send(res, { ok: true, ...commentStatus(c, cfg) })
    return true
  }
  if (action === 'bili' && parts[3] === 'scan' && req.method === 'POST') {
    const r = await scanDueReplies(c, cfg, { force: true }).catch(() => ({ items: [], text: '' }))
    send(res, { ok: true, items: r.items ?? [], text: r.text ?? '', status: commentStatus(c, cfg) })
    return true
  }
  if (action === 'requests' && req.method === 'GET') { send(res, { ok: true, requests: c.requests().slice(-30).reverse() }); return true }
  if (action === 'requests' && parts.length >= 5 && parts[4] === 'answer' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req) || '{}')
    if (body.answer !== 'yes' && body.answer !== 'no') { send(res, { ok: false, error: 'answer 只能是 yes 或 no' }, 400); return true }
    c.answerRequest(parts[3], body.answer)
    send(res, { ok: true, requests: c.requests().slice(-30).reverse() })
    return true
  }

  return false
}
