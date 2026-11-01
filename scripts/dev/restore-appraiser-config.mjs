import fs from 'node:fs'

const secrets = fs.readFileSync('docs/SECRETS.local.md', 'utf8')
const key = (secrets.match(/sk-[A-Za-z0-9]+/) || [])[0]
if (!key) { console.log('no key'); process.exit(1) }

const p = 'C:/Users/24358/.dsh/profiles/desktop/cordis.patch.yml'
let t = fs.readFileSync(p, 'utf8')
if (!/-\s*id:\s*fishbowl/.test(t)) {
  if (!t.endsWith('\n')) t += '\n'
  t += [
    '- id: fishbowl',
    '  config:',
    '    appraiser:',
    '      kind: deepseek',
    '      apiKey: ' + key,
    '    relation:',
    '      kind: companion',
    '',
  ].join('\n')
  fs.writeFileSync(p, t)
  console.log('added fishbowl entry')
} else {
  console.log('fishbowl entry already present')
}
