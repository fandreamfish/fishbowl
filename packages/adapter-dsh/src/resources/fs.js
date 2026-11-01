/** 文件系统：给「新建工作区」用的目录浏览器（只列目录、只建文件夹）。 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

function roots() {
  if (process.platform !== 'win32') return [{ label: '/', path: '/' }, { label: '家目录', path: os.homedir() }]
  const out = []
  for (let c = 65; c <= 90; c++) {
    const d = String.fromCharCode(c) + ':\\'
    try { if (fs.existsSync(d)) out.push({ label: d, path: d }) } catch { /* 忽略无权限盘 */ }
  }
  out.push({ label: '家目录', path: os.homedir() })
  return out
}

export async function handleFs({ send, readBody }, req, res, parts) {
  if (parts[0] !== 'fs') return false

  if (parts[1] === 'dirs' && req.method === 'GET') {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const dir = path.resolve(url.searchParams.get('path') || os.homedir())
    let stat = null
    try { stat = fs.statSync(dir) } catch { /* 不存在 */ }
    if (!stat || !stat.isDirectory()) { send(res, { ok: false, error: '目录不存在：' + dir }, 400); return true }
    let dirs = []
    try {
      dirs = fs.readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort((a, b) => a.localeCompare(b, 'zh-CN'))
    } catch (e) {
      send(res, { ok: false, error: '读不了这个目录：' + String(e?.message ?? e) }, 400)
      return true
    }
    const parent = path.dirname(dir)
    send(res, { ok: true, path: dir, parent: parent !== dir ? parent : null, dirs, places: roots() })
    return true
  }

  if (parts[1] === 'mkdir' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req) || '{}')
    const parent = path.resolve(String(body.parent ?? ''))
    const name = String(body.name ?? '').trim()
    if (!name) { send(res, { ok: false, error: '先填文件夹名' }, 400); return true }
    if (/[\\/:*?"<>|]/.test(name)) { send(res, { ok: false, error: '文件夹名不能带 \\ / : * ? " < > |' }, 400); return true }
    let pstat = null
    try { pstat = fs.statSync(parent) } catch { /* 不存在 */ }
    if (!pstat || !pstat.isDirectory()) { send(res, { ok: false, error: '父目录不存在' }, 400); return true }
    const target = path.join(parent, name)
    try {
      fs.mkdirSync(target)
    } catch (e) {
      if (e?.code !== 'EEXIST') { send(res, { ok: false, error: String(e?.message ?? e) }, 400); return true }
    }
    send(res, { ok: true, path: target })
    return true
  }

  return false
}
