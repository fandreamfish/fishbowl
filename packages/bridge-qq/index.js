/**
 * fishbowl QQ 桥接（M3.3）：
 *   与 DSH 插件共享同一份 creatures 状态（同一 bindings.json），
 *   单写者锁保证同一时刻只有一方在写。
 *
 * 运行：node packages/bridge-qq/index.js --config <config.json>
 * 注意：OneBot 实现（如 NapCat）走非官方协议，有封号风险；官方开放平台更稳但主动私聊受限。
 */
import fs from 'node:fs'
import path from 'node:path'
import { createBinding } from '../app/src/binding.js'
import { normalizeConfig } from '../app/src/config.js'
import { OneBot, parseMessageEvent } from './lib/onebot.js'
import { reply } from './lib/pipeline.js'

async function main() {
  const args = process.argv.slice(2)
  const cfgPath = args.includes('--config')
    ? args[args.indexOf('--config') + 1]
    : path.join(process.cwd(), 'packages', 'bridge-qq', 'config.example.json')
  const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
  const cfg = normalizeConfig(raw)

  // 单写者锁：与 DSH 插件互斥（同目录写者同一时刻只有一个）
  const lockPath = path.join(cfg.stateDir, '.qq-bridge.lock')
  fs.mkdirSync(cfg.stateDir, { recursive: true })
  let lockFd
  try {
    lockFd = fs.openSync(lockPath, 'wx')
    fs.writeSync(lockFd, `${process.pid}\n`)
  } catch {
    console.error(`[bridge-qq] 锁被占用：${lockPath}。已有写者（DSH 插件或另一个桥）在运行。`)
    process.exit(1)
  }
  const release = () => {
    try { fs.closeSync(lockFd) } catch { /* 忽略 */ }
    try { fs.rmSync(lockPath, { force: true }) } catch { /* 忽略 */ }
  }
  process.on('exit', release)
  process.on('SIGINT', () => process.exit(0))

  const binding = createBinding(cfg)
  const bot = new OneBot(raw.onebot ?? { wsUrl: 'ws://127.0.0.1:3001', httpUrl: 'http://127.0.0.1:3000' })
  const selfId = String(raw.onebot?.selfId ?? '')

  await bot.connect((ev) => {
    void (async () => {
      try {
        const msg = parseMessageEvent(ev, selfId)
        if (!msg || msg.to === '') return
        const register = msg.isGroup ? 'public' : 'intimate'
        const creature = binding.creatureFor(`qq-${msg.to}`)
        const text = await reply({ cfg, creature, userText: msg.text, register })
        if (!text) return
        if (msg.isGroup) await bot.sendGroup(msg.to, text)
        else await bot.sendPrivate(msg.to, text)
      } catch (err) {
        console.error('[bridge-qq] 处理失败：', String(err?.message ?? err))
      }
    })()
  })

  console.log('[bridge-qq] 已连接。个体状态目录：', cfg.stateDir)
}

main().catch((err) => {
  console.error('[bridge-qq] 启动失败：', err)
  process.exit(1)
})
