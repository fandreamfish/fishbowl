import fs from 'node:fs'

// 客户端提示
{
  const p = 'packages/plugin/client.js'
  let t = fs.readFileSync(p, 'utf8')
  const anchor = "          err ? e('div', { className: 'fb-error', children: err }, 'err') : null,"
  const add = [
    anchor,
    "          (data && data.health && data.health.issues && data.health.issues.length)",
    "            ? e('div', { style: { ...box, borderColor: 'var(--dsw-alias-warning, #c90)', background: 'rgba(255,200,0,0.10)', fontSize: 12.5 }, children: [",
    "                e('div', { style: { fontWeight: 600, marginBottom: 4 }, children: 'fishbowl 配置可能不完整' }, 'hh'),",
    "                ...data.health.issues.map((x, i) => e('div', { key: 'h' + i, style: { marginTop: 2 }, children: '· ' + x })),",
    "                e('div', { style: { ...lab, fontSize: 11.5, marginTop: 6 }, children: '常见原因：DSH 设置页保存时重写了 profile 的 cordis.patch.yml，把 fishbowl 那段冲掉了。' }, 'hk'),",
    "              ] }, 'health')",
    "            : null,",
  ].join('\n')
  if (t.includes(anchor) && !t.includes("'health')")) t = t.replace(anchor, add)
  fs.writeFileSync(p, t)
  console.log('client health', t.includes("'health')"))
}
