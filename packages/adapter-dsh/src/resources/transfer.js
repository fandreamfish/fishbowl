/**
 * 导出 / 导入：把鱼搬到另一台电脑。
 *
 * 约定：
 *   - `cfg.stateDir` 就是 creatures 目录（默认 ~/.fishbowl/creatures）
 *   - 导出：<目标目录>/fishbowl-export-<时间>-<随机>/ 下放 manifest.json + creatures/<id>/…
 *   - 导入（幂等）：
 *       1. 确保 ~/.fishbowl 与 creatures 目录存在
 *       2. 已存在的鱼只补缺失文件，不覆盖账本、不重复追加事件
 *       3. 住处失效（旧机器的会话）就清空
 *       4. 在「大肥鱼的屋子」里给没住处的鱼各建一间房；已有房间的不动
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { injectMessage, moveInText } from '../../../app/src/index.js'
import { homeDir } from '../../../being/src/index.ts'

const SKIP = new Set(['.writer.lock', 'projection.json', 'snapshot.json', 'cache.json'])

function copyDir(src, dst, onlyMissing) {
  fs.mkdirSync(dst, { recursive: true })
  let copied = 0
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue
    const s = path.join(src, e.name)
    const d = path.join(dst, e.name)
    if (e.isDirectory()) { copied += copyDir(s, d, onlyMissing); continue }
    if (!e.isFile()) continue
    if (onlyMissing && fs.existsSync(d)) continue
    if (!fs.existsSync(d)) { fs.copyFileSync(s, d); copied += 1 }
  }
  return copied
}

function stamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

export async function handleTransfer({ cfg, binding, host, send, readBody }, req, res, parts) {
  const creaturesRoot = cfg.stateDir
  const homeRoot = cfg.dataRoot || path.dirname(path.resolve(creaturesRoot))

  // —— 导出 ——
  if (parts[0] === 'export' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req) || '{}')
    const destRoot = String(body.path ?? '').trim()
    if (!destRoot || !fs.existsSync(destRoot) || !fs.statSync(destRoot).isDirectory()) {
      send(res, { ok: false, error: '先选一个已存在的目录' }, 400); return true
    }
    const outDir = path.join(destRoot, `fishbowl-export-${stamp()}-${randomUUID().slice(0, 4)}`)
    try {
      fs.mkdirSync(path.join(outDir, 'creatures'), { recursive: true })
      const manifest = { version: 1, exportedAt: Date.now(), creatures: [] }
      for (const c of binding.listCreatures()) {
        const src = c.store.dir
        if (!fs.existsSync(src)) continue
        copyDir(src, path.join(outDir, 'creatures', c.meta.creatureId), false)
        manifest.creatures.push({ id: c.meta.creatureId, name: c.meta.name, bornAt: c.meta.bornAt })
      }
      fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
      send(res, { ok: true, dir: outDir, count: manifest.creatures.length })
    } catch (e) {
      send(res, { ok: false, error: String(e?.message ?? e) }, 500)
    }
    return true
  }

  // —— 导入 ——
  if (parts[0] === 'import' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req) || '{}')
    const srcDir = String(body.path ?? '').trim()
    const manifestPath = path.join(srcDir, 'manifest.json')
    if (!srcDir || !fs.existsSync(manifestPath)) {
      send(res, { ok: false, error: '这个目录里没有 manifest.json（不是导出的包）' }, 400); return true
    }
    let manifest
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) } catch (e) {
      send(res, { ok: false, error: 'manifest.json 读不了：' + String(e?.message ?? e) }, 400); return true
    }

    try {
      // 1) 用户目录下的 .fishbowl 与 creatures 目录：不存在就建
      fs.mkdirSync(path.join(os.homedir(), '.fishbowl'), { recursive: true })
      fs.mkdirSync(creaturesRoot, { recursive: true })

      // 2) 逐条导入
      const imported = []
      for (const item of manifest.creatures ?? []) {
        const id = String(item.id ?? '')
        if (!id || !/^[A-Za-z0-9._-]+$/.test(id)) continue
        const src = path.join(srcDir, 'creatures', id)
        const dst = path.join(creaturesRoot, id)
        if (!fs.existsSync(src)) continue
        const existed = fs.existsSync(path.join(dst, 'meta.json'))
        const copied = copyDir(src, dst, existed)
        const metaPath = path.join(dst, 'meta.json')
        if (!fs.existsSync(metaPath)) {
          fs.writeFileSync(metaPath, JSON.stringify({
            schemaVersion: 1,
            creatureId: id,
            name: String(item.name ?? '鱼'),
            bornAt: String(item.bornAt ?? new Date().toISOString()),
            timezone: 'Asia/Shanghai',
            occupancy: null,
          }, null, 2), 'utf8')
        }
        imported.push({ id, existed, copied })
      }

      // 3) 住处校验：旧机器上的会话在这台机器上不存在 → 清空（只对本次导入的鱼）
      const ids = new Set((manifest.creatures ?? []).map((x) => String(x.id)))
      const liveSessions = new Set((host.listScopes?.()?.sessions ?? []).map((s) => String(s.id)))
      for (const c of binding.listCreatures()) {
        if (!ids.has(c.meta.creatureId)) continue
        const occ = c.meta.occupancy
        if (occ?.kind === 'session' && !liveSessions.has(String(occ.id))) {
          try { c.setOccupancy(null) } catch { /* 忽略 */ }
        }
      }

      // 4) 「大肥鱼的屋子」：一个工作区，所有没住处的鱼各建一间房
      const housePath = path.join(homeRoot, 'home', '大肥鱼的屋子')
      fs.mkdirSync(housePath, { recursive: true })
      if (!host.workspaceByPath?.(housePath)) {
        try { await host.createWorkspace?.(housePath) } catch { /* 可能已注册 */ }
      }

      const housed = []
      const skipped = []
      for (const c of binding.listCreatures()) {
        if (!ids.has(c.meta.creatureId)) continue
        if (c.meta.occupancy?.kind === 'session') { skipped.push({ id: c.meta.creatureId, reason: '已有房间' }); continue }
        try {
          const s = await host.createSession?.({ path: housePath, title: `${c.meta.name}的房间` })
          if (!s?.id) throw new Error('会话没建出来')
          const occ = { kind: 'session', id: s.id, workspace: s.workspace || housePath }
          c.setOccupancy(occ)
          const agent = host.agentFor?.(s.id)
          if (agent) {
            try {
              await host.wake(agent, injectMessage(moveInText({ name: c.meta.name, occupancy: occ, dataDir: homeDir(c) }), { mode: 'self', reason: null }))
            } catch { /* 唤醒失败不影响入住 */ }
          }
          housed.push({ id: c.meta.creatureId, name: c.meta.name, sessionId: s.id })
        } catch (e) {
          skipped.push({ id: c.meta.creatureId, reason: String(e?.message ?? e) })
        }
      }

      send(res, { ok: true, house: housePath, imported, housed, skipped })
    } catch (e) {
      send(res, { ok: false, error: String(e?.message ?? e) }, 500)
    }
    return true
  }

  return false
}
