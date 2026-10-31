/** 本地激活冒烟：模拟宿主 ctx，跑一遍 apply()，看会不会抛错。 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { apply } from '../../packages/plugin/index.js'

const dir = path.join(os.tmpdir(), 'fishbowl-apply-smoke-' + Date.now())
fs.mkdirSync(dir, { recursive: true })

const disposers: any[] = []
const ctx: any = {
  on: () => () => {},
  effect: (fn: any) => { const d = fn(); return () => { try { d?.() } catch {} } },
  tools: { guard: () => () => {}, },
  agents: {},
  get: () => null,
  systemPrompt: { section: () => () => {} },
}

try {
  const off = apply(ctx, { stateDir: dir, appraiser: { kind: 'scripted' }, growth: 1 })
  console.log('apply() 成功，返回 disposer:', typeof off)
  if (typeof off === 'function') off()
  console.log('dispose 成功')
} catch (err) {
  console.error('apply() 抛错：', err && err.stack ? err.stack : err)
  process.exit(1)
}
