/**
 * 风控的「落盘」那一半：进程重启后仍然记得被锁过。
 *
 * 内存里的冷却在 client.js（60 秒起，防同一轮重试）；这里的是持久罚则：
 * 第一次 10 分钟，重复 30 / 60 / 120 分钟。只认 B 站亲自回的 -352/-412/-509，
 * 不把自己的 COOLDOWN 当证据——否则一次小磕碰会自我加码。
 */
import fs from 'node:fs'
import path from 'node:path'
import { RISK_CODES } from './browse.ts'

export const RISK_FILE = 'browse-risk.json'
export const STRIKES_MIN = [10, 30, 60, 120]

export function riskPath(stateDir) {
  return path.join(stateDir, RISK_FILE)
}

export function isRiskCode(code) {
  return RISK_CODES.has(Number(code))
}

export function readRisk(stateDir) {
  try {
    const r = JSON.parse(fs.readFileSync(riskPath(stateDir), 'utf8'))
    if (!r || typeof r !== 'object') throw new Error('bad')
    return {
      until: Number(r.until) || 0,
      code: String(r.code ?? ''),
      at: String(r.at ?? ''),
      strikes: Math.max(0, Number(r.strikes) || 0),
    }
  } catch {
    return { until: 0, code: '', at: '', strikes: 0 }
  }
}

export function writeRisk(stateDir, state) {
  try {
    fs.mkdirSync(stateDir, { recursive: true })
    fs.writeFileSync(riskPath(stateDir), JSON.stringify(state, null, 2))
  } catch { /* 写不进去也不该让她今天不能说话 */ }
  return state
}

/** 记一次撞墙，返回新状态。 */
export function noteRisk(stateDir, code, now = Date.now()) {
  const prev = readRisk(stateDir)
  const strikes = Math.min(STRIKES_MIN.length, prev.strikes + 1)
  const min = STRIKES_MIN[strikes - 1] ?? STRIKES_MIN[STRIKES_MIN.length - 1]
  return writeRisk(stateDir, {
    until: now + min * 60_000,
    code: String(code ?? ''),
    at: new Date(now).toISOString(),
    strikes,
  })
}

export function clearRisk(stateDir) {
  return writeRisk(stateDir, { until: 0, code: '', at: '', strikes: 0 })
}

/**
 * 一次成功就说明恢复了：清掉连击，下次再撞墙从 10 分钟重新算。
 * 冷却没结束时不提前清（那是还没恢复）。
 */
export function markRiskOk(stateDir, now = Date.now()) {
  const r = readRisk(stateDir)
  if (r.strikes && now >= r.until) {
    return writeRisk(stateDir, { until: 0, code: '', at: '', strikes: 0 })
  }
  return r
}

/** 现在能不能碰 B 站。 */
export function riskState(stateDir, now = Date.now()) {
  const r = readRisk(stateDir)
  const remainMs = r.until - now
  return {
    cooling: remainMs > 0,
    remainMin: remainMs > 0 ? Math.ceil(remainMs / 60_000) : 0,
    code: r.code,
    strikes: r.strikes,
    until: r.until,
  }
}
