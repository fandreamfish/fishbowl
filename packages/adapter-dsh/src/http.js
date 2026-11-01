/**
 * 设置页 HTTP 入口：只做路由分发。
 * 读模型在 views.js / views-memory.js，资源在 resources/*，配置读写在 settings.js。
 */
import { createDshHost } from './host.js'
import { createViews } from './views.js'
import { handleFish } from './resources/fish.js'
import { handleBrowse } from './resources/browse.js'
import { handleConfig } from './resources/config.js'
import { handleFs } from './resources/fs.js'
import { handleCleanup } from './resources/cleanup.js'

export { mergeUiConfig, saveUiConfig, seedChanged, uiConfigPath, validateMemoryConfig } from './settings.js'
export { pickCommentConfig, pickMemoryConfig, pickRoutineConfig } from '../../app/src/index.js'
export { summarizeEvent } from './views.js'
export { subjectOf, otherWriter, memoryDetail } from './views-memory.js'

const ROUTE = '/fishbowl-ui'

export function createUiRoute(ctx, cfg, binding, host, opts = {}) {
  host = host ?? createDshHost(ctx, cfg)
  if (typeof host.registerRoute !== 'function') return () => {}
  const stateDir = cfg.stateDir
  const views = createViews({ cfg, binding, host, stateDir })

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      req.on('error', reject)
    })
  }

  const send = (res, obj, code = 200) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(obj))
  }

  let dispose
  try {
    dispose = host.registerRoute({
      kind: 'prefix',
      path: ROUTE,
      handler: async (req, res) => {
        try {
          const url = new URL(req.url ?? '/', 'http://localhost')
          const sub = url.pathname.slice(ROUTE.length)
          const parts = sub.split('/').filter(Boolean)
          const rctx = { cfg, binding, host, stateDir, opts, views, send, readBody }

          if (await handleFish(rctx, req, res, parts)) return
          if (await handleBrowse(rctx, req, res, parts, sub)) return
          if (await handleConfig(rctx, req, res, parts, sub)) return
          if (await handleFs(rctx, req, res, parts, sub)) return
          if (await handleCleanup(rctx, req, res, parts)) return

          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.end('not found')
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.end(String(e?.message ?? e))
        }
      },
    })
  } catch {
    // 同一路由被另一个实例注册过（例如条目重复加载）：不影响功能，另一个实例会服务
    return () => {}
  }
  return typeof dispose === 'function' ? dispose : () => {}
}
