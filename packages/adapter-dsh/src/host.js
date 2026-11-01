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

/** 会话所在工作区（绝对路径）；取不到返回 undefined。 */
export function workspaceOf(session) {
  const cwd = session?.header?.cwd ?? session?.cwd ?? session?.meta?.cwd
  return typeof cwd === 'string' && cwd.length > 0 ? cwd : undefined
}

/** 在注册表里找活的 agent。 */
export function findAgent(ctx, sessionId) {
  const reg = ctx.agents
  if (!reg) return null
  try {
    if (typeof reg.get === 'function') {
      const a = reg.get(sessionId)
      if (a) return a
    }
  } catch { /* 形状不同则继续 */ }
  try {
    const list = typeof reg.list === 'function' ? reg.list() : []
    for (const a of list) {
      if (a && (a.id === sessionId || a.session?.id === sessionId)) return a
    }
  } catch { /* 同上 */ }
  return null
}

/** 路径归一：统一分隔符、去尾斜杠、小写（Windows 不区分大小写）。 */
function normPath(p) {
  return String(p ?? '').replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase()
}

/**
 * 工作区目录名是编码过的（`--C-Users-x-.dsh-fish-home--`，分隔符折叠成 `-`，
 * 特殊字符转 `~XXXX`）。用「把 - 当分隔符穷举切分 + 路径存在性校验」还原真实路径。
 */
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

function scopesRoots() {
  const out = []
  if (process.env.DSH_HOME) out.push(path.join(process.env.DSH_HOME, 'sessions'))
  out.push(path.join(os.homedir(), '.dsh', 'sessions'))
  return [...new Set(out)].filter((r) => r && fs.existsSync(r))
}

/** 枚举全部工作区与会话（DSH 磁盘布局）。 */
export function enumerateScopes() {
  const workspaces = []
  const sessions = []
  let scanned = 0
  let decoded = 0
  for (const root of scopesRoots()) {
    try {
      for (const d of fs.readdirSync(root, { withFileTypes: true })) {
        if (!d.isDirectory() || !d.name.startsWith('--') || !d.name.endsWith('--')) continue
        scanned += 1
        const ws = decodeWorkspace(d.name)
        if (!ws) continue
        decoded += 1
        if (!workspaces.includes(ws)) workspaces.push(ws)
        let names = []
        try { names = fs.readdirSync(path.join(root, d.name), { withFileTypes: true }) } catch { /* 跳过 */ }
        for (const n of names) {
          if (n.isDirectory() && n.name.startsWith('session-') && !sessions.some(x => x.id === n.name)) {
            sessions.push({ id: n.name, workspace: ws })
          }
        }
      }
    } catch { /* 单个 root 失败不影响其他 */ }
  }
  return { workspaces, sessions }
}

/** @param {any} ctx 插件根上下文 @param {{stateDir: string, timezone?: string}} cfg */
export function createDshHost(ctx, cfg) {
  const get = (name) => {
    try { return typeof ctx.get === 'function' ? ctx.get(name) : undefined } catch { return undefined }
  }

  let lastSessionError = null

  function sessionsService() { return get('sessions') }
  function titlesService() { return get('sessionTitle') }
  function workspaceRegistry() { return get('workspaceRegistry') }

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
        const reg = ctx.agents
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
    async createSession({ workspaceId, cwd, path: dirPath } = {}) {
      const registry = workspaceRegistry()
      let target = null
      if (workspaceId) {
        target = registry?.get?.(workspaceId) ?? null
        if (!target) throw new Error('工作区不存在：' + workspaceId)
      }
      const dir = path.resolve(cwd || target?.path || dirPath || '')
      if (!dir) throw new Error('新建会话需要工作区或目录')

      // DSH 的会话就是 agent：走 agents.create（与 GUI 新建会话同一条路）
      const agents = ctx.agents ?? get('agents')
      if (!agents?.create) throw new Error('宿主没有会话服务（agents.create 不可用）')
      const dm = get('agentDefaultModel')
      let sel = {}
      try { sel = dm?.currentSelection?.() ?? {} } catch { sel = {} }
      const sessionId = 'session-' + randomUUID()
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
            meta: { cwd: dir },
          })
          lastErr = null
          break
        } catch (e) { lastErr = e }
      }
      if (lastErr) throw lastErr
      const id = handle?.agent?.id ?? sessionId
      if (!id) throw new Error('会话创建失败')
      // 挂到工作区（侧边栏按 workspace.sessionIds 显示）：list() 给的是视图，要 get() 拿真实实例
      let ws = target ?? (registry?.list?.() ?? []).find((w) => w?.path && normPath(w.path) === normPath(dir)) ?? null
      try { if (ws?.id) ws = registry?.get?.(ws.id) ?? ws } catch { /* 忽略 */ }
      let attached = false
      let attachError = null
      if (ws && typeof ws.attachSession === 'function') {
        try { await ws.attachSession(String(id)); attached = true }
        catch (e) { attachError = String(e?.message ?? e); lastSessionError = attachError; console.error('[fishbowl] attachSession failed:', attachError) }
      }
      return { id: String(id), workspace: dir, attached, attachError }
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
      // 会话列表以 DSH 工作区的 sessionIds 为准，和侧边栏保持一致
      const regs = workspaceRegistry()?.list?.() ?? []
      const byNorm = new Map()
      for (const w of regs) if (w?.path) byNorm.set(normPath(w.path), String(w.title ?? ''))
      // 键必须和返回给界面的 workspaces 完全一致（注册表里的写法可能小写/正斜杠）
      const workspaceNames = {}
      const nativeOf = new Map()
      for (const p of scopes.workspaces) {
        workspaceNames[p] = byNorm.get(normPath(p)) ?? ''
        nativeOf.set(normPath(p), p)
      }
      const sessions = []
      const seenSess = new Set()
      for (const w of regs) {
        for (const sid of (w.sessionIds ?? [])) {
          const id = String(sid)
          if (seenSess.has(id)) continue
          seenSess.add(id)
          sessions.push({ id, workspace: nativeOf.get(normPath(w.path)) ?? w.path, title: titleOf(id) })
        }
      }
      // 没有注册表时退回枚举，至少能列出来
      if (!regs.length) {
        for (const s of scopes.sessions) sessions.push({ ...s, title: titleOf(s.id) })
      }
      return { workspaces: scopes.workspaces, sessions, workspaceNames }
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
