/** /fish 资源：列表、新生、单条鱼的一切操作（含它下面的上网/评论子路径）。 */
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { housingToOccupancy, injectMessage, moveInText, renameScopeAsync, restoreOriginalAsync } from '../../../app/src/index.js'
import { homeDir, recordPermit } from '../../../being/src/index.ts'
import { fishConfigView, halfLivesFor, hasFishConfig, pickFishPatch, writeFishConfig } from '../../../app/src/index.js'
import { memoryDetail } from '../views-memory.js'
import { browseStatus, lookForCreature } from '../../../bilibili/src/index.js'
import { history as browseHistory } from '../../../bilibili/src/index.js'
import { commentStatus, scanDueReplies } from '../../../bilibili/src/index.js'

export async function handleFish({ cfg, binding, host, stateDir, opts, views, send, readBody }, req, res, parts) {
  if (parts[0] !== 'fish') return false
  const fishView = views.fishView

  if (parts.length === 1 && req.method === 'GET') { send(res, views.stateView()); return true }
  if (parts.length === 1 && req.method === 'POST') {
    const body = JSON.parse(await readBody(req) || '{}')
    const name = String(body.name ?? '').trim()
    if (!name) { send(res, { ok: false, error: '先给它起个名字' }, 400); return true }
    if (!body.housing) { send(res, { ok: false, error: '先为它选一个屋子（会为它新建一间房）' }, 400); return true }
    let occ = null
    try { occ = await housingToOccupancy(host, body.housing, { title: name + '的房间' }) }
    catch (e) { send(res, { ok: false, error: String(e?.message ?? e) }, 400); return true }
    if (occ) {
      const conflict = binding.conflictFor('', occ)
      if (conflict) { send(res, { ok: false, error: `这个住处已经住着「${conflict.name}」了` }, 409); return true }
    }
    const c = binding.birth(name, occ)
    if (occ) renameScopeAsync(host, stateDir, occ, name)
    // 新会话是空的会被侧边栏忽略：搬进去后先让她在自己的房间里说一句话
    if (occ && occ.kind === 'session') {
      try {
        // 先等注入循环认领这个会话（它会在 400ms 后重试），再叫醒她
        await new Promise((r) => setTimeout(r, 1600))
        let agent = null
        for (let i = 0; i < 4 && !agent; i++) {
          if (i) await new Promise((r) => setTimeout(r, 500))
          agent = host.agentFor?.(occ.id) ?? null
        }
        if (agent) await host.wake(agent, injectMessage(moveInText({ name, occupancy: occ, dataDir: homeDir(c) }), { mode: 'self', reason: null }))
        else console.error('[fishbowl] move-in wake skipped: no live agent for', occ.id)
      } catch (e) { console.error('[fishbowl] move-in wake failed:', String(e?.message ?? e)) }
    }
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
  if (action === 'move' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req) || '{}')
    const target = String(body.workspace ?? '').trim()
    if (!target) { send(res, { ok: false, error: '先选一个新屋子' }, 400); return true }
    if (!host.workspaceByPath?.(target)) { send(res, { ok: false, error: '这个屋子不存在：' + target }, 400); return true }

    // 旧房间归档（文件保留，侧边栏隐藏）
    const prev = c.meta.occupancy
    let archived = false
    if (prev?.kind === 'session' && prev.workspace) {
      const oldWs = host.workspaceByPath?.(prev.workspace)
      if (oldWs) archived = await host.archiveSession?.(oldWs, prev.id) ?? false
    }

    // 新房间
    let s = null
    try { s = await host.createSession({ path: target, title: c.meta.name + '的房间' }) }
    catch (e) { send(res, { ok: false, error: String(e?.message ?? e) }, 400); return true }
    const occ = { kind: 'session', id: s.id, workspace: s.workspace || target }
    try { binding.assign(parts[1], occ) }
    catch (e) { send(res, { ok: false, error: String(e?.message ?? e) }, e?.code === 'OCCUPIED' ? 409 : 400); return true }
    renameScopeAsync(host, stateDir, occ, c.meta.name)

    // 让她在新房间里开口（等注入循环认领）
    try {
      await new Promise((r) => setTimeout(r, 1600))
      let agent = null
      for (let i = 0; i < 4 && !agent; i++) {
        if (i) await new Promise((r) => setTimeout(r, 500))
        agent = host.agentFor?.(occ.id) ?? null
      }
      if (agent) await host.wake(agent, injectMessage(moveInText({ name: c.meta.name, occupancy: occ, dataDir: homeDir(c) }), { mode: 'self', reason: null }))
    } catch (e) { console.error('[fishbowl] move wake failed:', String(e?.message ?? e)) }

    send(res, { ok: true, archived, fish: fishView(binding.get(parts[1])) })
    return true
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
    // 同意且是结构化请求 → 签发一张许可（带范围/次数/期限）
    try {
      const r0 = c.requests().find((r) => r.id === parts[3])
      if (body.answer === 'yes' && r0?.action) {
        recordPermit(c, { action: r0.action, target: r0.target, uses: r0.uses ?? 1, ttlMs: r0.ttlMs ?? 2 * 60 * 60_000, ref: r0.id })
      }
    } catch (e) { console.error('[fishbowl] permit issue failed:', String(e?.message ?? e)) }
    // 回音要叫醒她一次：不然她永远不知道自己请求过什么、你答了什么
    try {
      const reqText = c.requests().find((r) => r.id === parts[3])?.text ?? ''
      const occ = c.meta.occupancy
      const agent = occ?.kind === 'session' ? host.agentFor?.(occ.id) : null
      const word = body.answer === 'yes' ? '同意' : '不同意'
      const text = `（他回答了你的请求「${reqText}」：${word}。想做什么就做，不想做也行。）`
      if (agent) {
        await host.wake(agent, injectMessage(text, { mode: 'contact', reason: '请求有回音' }))
      } else {
        // 会话没开着：写进待送，下次打开时补投
        c.store.appendOutbox({
          id: randomUUID(), ts: Date.now(), text, channel: 'dsm-session', delivered: false,
          wake: { mode: 'contact', reason: '请求有回音' },
        })
      }
    } catch (e) { console.error('[fishbowl] request wake failed:', String(e?.message ?? e)) }
    send(res, { ok: true, requests: c.requests().slice(-30).reverse() })
    return true
  }

  return false
}
