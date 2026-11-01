/**
 * DSH 作用域与工作区工具：路径归一、工作区名解码、磁盘枚举。
 * 从 host.js 拆出：这些是纯函数，不碰 ctx，可单独测试。
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
  let reg = null
  try { reg = typeof ctx.get === 'function' ? ctx.get('agents') : undefined } catch { reg = null }
  if (!reg) { try { reg = ctx.agents } catch { reg = null } }
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
export function normPath(p) {
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

