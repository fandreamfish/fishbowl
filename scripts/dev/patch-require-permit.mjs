import fs from 'node:fs'

// 看 B 站：requirePermit 硬拦截
{
  const p = 'packages/plugin/lib/browse/tool.js'
  let t = fs.readFileSync(p, 'utf8')
  const old = [
    "        // 他说过\"需要申请\"：没许可也让她看，但会被记下来（约定，不是围墙）",
    "        const grants = activeGrants(creature, 'browse')",
    "        const needsAsk = grants.some((g) => /申请/.test(String(g.text ?? '')))",
    "        let browsePermit = null",
    "        if (needsAsk) {",
    "          browsePermit = findPermit(creature, 'browse', '')",
    "          if (browsePermit) consumePermit(creature, browsePermit)",
    "        }",
  ].join('\n')
  const neu = [
    "        // 需要许可时硬拦：没有许可就返回「需要许可才能调用」",
    "        let browsePermit = null",
    "        const requirePermit = fcfg.browse?.requirePermit === true",
    "        if (requirePermit) {",
    "          browsePermit = findPermit(creature, 'browse', '')",
    "          if (!browsePermit) return { ok: false, text: '', note: '需要许可才能调用：先用 fish_ask_permission(action=browse) 问他。' }",
    "          consumePermit(creature, browsePermit)",
    "        }",
    "        // 没有强制开关、但他说过「需要申请」：没许可也让她看，只记一笔",
    "        const grants = activeGrants(creature, 'browse')",
    "        const needsAsk = !requirePermit && grants.some((g) => /申请/.test(String(g.text ?? '')))",
    "        if (needsAsk) {",
    "          browsePermit = findPermit(creature, 'browse', '')",
    "          if (browsePermit) consumePermit(creature, browsePermit)",
    "        }",
  ].join('\n')
  if (t.includes(old)) t = t.replace(old, neu)
  fs.writeFileSync(p, t)
  console.log('browse tool', t.includes('需要许可才能调用'))
}

// 说话：requirePermit 硬拦截
{
  const p = 'packages/plugin/lib/browse/speak-tool.js'
  let t = fs.readFileSync(p, 'utf8')
  const old = [
    "        // 约定，不是围墙：没有许可也让她说，但要被看见（审计）",
    "        const fcfg = configFor(cfg, creature)",
    "        const target = String(args?.bvid ?? '')",
    "        const permit = fcfg.comment?.autoApprove === true ? null : findPermit(creature, 'comment.post', target)",
    "        if (permit) consumePermit(creature, permit)",
  ].join('\n')
  const neu = [
    "        const fcfg = configFor(cfg, creature)",
    "        const target = String(args?.bvid ?? '')",
    "        const permit = fcfg.comment?.autoApprove === true ? null : findPermit(creature, 'comment.post', target)",
    "        if (fcfg.comment?.requirePermit === true && fcfg.comment?.autoApprove !== true && !permit) {",
    "          return { ok: false, said: '', note: '需要许可才能调用：先用 fish_ask_permission(action=comment.post) 问他。' }",
    "        }",
    "        if (permit) consumePermit(creature, permit)",
  ].join('\n')
  if (t.includes(old)) t = t.replace(old, neu)
  fs.writeFileSync(p, t)
  console.log('speak tool', t.includes('需要许可才能调用'))
}
