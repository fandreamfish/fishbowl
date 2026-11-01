/**
 * 单写者锁（docs/MEMORY.md §6.2 第 5 条）。
 * 一只鱼同一时刻只该有一个进程在写——双写会让一个人变成两个。
 *
 * 语义是「检测 + 报告」，不是「拒绝启动」：
 * 抢不到锁时默认继续写（丢对话比双写更糟），但状态会暴露给上层去告警。
 * 需要硬拦的调用方传 mode:'strict'。
 */
import fs from 'node:fs'
import path from 'node:path'

export interface LockHolder { pid: number; at: number }
export interface LockStatus { ok: boolean; holder?: LockHolder; stale?: boolean; reason?: string }

const DEFAULT_STALE_MS = 120_000
const HEARTBEAT_MS = 30_000

function alive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  if (pid === process.pid) return true
  try {
    process.kill(pid, 0)
    return true
  } catch (e: any) {
    // EPERM = 进程存在但没权限；ESRCH = 不存在
    return e?.code === 'EPERM'
  }
}

export function lockPathFor(dir: string): string {
  return path.join(dir, '.writer.lock')
}

function release(file: string): void {
  try {
    const cur = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (Number(cur?.pid) === process.pid) fs.rmSync(file, { force: true })
  } catch {
    // 已经被别人清掉了
  }
}

/**
 * 拿写锁。返回的 release 只在确实持有它时才真的删文件。
 */
export function acquireWriterLock(dir: string, opts: { staleMs?: number; now?: number } = {}): {
  status: LockStatus
  release: () => void
} {
  const file = lockPathFor(dir)
  const now = opts.now ?? Date.now()
  const me: LockHolder = { pid: process.pid, at: now }

  try {
    fs.writeFileSync(file, JSON.stringify(me), { flag: 'wx' })
    return { status: { ok: true }, release: () => release(file) }
  } catch (e: any) {
    if (e?.code !== 'EEXIST') return { status: { ok: false, reason: String(e?.code || e) }, release: () => {} }
  }

  let cur: LockHolder | null = null
  try {
    cur = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    cur = null
  }

  const holderPid = Number(cur?.pid)
  const age = now - Number(cur?.at ?? 0)
  const stale = !cur || !alive(holderPid) || age > (opts.staleMs ?? DEFAULT_STALE_MS)

  if (stale) {
    try {
      fs.writeFileSync(file, JSON.stringify(me))
      return { status: { ok: true, stale: true }, release: () => release(file) }
    } catch (e: any) {
      return { status: { ok: false, reason: String(e?.code || e) }, release: () => {} }
    }
  }

  return { status: { ok: false, holder: { pid: holderPid, at: Number(cur?.at ?? 0) } }, release: () => {} }
}

/** 持锁期间定期刷新 at：进程被系统换用同一 pid（如 conhost）时不会误判。 */
function hold(file: string): () => void {
  const timer = setInterval(() => {
    try {
      const cur = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (Number(cur?.pid) !== process.pid) return
      fs.writeFileSync(file, JSON.stringify({ pid: process.pid, at: Date.now() }))
    } catch { /* 锁没了就算了 */ }
  }, HEARTBEAT_MS)
  ;(timer as any).unref?.()
  return () => { clearInterval(timer); release(file) }
}

/** 读锁状态（给"另一进程在写"的告警用）：认 pid 存活 + 心跳新鲜度。 */
export function readWriterLock(dir: string, opts: { staleMs?: number; now?: number } = {}): LockStatus {
  const file = lockPathFor(dir)
  let cur: LockHolder | null = null
  try { cur = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return { ok: true } }
  const pid = Number(cur?.pid)
  if (pid === process.pid) return { ok: true }
  const age = (opts.now ?? Date.now()) - Number(cur?.at ?? 0)
  const stale = !alive(pid) || age > (opts.staleMs ?? DEFAULT_STALE_MS)
  if (stale) return { ok: true, stale: true, holder: { pid, at: Number(cur?.at ?? 0) }, reason: 'stale' }
  return { ok: false, holder: { pid, at: Number(cur?.at ?? 0) } }
}