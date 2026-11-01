import fs from 'node:fs'

// 1) 许可工具：增加 browse 动作
{
  const p = 'packages/plugin/lib/browse/permission-tool.js'
  let t = fs.readFileSync(p, 'utf8')
  t = t.replace("const ACTIONS = {\n  'comment.post': { label: '在 B 站说一句话', uses: 1, ttlMs: 2 * 60 * 60_000 },\n}",
    "const ACTIONS = {\n  'comment.post': { label: '在 B 站说一句话', uses: 1, ttlMs: 2 * 60 * 60_000, gate: 'comment' },\n  'browse': { label: '看一次 B 站', uses: 1, ttlMs: 2 * 60 * 60_000, gate: 'browse' },\n}")
  t = t.replace("      + '有些事得先问过他才能做。现在能申请的是\"在 B 站说一句话\"：'\n      + '如果你今天看过某个视频、想说一句，但还没有得到允许，就用这个工具申请。'\n      + '申请之后等他的回答；他不点，你就先不做。',",
    "      + '有些事得先问过他才能做。现在能申请两件：browse=看一次 B 站；comment.post=在 B 站说一句话。'\n      + '他说过\"需要申请\"的事，先用这个工具问一声；申请之后等他的回答，他不点头你就先不做。',")
  t = t.replace("        if (fcfg.comment?.enabled !== true) {\n          return { ok: false, note: '现在还不能在外面说话（他没开这个口子）。' }\n        }\n        if (fcfg.comment?.autoApprove === true) {\n          return { ok: true, note: '他之前说过这类事不用每次问，直接说就行。' }\n        }",
    "        if (spec.gate === 'comment' && fcfg.comment?.enabled !== true) {\n          return { ok: false, note: '现在还不能在外面说话（他没开这个口子）。' }\n        }\n        if (spec.gate === 'browse' && fcfg.browse?.enabled !== true) {\n          return { ok: false, note: '现在打不开 B 站（他没开这个口子）。' }\n        }\n        if (spec.gate === 'comment' && fcfg.comment?.autoApprove === true) {\n          return { ok: true, note: '他之前说过这类事不用每次问，直接说就行。' }\n        }")
  fs.writeFileSync(p, t)
  console.log('permission-tool patched')
}

// 2) 看 B 站的工具：如果他的许可写着"需要申请"，没有许可就记 breach（不拦）
{
  const p = 'packages/plugin/lib/browse/tool.js'
  let t = fs.readFileSync(p, 'utf8')
  t = t.replace("import { configFor } from '../../../app/src/index.js'",
    "import { configFor } from '../../../app/src/index.js'\nimport { activeGrants, consumePermit, findPermit, recordBreach } from '../../../being/src/index.ts'")
  const anchor = "        const r = await lookForCreature(creature, configFor(cfg, creature), {"
  const add = [
    "        // 他说过\"需要申请\"：没许可也让她看，但会被记下来（约定，不是围墙）",
    "        const grants = activeGrants(creature, 'browse')",
    "        const needsAsk = grants.some((g) => /申请/.test(String(g.text ?? '')))",
    "        let browsePermit = null",
    "        if (needsAsk) {",
    "          browsePermit = findPermit(creature, 'browse', '')",
    "          if (browsePermit) consumePermit(creature, browsePermit)",
    "        }",
    anchor,
  ].join('\n')
  t = t.replace(anchor, add)
  // 成功看到之后：需要申请但没许可 → breach
  t = t.replace("        return { ok: !!r.ok, text: String(r.text ?? ''), note: String(r.note ?? '') }",
    "        if (r.ok && needsAsk && !browsePermit) recordBreach(creature, { action: 'browse', target: String(what), detail: '没等他同意就看了' })\n        return { ok: !!r.ok, text: String(r.text ?? ''), note: String(r.note ?? '') }")
  fs.writeFileSync(p, t)
  console.log('browse-tool patched')
}
