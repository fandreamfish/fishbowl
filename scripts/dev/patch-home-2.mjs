import fs from 'node:fs'

// 1) 注入的数据目录改成 home
{
  const p = 'packages/app/src/turn.js'
  let t = fs.readFileSync(p, 'utf8')
  t = t.replace("import { ACTIVITY_RE, breachLine, mergePendingText, permitLine } from '../../being/src/index.ts'",
    "import { ACTIVITY_RE, breachLine, homeDir, mergePendingText, permitLine } from '../../being/src/index.ts'")
  t = t.replace("const dataDir = creature.store.dir", "const dataDir = homeDir(creature)")
  t = t.replace("'你的东西都在 ' + dataDir + '：日记（diary/）、小纸条（notes/）、记忆账本都在这个文件夹里。'",
    "'你的家当都在 ' + dataDir + '：日记（diary/）、小纸条（notes/）。这个文件夹是你的，想写什么、存什么都放这里；别的地方可以看，但不要改。'")
  fs.writeFileSync(p, t)
  console.log('turn', t.includes('homeDir(creature)'))
}

// 2) 搬入提示
{
  const p = 'packages/app/src/injector.js'
  let t = fs.readFileSync(p, 'utf8')
  t = t.replace("    `你自己的东西都在 ${dataDir}：日记（diary/）、小纸条（notes/）、记忆账本都在这个文件夹里。以后你想写下、创建、保存的任何东西都放到这个文件夹里，不要放到别处；房间只是你住的地方。`,",
    "    `你的家当都在 ${dataDir}：日记（diary/）、小纸条（notes/）。这个文件夹是你的，想写什么、存什么都放这里；别的地方可以看，但不要改。`,")
  fs.writeFileSync(p, t)
  console.log('injector', t.includes('这个文件夹是你的'))
}

// 3) 写保护：只允许改 home
{
  const p = 'packages/app/src/constraints.js'
  let t = fs.readFileSync(p, 'utf8')
  if (!t.includes('homeDir')) {
    t = t.replace("import { workspaceOfExec, sessionIdOf, toolNameOf } from './extract.js'", "import { workspaceOfExec, sessionIdOf, toolNameOf } from './extract.js'\nimport { homeDir } from '../../being/src/index.ts'")
  }
  const anchor = "        if (name === 'pwsh' || name === 'bash') {"
  const block = [
    "        // 她的家：只有 home/ 可以改，别的地方可以看",
    "        let home = ''",
    "        try {",
    "          const occ = typeof binding.occupantOf === 'function' ? binding.occupantOf({ sessionId: sid, workspace: ws }) : null",
    "          if (occ?.store?.dir) home = homeDir(occ).replace(/[\\\\/]+$/, '').toLowerCase()",
    "        } catch { home = '' }",
    "        if (home) {",
    "          let args = {}",
    "          try {",
    "            const raw = exec?.data?.arguments ?? exec?.data?.args ?? '{}'",
    "            args = typeof raw === 'string' ? JSON.parse(raw) : (raw || {})",
    "          } catch { args = {} }",
    "          const inside = (p) => {",
    "            const v = String(p ?? '').replace(/[\\\\/]+$/, '').toLowerCase()",
    "            return !!v && (v === home || v.startsWith(home + '\\\\') || v.startsWith(home + '/'))",
    "          }",
    "          if (['write', 'edit', 'apply_patch', 'multi_edit', 'notebook_edit'].includes(name)) {",
    "            const target = args.file_path ?? args.path",
    "            if (target && !inside(target)) return 'fishbowl: 只能改你自己的文件夹（' + home + '）；别的地方可以看，但不要改。'",
    "          }",
    "          if (name === 'pwsh' || name === 'bash') {",
    "            const cmd = String(args.command ?? '')",
    "            const writey = /(set-content|add-content|out-file|new-item|remove-item|copy-item|move-item|rename-item|mkdir|del\\s|rm\\s|>\\s)/i.test(cmd)",
    "            if (writey) {",
    "              const paths = cmd.match(/[a-z]:[\\\\/][^\\s'\\\"|;]+/gi) || []",
    "              if (paths.some((p) => !inside(p))) return 'fishbowl: 只能改你自己的文件夹（' + home + '）；别的地方可以看，但不要改。'",
    "            }",
    "          }",
    "        }",
    anchor,
  ].join('\n')
  if (!t.includes("只能改你自己的文件夹")) t = t.replace(anchor, block)
  fs.writeFileSync(p, t)
  console.log('constraints', t.includes('只能改你自己的文件夹'))
}
