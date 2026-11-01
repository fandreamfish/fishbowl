/**
 * FishHost · DSH 适配器（0.2.1-rc.5）
 *
 * 这一层是「鱼」和 DSH 之间唯一的接线处。上层模块（collector/life/constraints/
 * ui-route/rename）只认这里的接口；DSH 升级时坏也只坏这一层。
 *
 * 接口（约 7 个动词）：
 *   onSessionEvent(fn)     会话事件流（谁说了什么、一轮结束）
 *   onAgentCreated(fn)     agent 建立（注入基线与声音规则）
 *   agentFor(sessionId)    会话 → 活着的 agent
 *   inject(agent, msg)     把状态块塞进下一步（不唤醒）
 *   wake(agent, msg)       主动开一轮
 *   voice(agent, text)     注册该 agent 专属的声音段
 *   guard(fn) / preExecute(fn)  工具拦截（可选）
 *   titleOf(scope) / nameScope(scope, title)  改名（可选）
 *   listScopes()           工作区与会话枚举
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export { workspaceOf, findAgent, decodeWorkspace, enumerateScopes } from './host/scopes.js'
import { enumerateScopes, findAgent, normPath, scopesRoots, workspaceOf } from './host/scopes.js'

/** @param {any} ctx 插件根上下文 @param {{stateDir: string, timezone?: string}} cfg */
export function createDshHost(ctx, cfg) {
  const get = (name) => {
    try { return typeof ctx.get === 'function' ? ctx.get(name) : undefined } catch { return undefined }
  }

  let lastSessionError = null
  let lastCreate = null

  /** 安全取服务：ctx.agents 是注入属性，未激活时会抛，一律走 get + 兜底。 */
  function svc(name) {
    try { const s = get(name); if (s) return s } catch { /* 未激活 */ }
    try { return ctx[name] } catch { return undefined }
  }

  function sessionsService() { return svc('sessions') }
  function titlesService() { return svc('sessionTitle') }
  function workspaceRegistry() { return svc('workspaceRegistry') }

  function liveSession(id) {
    const sessions = sessionsService()
    try { return sessions && typeof sessions.get === 'function' ? sessions.get(id) : null } catch { return null }
  }

  function workspaceByPath(p) {
    const registry = workspaceRegistry()
    try {
      const list = typeof registry?.list === 'function' ? registry.list() : []
      const want = normPath(p)
      return list.find((w) => w && normPath(w.path) === want) ?? null
    } catch {
      return null
    }
  }

  return {
    kind: 'dsh',
    stateDir: cfg.stateDir,

    onSessionEvent(fn) {
      return ctx.on('session/event', fn)
    },

    onAgentCreated(fn) {
      return ctx.on('agent/created', fn)
    },

    onAgentDisposed(fn) {
      return ctx.on('agent/disposed', fn)
    },

    agentFor(sessionId) {
      return findAgent(ctx, sessionId)
    },

    /** 所有活着的 agent（跨会话同步用）。 */
    listAgents() {
      try {
        const reg = svc('agents')
        return typeof reg?.list === 'function' ? (reg.list() ?? []) : []
      } catch {
        return []
      }
    },

    /**
     * 注册 HTTP 路由（kind: 'prefix' | 'exact'）。
     *
     * 启动顺序问题：插件可能先于 webServer 服务激活，`get('webServer')` 这时是
     * undefined。以前直接放弃 → 重启后设置页一直 404，只有手动停用再启用才恢复。
     * 现在：服务没起来就等它起来再注册（ctx.inject 会在服务可用时回调）。
     */
    registerRoute(route) {
      const tryRegister = (webServer) => {
        if (!webServer || typeof webServer.register !== 'function') return undefined
        try { return webServer.register(route) } catch { return undefined }
      }

      const ready = tryRegister(get('webServer'))
      if (ready) return ready

      if (typeof ctx.inject === 'function') {
        let dispose
        try {
          const off = ctx.inject(['webServer'], (scoped) => {
            dispose = tryRegister(scoped?.webServer ?? get('webServer'))
            if (dispose) return () => { try { dispose() } catch { /* 忽略 */ } }
            return undefined
          })
          return () => { try { off?.() } catch { /* 忽略 */ } }
        } catch { /* 退回轮询 */ }
      }

      // 兜底轮询（最多 30 秒，每秒一次）
      let tries = 0
      let timer = null
      let disposed = false
      let dispose
      const poll = () => {
        if (disposed) return
        dispose = tryRegister(get('webServer'))
        if (dispose) return
        if (++tries >= 30) return
        timer = setTimeout(poll, 1000)
      }
      timer = setTimeout(poll, 500)
      return () => {
        disposed = true
        if (timer) clearTimeout(timer)
        try { dispose?.() } catch { /* 忽略 */ }
      }
    },

    inject(agent, message) {
      return agent.inject(message)
    },

    wake(agent, message) {
      return agent.followup(message)
    },

    /** 声音段：只作用于这个 agent（DSH 的 scoped systemPrompt 贡献）。 */
    /** 动态状态段：每次组装提示词时现算，不再往 inbox 里塞消息。 */
    stateSection(agent, build) {
      try {
        agent.ctx?.systemPrompt?.section?.({
          name: 'fishbowl-state',
          order: 450,
          text: (context) => {
            try { return String(build(context) ?? '') } catch { return '' }
          },
        })
      } catch { /* 注册失败不影响对话 */ }
    },

    voice(agent, text) {
      agent.ctx?.systemPrompt?.section?.({ name: 'fishbowl-voice', order: 400, text })
    },

    guard(fn) {
      return typeof ctx.tools?.guard === 'function' ? ctx.tools.guard(fn) : undefined
    },

    /** 注册一个工具（模型可见）。传的是注册表认的形状，不需要 dsh-tools 的 defineTool。 */
    registerTool(def) {
      if (typeof ctx.tools?.register !== 'function') return undefined
      try {
        return ctx.tools.register(def)
      } catch {
        return undefined
      }
    },

    preExecute(fn) {
      return ctx.on('tools/pre-execute', fn)
    },

    /** 当前标题（会话/工作区）；读不到返回 null。 */
    titleOf(occ) {
      try {
        if (occ.kind === 'session') {
          const session = liveSession(occ.id)
          const titles = titlesService()
          if (!session || !titles || typeof titles.get !== 'function') return null
          return titles.get(session)?.title ?? null
        }
        return workspaceByPath(occ.id)?.title ?? null
      } catch {
        return null
      }
    },

    /**
     * 给住处改名。
     * @returns {{ok: boolean, why?: string}}
     */
    async nameScope(occ, title) {
      try {
        if (occ.kind === 'session') {
          const sessions = sessionsService()
          const titles = titlesService()
          if (!sessions || typeof sessions.get !== 'function') return { ok: false, why: 'no-sessions-service' }
          if (!titles || typeof titles.rename !== 'function') return { ok: false, why: 'no-sessionTitle-service' }
          const session = liveSession(occ.id)
          if (!session) return { ok: false, why: 'session-not-live' }
          titles.rename(session, title)
          return { ok: true }
        }
        const ws = workspaceByPath(occ.id)
        if (!ws) return { ok: false, why: 'workspace-not-found' }
        await ws.setTitle(title)
        return { ok: true }
      } catch (e) {
        return { ok: false, why: String((e && e.message) || e) }
      }
    },

    /** 新建工作区：目录必须已存在。返回 { id, path, title }。 */
    async createWorkspace(p) {
      const registry = workspaceRegistry()
      if (!registry || typeof registry.create !== 'function') throw new Error('宿主没有工作区服务')
      const abs = normPath(p)
      if (!fs.existsSync(abs)) throw new Error('目录不存在：' + abs)
      const w = await registry.create(abs)
      const id = w?.id ?? w?.workspace?.id
      if (!id) throw new Error('工作区创建失败')
      return { id: String(id), path: abs, title: String(w?.title ?? '') }
    },

    /** 新建会话（可选挂到某个工作区）。返回 { id, workspace }。 */
    async createSession({ workspaceId, cwd, path: dirPath, title } = {}) {
      const registry = workspaceRegistry()
      let target = null
      if (workspaceId) {
        target = registry?.get?.(workspaceId) ?? null
        if (!target) throw new Error('工作区不存在：' + workspaceId)
      }
      const dir = path.resolve(cwd || target?.path || dirPath || '')
      if (!dir) throw new Error('新建会话需要工作区或目录')
      try { fs.mkdirSync(dir, { recursive: true }) } catch { /* 建不出来就让后面的 create 报错 */ }

      // DSH 的会话就是 agent：走 agents.create（与 GUI 新建会话同一条路）
      const agents = svc('agents') ?? svc('agent')
      if (!agents?.create) throw new Error('宿主没有会话服务（agents.create 不可用）')
      const dm = get('agentDefaultModel')
      let sel = {}
      try { sel = dm?.currentSelection?.() ?? {} } catch { sel = {} }
      const sessionId = 'session-' + randomUUID()
      // 默认 agent preset：不挂 preset 的 agent 没有标准工具（pwsh/read/glob 都没有）
      const presets = svc('agentPresets')
      let agentPreset = null
      let setup = null
      let presetError = null
      lastCreate = { hasPresets: !!presets, presetId: null, presetError: null, setupCalled: false }
      if (presets?.mount) {
        try {
          let id = null
          try { id = (await presets.resolve(undefined))?.id ?? null } catch (e) { presetError = 'resolve: ' + String(e?.message ?? e) }
          if (!id && typeof presets.list === 'function') {
            const list = await presets.list()
            id = list?.[0]?.id ?? null
            if (!id && !presetError) presetError = 'preset 列表为空'
          }
          agentPreset = id
          if (agentPreset) setup = async (agentCtx) => { lastCreate.setupCalled = true; await presets.mount(agentCtx, agentPreset) }
        } catch (e) { presetError = String(e?.message ?? e) }
      } else presetError = '宿主没有 agentPresets 服务'
      lastCreate.presetId = agentPreset
      lastCreate.presetError = presetError
      if (!agentPreset) throw new Error('无法挂载 agent preset（' + (presetError || '未知原因') + '）：这样建出来的房间没有工具')
      let handle = null
      let lastErr = null
      for (const agentOptions of [
        Object.keys(sel).length ? { provider: sel.provider, model: sel.model } : null,
        undefined,
      ]) {
        try {
          handle = await agents.create({
            sessionId,
            ...(agentOptions ? { agentOptions } : {}),
            meta: { cwd: dir, ...(agentPreset ? { agentPreset } : {}) },
            ...(setup ? { setup } : {}),
          })
          lastErr = null
          break
        } catch (e) { lastErr = e }
      }
      if (lastErr) throw lastErr
      const id = handle?.agent?.id ?? sessionId
      if (!id) throw new Error('会话创建失败')
      try { svc('approval')?.setPolicy?.(handle.agent, 'never') } catch (e) { console.error('[fishbowl] approval setPolicy failed:', String(e?.message ?? e)) }
      // 她的家（creatures/<id>/home）在房间之外：workspace-write 会拒绝写入，改成完全访问（写入范围由工具层守卫限制）
      try {
        const pp = svc('permissionPresets')
        const full = (pp?.names ?? []).find((n) => n === 'danger-full-access') ?? (pp?.names ?? []).find((n) => /danger|full/.test(n))
        if (full) pp.apply(handle.agent.session, full, (policy) => svc('approval')?.setPolicy?.(handle.agent, policy))
        lastCreate = { ...(lastCreate ?? {}), sandboxPreset: full ?? null }
      } catch (e) { console.error('[fishbowl] sandbox preset failed:', String(e?.message ?? e)) }
      // 给会话一个标题：侧边栏与设置页都按标题认人
      if (title) {
        try {
          const titles = svc('sessionTitle')
          const live = handle?.agent?.session ?? sessionsService()?.get?.(String(id))
          if (titles?.rename && live) titles.rename(live, String(title))
        } catch (e) { console.error('[fishbowl] rename session failed:', String(e?.message ?? e)) }
      }
      // 挂到工作区（侧边栏按 workspace.sessionIds 显示）：list() 给的是视图，要 get() 拿真实实例
      let ws = target ?? (registry?.list?.() ?? []).find((w) => w?.path && normPath(w.path) === normPath(dir)) ?? null
      try {
        if (!ws || typeof ws.attachSession !== 'function') {
          const real = ws?.id ? registry?.get?.(ws.id) : undefined
          if (real && typeof real.attachSession === 'function') ws = real
        }
      } catch { /* 忽略 */ }
      let attached = false
      let attachError = null
      if (ws && typeof ws.attachSession === 'function') {
        try { await ws.attachSession(String(id)); attached = true }
        catch (e) { attachError = String(e?.message ?? e); lastSessionError = attachError; console.error('[fishbowl] attachSession failed:', attachError) }
      }
      return { id: String(id), workspace: dir, attached, attachError }
    },

    /** 按路径找注册表里的工作区（返回真实实例，可 detachSession）。 */
    workspaceByPath(p) {
      const registry = workspaceRegistry()
      try {
        const list = registry?.list?.() ?? []
        const hit = list.find((w) => w?.path && normPath(w.path) === normPath(p))
        if (!hit) return null
        // 优先返回带方法（archiveSession 等）的实例：get() 可能给的是只读视图
        if (typeof hit.archiveSession === 'function') return hit
        const real = typeof registry?.get === 'function' ? registry.get(hit.id) : undefined
        if (real && typeof real.archiveSession === 'function') return real
        return real ?? hit
      } catch { return null }
    },

    /** 把会话从工作区摘掉（侧边栏不再显示）。 */
    async detachSession(ws, sid) {
      try { await ws.detachSession(String(sid)); return true } catch { return false }
    },

    /** 归档一个会话（侧边栏隐藏，文件保留）。 */
    async archiveSession(_ws, sid) {
      // 归档 = 从工作区摘掉（侧边栏才不再显示）+ 注册表归档（停止后续工作）
      const registry = workspaceRegistry()
      const id = String(sid)
      let ok = true
      try {
        for (const w of (registry?.list?.() ?? [])) {
          const ids = Array.isArray(w?.sessionIds) ? w.sessionIds : []
          if (!ids.includes(id)) continue
          if (typeof w.detachSession === 'function') await w.detachSession(id)
          break
        }
      } catch (e) { ok = false; lastSessionError = 'detach: ' + String(e?.message ?? e); console.error('[fishbowl] detachSession failed:', lastSessionError) }
      if (typeof registry?.archiveSession !== 'function') { lastSessionError = 'registry has no archiveSession'; return false }
      try { await registry.archiveSession(id, { stopActivity: true }) }
      catch (e) { ok = false; lastSessionError = 'archive: ' + String(e?.message ?? e); console.error('[fishbowl] archiveSession failed:', lastSessionError) }
      return ok
    },

    /** 取消归档：DSH 的 workspaceRegistry 有 unarchiveSession。 */
    async unarchiveSession(sid) {
      const registry = workspaceRegistry()
      try {
        if (typeof registry?.unarchiveSession === 'function') { await registry.unarchiveSession(String(sid)); return true }
      } catch (e) { lastSessionError = 'unarchive: ' + String(e?.message ?? e) }
      return false
    },

    /** 会话在磁盘上的目录（通常在某个 --workspace-- 目录下）。 */
    sessionDirsOf(sid) {
      const out = []
      const want = String(sid)
      for (const root of scopesRoots()) {
        let entries = []
        try { entries = fs.readdirSync(root, { withFileTypes: true }) } catch { continue }
        for (const d of entries) {
          if (!d.isDirectory()) continue
          const p = path.join(root, d.name, want)
          try { if (fs.statSync(p).isDirectory()) out.push(p) } catch { /* 不存在 */ }
        }
      }
      return out
    },

    /** 删除会话文件（调用方负责先确认没有鱼住）。返回删掉的目录数。 */
    deleteSessionFiles(sid) {
      let n = 0
      for (const dir of this.sessionDirsOf(sid)) {
        try { fs.rmSync(dir, { recursive: true, force: true }); n++ } catch { /* 尽力 */ }
      }
      return n
    },

    listScopes() {
      const scopes = enumerateScopes()
      const titles = get('sessionTitle')
      const sessionsSvc = sessionsService()
      const titleOf = (sid) => {
        try {
          const live = sessionsSvc?.get?.(sid)
          if (!live) return ''
          const t = titles?.get ? titles.get(live) : null
          if (!t) return ''
          return typeof t === 'string' ? t : String(t?.title ?? '')
        } catch { return '' }
      }
      // 工作区以注册表为准：即使目录被删了也列出来（创建会话时会重建目录）
      const regs = workspaceRegistry()?.list?.() ?? []
      const byNorm = new Map()
      for (const w of regs) if (w?.path) byNorm.set(normPath(w.path), String(w.title ?? ''))
      const workspaces = []
      const seenWs = new Set()
      for (const p of [...scopes.workspaces, ...regs.map((w) => w?.path).filter(Boolean)]) {
        if (!p || seenWs.has(normPath(p))) continue
        seenWs.add(normPath(p))
        workspaces.push(p)
      }
      const nativeOf = new Map()
      const workspaceNames = {}
      for (const p of workspaces) {
        workspaceNames[p] = byNorm.get(normPath(p)) ?? ''
        nativeOf.set(normPath(p), p)
      }
      const archived = new Set((workspaceRegistry()?.archivedSessionIds ?? []).map(String))
      const sessions = []
      const seenSess = new Set()
      for (const w of regs) {
        for (const sid of (w.sessionIds ?? [])) {
          const id = String(sid)
          if (seenSess.has(id) || archived.has(id)) continue
          seenSess.add(id)
          sessions.push({ id, workspace: nativeOf.get(normPath(w.path)) ?? w.path, title: titleOf(id) })
        }
      }
      // 没有注册表时退回枚举，至少能列出来
      if (!regs.length) {
        for (const s of scopes.sessions) sessions.push({ ...s, title: titleOf(s.id) })
      }
      return { workspaces, sessions, workspaceNames }
    },
    /**
     * 会话当前的审批策略：'ask' | 'never'；拿不到返回 null。
     * 策略是 never 时，插件发起的 ask 会被宿主**直接判成 rejected**，
     * 工具结果还会写成「the user rejected」——所以调用方得先问这一句再决定要不要 ask。
     */
    approvalPolicy(session) {
      try {
        const approval = get('approval')
        if (approval && typeof approval.effectivePolicy === 'function') return approval.effectivePolicy(session)
      } catch { /* 服务形状不同 */ }
      return null
    },

    /** 诊断用：服务挂没挂。 */
    services() {
      const sessions = sessionsService()
      let live = []
      try { live = (sessions?.list?.() ?? []).map((s) => s?.id).filter(Boolean) } catch { live = [] }
      return {
        hasSessions: !!sessions,
      lastSessionError,
      lastCreate,
      permissionPresets: (() => { try { return svc('permissionPresets')?.names ?? null } catch { return null } })(),
      wsProbe: (() => {
        try {
          const list = workspaceRegistry()?.list?.() ?? []
          const w = list[0]
          const g = w?.id ? workspaceRegistry()?.get?.(w.id) : null
          return { registryHasArchive: typeof workspaceRegistry()?.archiveSession, listHasArchive: typeof w?.archiveSession, getHasArchive: typeof g?.archiveSession, entityHasAttach: typeof w?.attachSession, count: list.length }
        } catch (e) { return String(e?.message ?? e) }
      })(),
        hasSessionTitle: !!titlesService(),
        hasWorkspaceRegistry: !!workspaceRegistry(),
        liveSessions: live,
        workspaces: (() => {
          try { return (workspaceRegistry()?.list?.() ?? []).map((w) => ({ id: w.id, path: w.path, title: w.title })) } catch { return [] }
        })(),
      }
    },
  }
}
