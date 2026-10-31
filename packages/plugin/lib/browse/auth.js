/**
 * B 站登录态与「要 @ 的人」。
 *
 * 三件事分开：
 *   - mid / 昵称是写给谁看的元数据，可以出现在设置页；
 *   - cookie 是钥匙，只能看见「有没有」，看不见内容；
 *   - 登录账号（account）是这份 cookie 登的是谁，只读，测试时自动认。
 *
 * 文件放 `<stateDir>/../bili-auth.json`（默认 ~/.fishbowl/bili-auth.json），
 * 0600；日志与设置页永远不回显 cookie 原文。
 */
import fs from 'node:fs'
import path from 'node:path'

const COOKIE_NAMES = ['SESSDATA', 'bili_jct', 'buvid3', 'DedeUserID', 'DedeUserID__ckMd5', 'sid']

export function authPath(stateDir) {
  return path.join(path.dirname(path.resolve(stateDir)), 'bili-auth.json')
}

export function readAuth(stateDir) {
  try {
    const o = JSON.parse(fs.readFileSync(authPath(stateDir), 'utf8'))
    return o && typeof o === 'object' ? o : null
  } catch {
    return null
  }
}

export function writeAuth(stateDir, data) {
  const file = authPath(stateDir)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 })
  try { fs.renameSync(tmp, file) } catch { fs.writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600 }) }
  try { fs.chmodSync(file, 0o600) } catch { /* Windows 不保证 */ }
  return data
}

/** 给外面看的样子：永远不含 cookie 原文。 */
export function publicAuth(ow) {
  const o = ow ?? {}
  const acct = o.account ?? {}
  return {
    mid: String(o.mid ?? ''),
    nickname: String(o.nickname ?? ''),
    atOwner: o.atOwner !== false,
    account: { mid: String(acct.mid ?? ''), name: String(acct.name ?? '') },
    hasCookie: Boolean(o.cookie && String(o.cookie).length > 0),
    hasCsrf: Boolean(o.cookie && /bili_jct=/.test(String(o.cookie))),
    savedAt: String(o.savedAt ?? ''),
  }
}

/** 从纯 cookie、DevTools 的 Cookie: 头、或 Netscape cookies.txt 里抠出 B 站用的键。 */
export function parseCookieInput(raw) {
  const text = String(raw ?? '').trim()
  if (!text) return { cookie: '', missing: ['SESSDATA', 'bili_jct'] }
  const pairs = []
  const seen = new Set()
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const tab = t.split('\t')
    if (tab.length >= 7) {
      const name = tab[5].trim()
      const value = tab[6].trim()
      if (name && !seen.has(name)) { seen.add(name); pairs.push([name, value]) }
      continue
    }
    const body = t.replace(/^cookie\s*:\s*/i, '')
    for (const part of body.split(';')) {
      const i = part.indexOf('=')
      if (i <= 0) continue
      const name = part.slice(0, i).trim()
      const value = part.slice(i + 1).trim()
      if (!name || seen.has(name)) continue
      seen.add(name)
      pairs.push([name, value])
    }
  }
  const kept = pairs.filter(([n]) => COOKIE_NAMES.includes(n))
  const cookie = kept.map(([n, v]) => `${n}=${v}`).join('; ')
  const missing = ['SESSDATA', 'bili_jct'].filter((n) => !seen.has(n))
  return { cookie: normalizeCookie(cookie), missing }
}

/** 允许从 Netscape cookies.txt 或 "a=1; b=2" 传入。 */
export function normalizeCookie(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return ''
  if (s.includes('\t')) {
    const pairs = []
    for (const line of s.split(/\r?\n/)) {
      if (!line || line.startsWith('#')) continue
      const p = line.split('\t')
      if (p.length >= 7 && p[5]) pairs.push(`${p[5]}=${p[6]}`)
    }
    return pairs.join('; ')
  }
  return s
}

/** 存一次：只改传进来的字段；cookie: '' 表示清除。 */
export function saveAuth(stateDir, patch = {}) {
  const cur = readAuth(stateDir) ?? {}
  const next = { ...cur }
  if (patch.mid !== undefined) next.mid = String(patch.mid).trim()
  if (patch.nickname !== undefined) next.nickname = String(patch.nickname).trim()
  if (patch.atOwner !== undefined) next.atOwner = patch.atOwner !== false
  if (patch.cookie !== undefined) {
    const raw = String(patch.cookie).trim()
    if (!raw) {
      delete next.cookie
      delete next.savedAt
      return { ok: true, note: '清掉了。', auth: publicAuth(writeAuth(stateDir, next)) }
    }
    const parsed = parseCookieInput(raw)
    if (!parsed.cookie) {
      writeAuth(stateDir, next)
      return { ok: false, note: 'cookie 里没认出 B 站的键，只存下了上面两格。', auth: publicAuth(next) }
    }
    next.cookie = parsed.cookie
    next.savedAt = new Date().toISOString()
    const auth = publicAuth(writeAuth(stateDir, next))
    return { ok: true, note: parsed.missing.length ? `存下了，但少了 ${parsed.missing.join(' / ')}。` : '存下了。', auth, missing: parsed.missing }
  }
  return { ok: true, note: '存下了。', auth: publicAuth(writeAuth(stateDir, next)) }
}

/** 记下这份 cookie 登的是哪个账号（测试时调用）。 */
export function saveAccount(stateDir, me) {
  const cur = readAuth(stateDir) ?? {}
  return publicAuth(writeAuth(stateDir, {
    ...cur,
    account: { mid: String(me?.mid ?? ''), name: String(me?.uname ?? me?.name ?? ''), savedAt: new Date().toISOString() },
  }))
}

export function clearCookie(stateDir) {
  const cur = readAuth(stateDir) ?? {}
  delete cur.cookie
  delete cur.account
  delete cur.savedAt
  return publicAuth(writeAuth(stateDir, cur))
}

/**
 * 艾特前缀：只有开会 @ 且有昵称才加；昵称里的空格换成下划线（站内常见写法）。
 * 回复别人时不加——那会把别人的楼变成你们的客厅。
 */
export function mentionPrefix(auth, cfg) {
  const on = cfg?.atOwner !== false
  const name = String(auth?.nickname ?? '').trim()
  if (!on || !name) return ''
  return `@${name.replace(/\s+/g, '_')} `
}
