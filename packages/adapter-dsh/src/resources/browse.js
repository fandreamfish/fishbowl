/** 上网与 B 站相关的全局路由：浏览配置、风控、登录态、评论区、手动唤醒。 */
import fs from 'node:fs'
import path from 'node:path'
import { injectMessage } from '../../../app/src/index.js'
import { normalizeConfig } from '../../../app/src/index.js'
import { pickCommentConfig } from '../../../app/src/index.js'
import { saveUiConfig } from '../settings.js'
import { wakeSituation, wakeTrigger, selfSituation } from '../../../app/src/index.js'
import { workspaceOf } from '../../../app/src/index.js'
import { recordWake } from '../../../being/src/index.ts'
import { normalizeBrowseConfig } from '../../../bilibili/src/index.js'
import { clearRisk, riskState } from '../../../bilibili/src/index.js'
import { markSelfTime } from '../../../bilibili/src/index.js'
import { readAuth, publicAuth, saveAuth, saveAccount, clearCookie } from '../../../bilibili/src/index.js'
import { createClient } from '../../../bilibili/src/index.js'

export async function handleBrowse({ cfg, binding, host, stateDir, send, readBody }, req, res, parts, sub) {
  if (sub === '/browse') {
    if (req.method === 'GET') { send(res, { ok: true, config: cfg.browse, risk: riskState(stateDir), ffmpeg: false }); return true }
    if (req.method === 'POST') {
      const body = JSON.parse(await readBody(req) || '{}')
      cfg.browse = normalizeBrowseConfig(body.browse ?? body)
      saveUiConfig(stateDir, { browse: cfg.browse })
      send(res, { ok: true, config: cfg.browse })
      return true
    }
  }
  if (sub === '/browse/risk/reset' && req.method === 'POST') {
    clearRisk(stateDir)
    send(res, { ok: true, risk: riskState(stateDir) })
    return true
  }

  if (sub === '/bili') {
    if (req.method === 'GET') {
      send(res, { ok: true, auth: publicAuth(readAuth(stateDir)), comment: cfg.comment })
      return true
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
      send(res, { ok: true, auth: publicAuth(readAuth(stateDir)), comment: cfg.comment })
      return true
    }
  }
  if (sub === '/bili/auth' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req) || '{}')
    const r = saveAuth(stateDir, body)
    send(res, { ok: r.ok !== false, note: r.note, auth: r.auth, missing: r.missing ?? [] })
    return true
  }
  if (sub === '/bili/auth/test' && req.method === 'POST') {
    const auth = readAuth(stateDir)
    if (!auth?.cookie) { send(res, { ok: false, error: '还没存 cookie' }, 400); return true }
    try {
      const client = createClient({ cookie: auth.cookie })
      const me = await client.me()
      if (me?.isLogin) {
        saveAccount(stateDir, me)
        send(res, { ok: true, me: { mid: me.mid, name: me.uname, canWrite: me.canWrite }, auth: publicAuth(readAuth(stateDir)), note: me.canWrite ? '能说话。' : (me.why || '登录了，但不能写。') })
        return true
      }
      send(res, { ok: false, error: me?.why || 'cookie 已失效' }, 400)
      return true
    } catch (e) {
      send(res, { ok: false, error: String(e?.message ?? e) }, 500)
      return true
    }
  }
  if (sub === '/bili/auth/clear' && req.method === 'POST') {
    send(res, { ok: true, auth: clearCookie(stateDir) })
    return true
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
    if (!target || !creature) { send(res, { ok: false, error: '没有活着的会话' }, 400); return true }
    const now = Date.now()
    const trace = (line) => {
      try { fs.appendFileSync(path.join(stateDir, 'trace.ndjson'), JSON.stringify(line) + '\n') } catch { /* 忽略 */ }
    }
    if (mode === 'self') {
      const text = wakeTrigger(now, selfSituation(creature, cfg), 'self')
      try {
        await host.wake(target, injectMessage(text, { mode: 'self', reason: null }))
        recordWake(creature, 'self', null, now)
        markSelfTime(creature.meta.creatureId, now + 10 * 60_000)
        trace({ ts: now, event: 'wake-manual', mode, creature: creature.meta.name, text })
        send(res, { ok: true, mode, text })
        return true
      } catch (e) {
        send(res, { ok: false, error: String(e?.message ?? e) }, 500)
        return true
      }
    }
    const reason = '你想主动找他（手动触发）'
    const text = wakeTrigger(now, wakeSituation(reason), 'contact')
    if (!text) { send(res, { ok: false, error: '生成失败' }, 500); return true }
    try {
      await host.wake(target, injectMessage(text, { mode: 'contact', reason }))
      creature.recordOutreach('manual', now)
      recordWake(creature, 'contact', reason, now)
      trace({ ts: now, event: 'wake-manual', mode, creature: creature.meta.name, text })
      send(res, { ok: true, mode, text })
      return true
    } catch (e) {
      send(res, { ok: false, error: String(e?.message ?? e) }, 500)
      return true
    }
  }

  // —— 诊断：服务可用性 ——
  if (sub === '/debug/services' && req.method === 'GET') {
    send(res, host.services())
    return true
  }
  return false
}
