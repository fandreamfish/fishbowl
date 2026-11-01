import fs from 'node:fs'

// 1) 配置自检
{
  const p = 'packages/app/src/config.js'
  let t = fs.readFileSync(p, 'utf8')
  if (!t.includes('export function configHealth')) {
    t += [
      '',
      '/**',
      ' * 配置自检：DSH 设置页重写 profile patch 时可能把 fishbowl 的配置整段冲掉，',
      ' * 表现就是"没有记忆、没有总结、情绪变笨"。这里只报告，不改配置。',
      ' */',
      'export function configHealth(cfg) {',
      '  const issues = []',
      "  if (cfg?.appraiser?.kind !== 'deepseek') issues.push('appraiser 不是 deepseek：没有 LLM 评价，记忆总结也不会跑')",
      '  if (cfg?.appraiser?.kind === \'deepseek\' && !cfg?.appraiser?.apiKey) issues.push(\'appraiser.apiKey 为空：调用会失败\')',
      '  if (!cfg?.wake?.enabled && !cfg?.selfTime?.enabled) issues.push(\'清醒节律与自处都关着：她不会主动醒来\')',
      '  return { ok: issues.length === 0, issues }',
      '}',
      '',
    ].join('\n')
  }
  fs.writeFileSync(p, t)
  console.log('config health', t.includes('configHealth'))
}

// 2) 状态视图带上自检
{
  const p = 'packages/adapter-dsh/src/views.js'
  let t = fs.readFileSync(p, 'utf8')
  t = t.replace("import { fishConfigView, hasFishConfig } from '../../app/src/fishcfg.js'", "import { fishConfigView, hasFishConfig } from '../../app/src/fishcfg.js'\nimport { configHealth } from '../../app/src/config.js'")
  t = t.replace("    return {\n      born: fish.some((f) => f.episodes > 0),", "    return {\n      born: fish.some((f) => f.episodes > 0),\n      health: configHealth(cfg),")
  fs.writeFileSync(p, t)
  console.log('views health', t.includes('health: configHealth(cfg)'))
}
