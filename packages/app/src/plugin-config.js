/**
 * 插件级配置的本地快照：dataRoot/config.json。
 *
 * DSH 设置页保存时会重写 profile 的 cordis.patch.yml，fishbowl 那一段被冲掉过两次。
 * 这里把"上次启动时真正生效的配置"记一份，下次启动先读它，再让 profile 覆盖。
 * 不存 apiKey（密钥只留在 profile / 环境里），避免多一个明文副本。
 */
import fs from 'node:fs'
import path from 'node:path'

export function pluginConfigPath(dataRoot) {
  return path.join(dataRoot, 'config.json')
}

function stripSecrets(cfg) {
  const out = { ...(cfg || {}) }
  if (out.appraiser && typeof out.appraiser === 'object') {
    out.appraiser = { ...out.appraiser }
    delete out.appraiser.apiKey
  }
  return out
}

export function readPluginConfig(dataRoot) {
  try {
    const v = JSON.parse(fs.readFileSync(pluginConfigPath(dataRoot), 'utf8'))
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}

export function savePluginConfig(dataRoot, cfg) {
  try {
    fs.mkdirSync(dataRoot, { recursive: true })
    fs.writeFileSync(pluginConfigPath(dataRoot), JSON.stringify(stripSecrets(cfg), null, 2), 'utf8')
    return true
  } catch {
    return false
  }
}
