import fs from 'node:fs'
const p = 'packages/app/src/constraints.js'
let t = fs.readFileSync(p, 'utf8')
const old = [
  "          if (name === 'pwsh' || name === 'bash') {",
  "            const cmd = String(args.command ?? '')",
  "            const writey = /(set-content|add-content|out-file|new-item|remove-item|copy-item|move-item|rename-item|mkdir|del\\s|rm\\s|>\\s)/i.test(cmd)",
  "            if (writey) {",
  "              const paths = cmd.match(/[a-z]:[\\\\/][^\\s'\\\"|;]+/gi) || []",
  "              if (paths.some((p) => !inside(p))) return 'fishbowl: 只能改你自己的文件夹（' + home + '）；别的地方可以看，但不要改。'",
  "            }",
  "          }",
].join('\n')
const neu = [
  "          if (name === 'pwsh' || name === 'bash') {",
  "            const cmd = String(args.command ?? '')",
  "            const writey = /(set-content|add-content|out-file|new-item|remove-item|copy-item|move-item|rename-item|mkdir|del\\s|rm\\s|>\\s)/i.test(cmd)",
  "            if (writey) {",
  "              // 相对路径写不出来（cwd 在房间里）：要么写 home 的绝对路径，要么别写",
  "              if (!cmd.toLowerCase().includes(home)) return 'fishbowl: 写文件请用你自己文件夹里的绝对路径（' + home + '）；别的地方可以看，但不要改。'",
  "              const paths = cmd.match(/[a-z]:[\\\\/][^\\s'\\\"|;]+/gi) || []",
  "              if (paths.some((p) => !inside(p))) return 'fishbowl: 只能改你自己的文件夹（' + home + '）；别的地方可以看，但不要改。'",
  "            }",
  "          }",
].join('\n')
if (!t.includes('相对路径写不出来')) t = t.replace(old, neu)
fs.writeFileSync(p, t)
console.log('patched', t.includes('相对路径写不出来'))
