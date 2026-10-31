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

    /** 注册 HTTP 路由（kind: 'prefix' | 'exact'）。 */
    registerRoute(route) {
      const webServer = get('webServer')
      if (!webServer || typeof webServer.register !== 'function') return undefined
      return webServer.register(route)
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

    listScopes() {
      return enumerateScopes()
    },

    /** 诊断用：服务挂没挂。 */
    services() {
      const sessions = sessionsService()
      let live = []
      try { live = (sessions?.list?.() ?? []).map((s) => s?.id).filter(Boolean) } catch { live = [] }
      return {
        hasSessions: !!sessions,
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
