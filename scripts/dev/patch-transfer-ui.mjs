import fs from 'node:fs'

const p = 'packages/plugin/client.js'
let t = fs.readFileSync(p, 'utf8')

// 1) 状态
if (!t.includes('const [xf, setXf] = useState(null)')) {
  t = t.replace("      const [cleanOpen, setCleanOpen] = useState(false)", "      const [cleanOpen, setCleanOpen] = useState(false)\n      const [xf, setXf] = useState(null)")
}

// 2) 按钮：导出 / 导入
if (!t.includes("'exportbtn'")) {
  const anchor = "            }, 'cleanup'),"
  const add = [
    anchor,
    "            e('button', { style: { ...btnS, padding: '7px 14px', marginLeft: 8 }, onClick: () => setXf({ mode: 'export', start: '' }), children: '导出' }, 'exportbtn'),",
    "            e('button', { style: { ...btnS, padding: '7px 14px', marginLeft: 8 }, onClick: () => setXf({ mode: 'import', start: '' }), children: '导入' }, 'importbtn'),",
  ].join('\n')
  t = t.replace(anchor, add)
}

// 3) 复用文件夹选择器
if (!t.includes("xf.mode === 'export'")) {
  const anchor = "          fp ? e(FolderPicker, { start: fp.start, onPick: (p) => setNewHouse({ ...newHouse, path: p }), onClose: () => setFp(null) }, 'fp') : null,"
  const add = [
    anchor,
    "          xf ? e(FolderPicker, {",
    "            start: xf.start,",
    "            onPick: async (dir) => {",
    "              try {",
    "                if (xf.mode === 'export') {",
    "                  const r = await postJson(API + '/export', { path: dir })",
    "                  window.alert('导出到：' + r.dir + '（' + r.count + ' 条鱼）')",
    "                } else {",
    "                  const r = await postJson(API + '/import', { path: dir })",
    "                  await load()",
    "                  window.alert('导入 ' + (r.housed || []).length + ' 条鱼\\n屋子：' + r.house)",
    "                }",
    "              } catch (x) { window.alert('失败：' + String((x && x.message) || x)) }",
    "            },",
    "            onClose: () => setXf(null),",
    "          }, 'xf') : null,",
  ].join('\n')
  t = t.replace(anchor, add)
}

fs.writeFileSync(p, t)
console.log('client patched', t.includes("'exportbtn'"), t.includes("xf.mode === 'export'"))
