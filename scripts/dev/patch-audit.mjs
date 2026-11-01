import fs from 'node:fs'

// views: 事件摘要
{
  const p = 'packages/adapter-dsh/src/views.js'
  let t = fs.readFileSync(p, 'utf8')
  if (!t.includes("case 'permit'")) {
    t = t.replace("    case 'grant': return { text: e.text, meta: e.allowed ? `允许：${e.topic}` : `撤销：${e.topic}` }",
      "    case 'grant': return { text: e.text, meta: e.allowed ? `允许：${e.topic}` : `撤销：${e.topic}` }\n" +
      "    case 'permit': return { text: `被允许：${e.action ?? ''}${e.target ? ' @ ' + e.target : ''}`, meta: `${e.uses ?? 1} 次` }\n" +
      "    case 'permit-used': return { text: '用掉一次许可', meta: String(e.ref ?? '').slice(0, 8) }\n" +
      "    case 'breach': return { text: `没等同意就做了：${e.action ?? ''}`, meta: String(e.target ?? '').slice(0, 24) }")
  }
  fs.writeFileSync(p, t)
  console.log('views', t.includes("case 'permit'"))
}

// constraints: 硬地板
{
  const p = 'packages/app/src/constraints.js'
  let t = fs.readFileSync(p, 'utf8')
  if (!t.includes('FLOOR')) {
    const anchor = '        const ws = workspaceOfExec(exec)'
    const block = [
      anchor,
      '        // 硬地板（很窄）：系统级破坏性命令一律不代她执行。不是安全边界，是保险丝。',
      "        if (name === 'pwsh' || name === 'bash') {",
      "          let cmd = ''",
      '          try {',
      '            const raw = exec?.data?.arguments ?? exec?.data?.args ?? ""',
      "            const o = typeof raw === 'string' ? JSON.parse(raw) : raw",
      "            cmd = String(o?.command ?? raw ?? '')",
      "          } catch { cmd = String(exec?.data?.arguments ?? '') }",
      "          const FLOOR = /(?:^|[^\\w-])(format|diskpart|shutdown|restart-computer|stop-computer|vssadmin)(?:\\s|$)/i",
      "          const ROOT_DEL = /remove-item\\s+['\"]?[a-z]:[\\\\/]['\"]?[^\\n]*-recurse|remove-item\\s+['\"]?(?:[a-z]:)?[\\\\/](windows|users|program files)[\\\\/]/i",
      '          if (FLOOR.test(cmd) || ROOT_DEL.test(cmd)) {',
      "            return 'fishbowl: 这条命令会动到房间之外的东西（系统或别的目录），我不替你执行。'",
      '          }',
      '        }',
    ].join('\n')
    t = t.replace(anchor, block)
  }
  fs.writeFileSync(p, t)
  console.log('constraints', t.includes('FLOOR'))
}
