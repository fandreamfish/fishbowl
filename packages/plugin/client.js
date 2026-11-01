/**
 * fishbowl 设置页（client half，M7）
 * 结构：鱼列表（卡片） → 单条鱼（页内分页：状态 / 住处 / 日记 / 小纸条 / 请求 / 人设）
 * 数据来自同源路由 /fishbowl-ui/*（宿主插件注册）。
 */
function makeFactory() {
  return (require) => {
    const module = { exports: {} }
    const react = require('react')
    const { useState, useEffect, useCallback } = react
    const jsx = require('react/jsx-runtime').jsx

    /** 自动 runtime 的 jsx(type, props, key)：key 走第三参数，children 放 props。 */
    const e = (type, props, key) => (key === undefined ? jsx(type, props) : jsx(type, props, key))

    const API = '/fishbowl-ui'
    const CSS_TAG = 'fishbowl/section.css'
    const CSS = [
      '.fb{color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.7;display:flex;flex-direction:column;gap:12px}',
      '.fb .fb-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}',
      '.fb .fb-title{font-size:18px;font-weight:600;line-height:1.3;letter-spacing:-.01em}',
      '.fb .fb-sub{font-size:12.5px;line-height:1.65;color:var(--dsw-alias-label-tertiary);margin:0}',
      '.fb .fb-tabs{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:5px;border:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28));border-radius:10px;background:rgba(128,128,128,.06)}',
      '.fb .fb-page{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:12px;align-items:start}',
      '.fb .fb-page>div{min-width:0}',
      '.fb .fb-tab{height:30px;padding:0 12px;border:.5px solid transparent;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary,#666);font:inherit;font-size:12.5px;cursor:pointer;transition:background .15s,color .15s}',
      '.fb .fb-tab:hover{color:var(--dsw-alias-label-primary);background:rgba(128,128,128,.12)}',
      '.fb .fb-tab.on{background:rgba(128,128,128,.18);border-color:var(--dsw-alias-border-l3,rgba(127,127,127,.4));color:var(--dsw-alias-state-business-primary,#4d6bfe);font-weight:600}',
      '.fb .fb-switch{position:relative;width:40px;height:22px;padding:0;border-radius:999px;border:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));background:rgba(128,128,128,.18);cursor:pointer;transition:background .15s;flex:0 0 auto}',
      '.fb .fb-switch.on{background:var(--dsw-alias-state-business-primary,#4d6bfe);border-color:var(--dsw-alias-state-business-primary,#4d6bfe)}',
      '.fb .fb-knob{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:left .15s}',
      '.fb .fb-switch.on .fb-knob{left:20px}',
      '.fb .fb-pre{white-space:pre-wrap;word-break:break-word;font-size:12px;line-height:1.7;color:var(--dsw-alias-label-secondary,#555);font-family:ui-monospace,Consolas,monospace;max-height:320px;overflow:auto}',
      '.fb .fb-fish{transition:border-color .15s,background .15s}',
      '.fb .fb-fish:hover{border-color:var(--dsw-alias-border-l3,rgba(127,127,127,.45));background:rgba(128,128,128,.04)}',
      '.fb .fb-empty{color:var(--dsw-alias-label-tertiary);font-size:12.5px}',
      '.fb .fb-error{color:var(--dsw-alias-danger,#d33);font-size:12.5px;white-space:pre-wrap}',
      '.fb .fb-ok{color:var(--dsw-alias-success,#30a46c);font-size:12.5px}',
    ].join('\n')
    function ensureStyle() {
      try {
        if (document.querySelector(`style[data-tag="${CSS_TAG}"]`)) return
        const el = document.createElement('style')
        el.setAttribute('data-tag', CSS_TAG)
        el.textContent = CSS
        document.head.appendChild(el)
      } catch { /* 没有 document 就跳过（测试/SSR） */ }
    }
    const box = {
      border: '.5px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.28))',
      borderRadius: 10,
      padding: '12px 14px',
      marginBottom: 12,
    }
    const rowS = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 8 }
    const lab = { fontSize: 12.5, color: 'var(--dsw-alias-label-tertiary, #666)' }
    const inp = { width: '100%', minWidth: 0, boxSizing: 'border-box', padding: '6px 9px', borderRadius: 7, border: '.5px solid var(--dsw-alias-border-l2, #ddd)', background: 'transparent', color: 'inherit', font: 'inherit', fontSize: 13, outline: 'none' }
    const btn = { height: 28, boxSizing: 'border-box', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', whiteSpace: 'nowrap', lineHeight: 1, padding: '0 12px', borderRadius: 7, border: '.5px solid var(--dsw-alias-border-l2, #ddd)', background: 'transparent', color: 'inherit', cursor: 'pointer', font: 'inherit', fontSize: 12.5 }
    const btnP = { ...btn, background: 'var(--dsw-alias-state-business-primary, var(--dsw-alias-brand, #4d6bfe))', borderColor: 'transparent', color: 'var(--dsw-alias-label-primary-inverted, #fff)' }
    const btnS = { ...btn, height: 26, padding: '0 10px', fontSize: 12 }
    const chip = { fontSize: 11, padding: '1px 7px', borderRadius: 6, background: 'rgba(128,128,128,.14)', color: 'var(--dsw-alias-label-tertiary, #666)', whiteSpace: 'nowrap' }

    const getJson = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() }
    const postJson = async (u, b) => {
      const r = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j.ok === false) throw new Error(j.error || ('HTTP ' + r.status))
      return j
    }
    const fmt = (n) => Number(n ?? 0).toFixed(2)
    const shortId = (id) => {
      const s = String(id || '')
      const m = s.match(/^session-([0-9a-f]{8})/i)
      if (m) return 's-' + m[1] + '…'
      return s.length > 14 ? s.slice(0, 14) + '…' : s
    }
    const samePath = (a, b) => {
      const n = (v) => String(v ?? '').replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase()
      return !!a && !!b && n(a) === n(b)
    }
    const wsName = (names, p) => (names && names[p]) || (String(p).split(/[\\\\/]/).filter(Boolean).pop() || String(p))
    const sessName = (s) => (s && s.title) || shortId((s && s.id) || '')
    const occText = (occ) => {
      if (!occ) return '未分配（不归任何会话）'
      if (occ.kind === 'workspace') return '工作区 ' + occ.id
      return '会话 ' + shortId(occ.id) + (occ.workspace ? '（' + (occ.workspace.split(/[\\\\/]/).filter(Boolean).pop() || '') + '）' : '')
    }

    /** 时间戳 → 2026-10-31 16:20 */
    const fmtTime = (ts) => {
      const n = Number(ts)
      if (!n) return '—'
      const d = new Date(n)
      if (Number.isNaN(d.getTime())) return '—'
      const p = (x) => String(x).padStart(2, '0')
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
    }
    /** 时间戳 → 12 天前 */
    const ago = (ts) => {
      const n = Number(ts)
      if (!n) return ''
      const s = Math.max(0, Date.now() - n) / 1000
      if (s < 60) return '刚刚'
      if (s < 3600) return Math.floor(s / 60) + ' 分钟前'
      if (s < 86400) return Math.floor(s / 3600) + ' 小时前'
      return Math.floor(s / 86400) + ' 天前'
    }
    const kvRow = (k, v, key) => e('div', {
      key,
      style: { display: 'flex', gap: 8, marginTop: 3, fontSize: 12, lineHeight: 1.6 },
      children: [
        e('span', { style: { color: 'var(--dsw-alias-text-3, #999)', flex: '0 0 auto', minWidth: 36 }, children: k }, 'k'),
        e('span', { style: { wordBreak: 'break-all' }, children: v }, 'v'),
      ],
    })
    /** dsh-fish 那种开关；样式在 .fb .fb-switch。 */
    function Toggle(props) {
      return e('button', {
        type: 'button',
        className: 'fb-switch' + (props.on ? ' on' : ''),
        onClick: props.onChange,
        title: props.title,
        'aria-pressed': props.on ? 'true' : 'false',
        children: e('span', { className: 'fb-knob' }, 'k'),
      }, props.k)
    }

    function FishCard(props) {
      const f = props.f
      return e('div', {
        className: 'fb-fish',
        style: { ...box, cursor: 'pointer', border: '.5px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.28))' },
        onClick: props.onOpen,
        children: [
          e('div', { style: rowS, children: [
            e('div', { style: { fontWeight: 600, fontSize: 14 }, children: f.name + (f.frozen ? ' · 封存' : '') }, 'n'),
            e('div', { style: { ...lab, fontSize: 11.5 }, children: f.episodes + ' 轮' }, 'e'),
          ] }, 'h'),
          e('div', { style: { ...lab, marginBottom: 6 }, children: occText(f.occupancy) }, 'o'),
          e('div', { style: { ...lab, marginBottom: 4 }, children: '效价 ' + fmt(f.affect.v) + ' · 唤醒 ' + fmt(f.affect.a) + ' · 愧疚 ' + fmt(f.affect.guilt) + ' · 想念 ' + fmt(f.affect.longing) }, 'a'),
          f.pendingRequests?.length
            ? e('div', { style: { fontSize: 12, color: 'var(--dsw-alias-warning, #b26a00)' }, children: '有 ' + f.pendingRequests.length + ' 个请求在等你回话' }, 'r')
            : null,
        ] }, props.k)
    }

    /** 记忆配置卡：改的是她的记忆行为，不是性能参数。保存后写 ui-config.json 并留痕。 */
    function MemoryConfigCard(props) {
      const cfg = props.cfg
      const [d, setD] = useState(null)
      const [tagText, setTagText] = useState('')
      const [busy, setBusy] = useState(false)
      const [err, setErr] = useState('')
      const [msg, setMsg] = useState('')

      useEffect(() => {
        setD(cfg ? JSON.parse(JSON.stringify(cfg)) : null)
        setTagText((((cfg && cfg.tags) || [])).join('，'))
      }, [cfg])

      if (!d) return e('div', { style: box, children: '记忆配置读取中…' }, 'mcfg-loading')

      const set = (k, v) => setD(Object.assign({}, d, { [k]: v }))
      const numInp = { width: 92, padding: '4px 8px', borderRadius: 8, border: '1px solid var(--dsw-alias-border, #ddd)', background: 'var(--dsw-alias-bg-1, transparent)', color: 'inherit', font: 'inherit', fontSize: 13, boxSizing: 'border-box' }
      const field = (k, label, hint, lo, hi) => e('div', {
        key: 'f-' + k,
        style: { marginBottom: 9 },
        children: [
          e('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, children: [
            e('span', { style: { fontSize: 13 }, children: label }, 'l'),
            e('input', { type: 'number', min: String(lo), max: String(hi), value: d[k], style: numInp, onInput: (ev) => set(k, Number(ev.target.value)) }, 'i'),
          ] }, 'r'),
          e('div', { style: { ...lab, fontSize: 11.5 }, children: hint }, 'h'),
        ],
      })
      const group = (title, nodes, key) => e('div', { key, style: { marginBottom: 10 }, children: [
        e('div', { style: { fontSize: 11.5, color: 'var(--dsw-alias-text-3, #999)', margin: '2px 0 6px' }, children: title }, 't'),
        ...nodes,
      ] })

      const save = async () => {
        setBusy(true)
        setErr('')
        setMsg('')
        try {
          const payload = Object.assign({}, d, {
            tags: String(tagText || '').split(/[,，、\s]+/).map((s) => s.trim()).filter(Boolean),
          })
          const r = await postJson(API + '/fish/' + props.fishId + '/config', { memory: payload })
          setD(JSON.parse(JSON.stringify(r.config)))
          setTagText((r.config.tags || []).join('，'))
          setMsg('已保存')
        } catch (x) {
          setErr(String((x && x.message) || x))
        }
        setBusy(false)
      }

      return e('div', { style: box, children: [
        e('div', { style: { fontWeight: 600, fontSize: 13.5, marginBottom: 2 }, children: '记忆配置' }, 'h'),
        e('div', { style: { ...lab, fontSize: 11.5, marginBottom: 10 }, children: '对整个记忆系统生效。改的是她的记忆行为：记得多细、多久整理一次、注入多少。' }, 'hint'),

        group('记录与整理', [
          field('turnsPerRecord', '每几轮记录一次', '1 = 每轮都落一条，延迟为零；调大省调用，但她会晚记一点', 1, 20),
          field('consolidateCap', '整理阈值', '未整理的轮数到这个数就排队整理（空闲时执行）', 5, 100),
        ], 'g1'),

        group('召回与注入', [
          field('recallPool', '召回池', '每次最多捞多少条候选（必须装得下注入条数）', 5, 100),
          field('injectBudget', '注入预算（字）', '每次注入给记忆留的字数；低于 300 只剩情绪、放不下记忆', 300, 4000),
          e('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }, children: [
            e('span', { style: { fontSize: 13, flex: 1 }, children: '合并层 : 最近 turn' }, 'l'),
            e('input', { type: 'number', min: '0', max: '20', value: d.memoryRatio, style: numInp, onInput: (ev) => set('memoryRatio', Number(ev.target.value)) }, 'a'),
            e('span', { style: lab, children: ':' }, 'sep'),
            e('input', { type: 'number', min: '0', max: '20', value: d.turnRatio, style: numInp, onInput: (ev) => set('turnRatio', Number(ev.target.value)) }, 'b'),
          ] }, 'ratio'),
        ], 'g2'),

        group('其它', [
          e('label', { key: 'plain', style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 8, cursor: 'pointer' }, children: [
            e('input', { type: 'checkbox', checked: !!d.herSummaryOnPlainTurns, onChange: (ev) => set('herSummaryOnPlainTurns', ev.target.checked) }, 'c'),
            e('span', { children: '平淡轮也写「她的总结」' }, 't'),
          ] }),
          e('label', { key: 'search', style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 8, cursor: 'pointer' }, children: [
            e('input', { type: 'checkbox', checked: d.searchTool !== false, onChange: (ev) => set('searchTool', ev.target.checked) }, 'c'),
            e('span', { children: '允许她主动翻记忆（memory_search）' }, 't'),
          ] }),
          e('div', { key: 'writer', style: { marginBottom: 8 }, children: [
            e('div', { style: { fontSize: 13, marginBottom: 3 }, children: '同时写入' }, 'l'),
            e('select', {
              value: d.singleWriter || 'warn',
              style: { ...inp, padding: '6px 9px', fontSize: 12.5, boxSizing: 'border-box' },
              onChange: (ev) => set('singleWriter', ev.target.value),
              children: [
                e('option', { key: 'w', value: 'warn', children: '检测并告警（默认）' }, 'w'),
                e('option', { key: 's', value: 'strict', children: '抢不到就拒绝启动' }, 's'),
                e('option', { key: 'o', value: 'off', children: '不检测' }, 'o'),
              ],
            }, 's'),
            e('div', { style: { ...lab, fontSize: 11.5, marginTop: 3 }, children: '同一只鱼只该有一个进程在写。告警模式下照样写，只是设置页会挂一条警告。' }, 'h'),
          ] }),
          e('label', { key: 'emb', style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 8, cursor: 'pointer' }, children: [
            e('input', {
              type: 'checkbox',
              checked: !!(d.embeddings && d.embeddings.enabled),
              onChange: (ev) => set('embeddings', { ...(d.embeddings || {}), enabled: ev.target.checked }),
            }, 'c'),
            e('span', { children: '向量检索（默认关，先跑评测再开）' }, 't'),
          ] }),
          d.embeddings && d.embeddings.enabled
            ? e('div', { key: 'embconf', style: { marginBottom: 8, paddingLeft: 22 }, children: [
                e('div', { style: { fontSize: 12.5, marginBottom: 3 }, children: 'embedding 模型' }, 'l1'),
                e('input', {
                  style: { ...inp, padding: '6px 9px', fontSize: 12.5, boxSizing: 'border-box', marginBottom: 6 },
                  value: d.embeddings.model || '',
                  placeholder: '例：text-embedding-3-small',
                  onInput: (ev) => set('embeddings', { ...d.embeddings, model: ev.target.value }),
                }, 'i1'),
                e('div', { style: { fontSize: 12.5, marginBottom: 3 }, children: 'embedding 服务地址' }, 'l2'),
                e('input', {
                  style: { ...inp, padding: '6px 9px', fontSize: 12.5, boxSizing: 'border-box' },
                  value: d.embeddings.baseUrl || '',
                  placeholder: '留空 = 跟评价器同源；密钥沿用评价器那把',
                  onInput: (ev) => set('embeddings', { ...d.embeddings, baseUrl: ev.target.value }),
                }, 'i2'),
              ] })
            : null,
          e('div', { key: 'model', style: { marginBottom: 8 }, children: [
            e('div', { style: { fontSize: 13, marginBottom: 3 }, children: '中性总结模型' }, 'l'),
            e('input', { style: { ...inp, padding: '6px 9px', fontSize: 12.5, boxSizing: 'border-box' }, value: d.neutralModel || '', placeholder: '留空 = 跟评价器同一个模型', onInput: (ev) => set('neutralModel', ev.target.value) }, 'i'),
          ] }),
          e('div', { key: 'tags', children: [
            e('div', { style: { fontSize: 13, marginBottom: 3 }, children: '主题标签词表' }, 'l'),
            e('input', { style: { ...inp, padding: '6px 9px', fontSize: 12.5, boxSizing: 'border-box' }, value: tagText, placeholder: '用逗号分隔', onInput: (ev) => setTagText(ev.target.value) }, 'i'),
            e('div', { style: { ...lab, fontSize: 11.5, marginTop: 3 }, children: '留一个「其他」兜底；这个标签占比超过三成就该改词表了' }, 'h'),
          ] }),
        ], 'g3'),

        e('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, flexWrap: 'wrap' }, children: [
          e('button', { style: busy ? { ...btnP, opacity: 0.55, cursor: 'default' } : btnP, disabled: busy, onClick: save, children: busy ? '保存中…' : '保存' }, 'save'),
          e('span', { style: { ...lab, fontSize: 12 }, children: msg }, 'm'),
          e('span', { style: { fontSize: 12, color: 'var(--dsw-alias-danger, #d33)' }, children: err }, 'e'),
        ] }, 'acts'),
      ] }, 'mcfg')
    }

    /** 记忆详情：合并记忆 + 轮次记录。新结构（turn/merged）优先，旧结构做兼容映射。 */
    function MemoryDetail(props) {
      const [data, setData] = useState(null)
      const [err, setErr] = useState('')
      const [tab, setTab] = useState('merged')
      const [kind, setKind] = useState('all')
      const [q, setQ] = useState('')
      const [open, setOpen] = useState(null)
      const [tick, setTick] = useState(0)

      useEffect(() => {
        let dead = false
        const load = async (attempt) => {
          try {
            const d = await getJson(API + '/fish/' + props.fishId + '/memory')
            if (!dead) { setData(d); setErr('') }
          } catch (x) {
            if (dead) return
            setErr(String((x && x.message) || x))
            if (attempt < 2) setTimeout(() => { void load(attempt + 1) }, 1200)
          }
        }
        void load(0)
        return () => { dead = true }
      }, [props.fishId, tick])

      if (err && !data) return e('div', { style: box, children: '读不到记忆：' + err }, 'mdet-err')
      if (!data) return e('div', { style: box, children: '读取记忆…' }, 'mdet-loading')

      const st = data.stats || {}
      const memories = data.memories || []
      const turns = data.turns || []
      const byTurn = {}
      for (const m of memories) for (const id of (m.evidence || [])) (byTurn[id] = byTurn[id] || []).push(m)

      const ql = String(q || '').trim().toLowerCase()
      const has = (s) => String(s == null ? '' : s).toLowerCase().indexOf(ql) >= 0
      const KIND_LABEL = { fact: '事实', lesson: '教训', relation: '关系', self: '自我' }
      const SUBJECT_LABEL = { user: '关于他', self: '关于我', between: '关于我们', world: '关于世界' }
      const KINDS = [['all', '全部'], ['fact', '事实'], ['lesson', '教训'], ['relation', '关系'], ['self', '自我']]
      const memList = memories.filter((m) => (kind === 'all' || m.kind === kind) && (!ql || has(m.claim) || has(m.attitude) || (m.tags || []).some(has)))
      const turnList = turns.filter((t) => !ql || has(t.neutral) || (t.her || []).some((h) => has(h.text)))
      const active = 'var(--dsw-alias-bg-2, rgba(127,127,127,0.16))'

      const statLine = [
        (st.memoryTotal || 0) + ' 条合并记忆',
        (st.turnTotal || 0) + ' 轮记录',
        st.retired ? st.retired + ' 条已退休' : null,
        st.pending === null || st.pending === undefined ? null : st.pending + ' 轮待整理',
      ].filter(Boolean).join(' · ')

      const detailOf = (m) => e('div', {
        style: { marginTop: 8, paddingTop: 7, borderTop: '1px solid var(--dsw-alias-border, rgba(127,127,127,0.14))' },
        children: [
          kvRow('状态', m.status === 'retired' ? '已退休 · 仍可查，不再注入' : '有效', 'st'),
          kvRow('证据', m.evidenceMode === 'lines'
            ? (m.evidence.length ? m.evidence.length + ' 行' : '无') + '（旧格式：提示词行号，无法回溯）'
            : (m.evidence.length ? m.evidence.length + ' 轮 turn' : '无'), 'ev'),
          kvRow('时间', fmtTime(m.createdAt) + (ago(m.createdAt) ? '（' + ago(m.createdAt) + '）' : ''), 'at'),
          kvRow('情绪', m.affectPeak ? '效价 ' + fmt(m.affectPeak.valence) + ' · 唤醒 ' + fmt(m.affectPeak.arousal) : '未记录', 'af'),
          kvRow('溯源', m.by ? ((m.by.model || '?') + ' · ' + (m.by.prompt || '?')) : '旧数据', 'by'),
          m.supersedes ? kvRow('取代', shortId(m.supersedes), 'sp') : null,
          m.evidenceMode === 'turns' && m.evidence.length ? kvRow('指向', m.evidence.map(shortId).join('、'), 'ids') : null,
        ],
      })

      const memItem = (m, i) => {
        const isOpen = open === 'm:' + m.id
        return e('div', {
          key: 'm' + i,
          style: { padding: '9px 10px', borderRadius: 9, marginBottom: 6, border: '1px solid var(--dsw-alias-border, rgba(127,127,127,0.16))', cursor: 'pointer' },
          onClick: () => setOpen(isOpen ? null : 'm:' + m.id),
          children: [
            e('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, flexWrap: 'wrap' }, children: [
              e('span', { style: chip, children: KIND_LABEL[m.kind] || m.kind }, 'k'),
              e('span', { style: { fontSize: 11, color: 'var(--dsw-alias-text-3, #999)' }, children: SUBJECT_LABEL[m.subject] || '' }, 's'),
              e('span', { style: { fontSize: 11, color: 'var(--dsw-alias-text-3, #999)', marginLeft: 'auto' }, children: '置信 ' + fmt(m.confidence) + (m.reinforcements ? ' · 提及 ' + m.reinforcements + ' 次' : '') + (m.status === 'retired' ? ' · 已退休' : '') }, 'c'),
            ] }, 'h'),
            e('div', { style: { fontSize: 13, lineHeight: 1.6, opacity: m.status === 'retired' ? 0.62 : 1 }, children: m.claim }, 'claim'),
            m.attitude ? e('div', { style: { fontSize: 12.5, color: 'var(--dsw-alias-text-2, #666)', marginTop: 2 }, children: '（' + m.attitude + '）' }, 'att') : null,
            (m.tags || []).length ? e('div', { style: { display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 5 }, children: m.tags.map((t, j) => e('span', { key: 'tt' + j, style: chip, children: '#' + t })) }, 'tags') : null,
            isOpen ? detailOf(m) : null,
          ],
        })
      }

      const turnDetail = (t) => e('div', {
        style: { marginTop: 8, paddingTop: 7, borderTop: '1px solid var(--dsw-alias-border, rgba(127,127,127,0.14))' },
        children: [
          e('div', { style: { fontSize: 11.5, color: 'var(--dsw-alias-text-3, #999)', marginBottom: 4 }, children: '她的看法（按时间追加）' }, 'sh'),
          (t.her || []).length
            ? t.her.map((h, i) => e('div', { key: 'h' + i, style: { marginBottom: 6 }, children: [
                e('div', { style: { fontSize: 11, color: 'var(--dsw-alias-text-3, #999)' }, children: fmtTime(h.at) + (h.affect ? ' · 效价 ' + fmt(h.affect.valence) + ' / 唤醒 ' + fmt(h.affect.arousal) : '') }, 'ht'),
                e('div', { style: { fontSize: 12.8, lineHeight: 1.6 }, children: h.text }, 'hx'),
              ] }))
            : e('div', { style: { fontSize: 12, color: 'var(--dsw-alias-text-3, #999)' }, children: '她还没对这条留下看法' }, 'noh'),
          kvRow('存取', '被想起 ' + ((t.hits && t.hits.considered) || 0) + ' 次 · 真用到 ' + ((t.hits && t.hits.used) || 0) + ' 次', 'hits'),
          (t.tags || []).length ? kvRow('标签', t.tags.map((x) => '#' + x).join(' '), 'tags') : null,
          t.affectPeak ? kvRow('情绪', '效价 ' + fmt(t.affectPeak.valence) + ' · 唤醒 ' + fmt(t.affectPeak.arousal), 'af') : null,
          (byTurn[t.id] || []).length ? kvRow('被引用', byTurn[t.id].map((m) => String(m.claim || '').slice(0, 18)).join('；'), 'ref') : null,
          t.rawText ? e('div', { style: { marginTop: 6 }, children: [
            e('div', { style: { fontSize: 11, color: 'var(--dsw-alias-text-3, #999)', marginBottom: 2 }, children: '原文' }, 'rh'),
            e('div', { style: { fontSize: 12.5, whiteSpace: 'pre-wrap', background: 'var(--dsw-alias-bg-2, rgba(127,127,127,0.07))', borderRadius: 8, padding: '7px 9px' }, children: t.rawText }, 'rx'),
          ] }) : null,
        ],
      })

      const turnItem = (t, i) => {
        const isOpen = open === 't:' + t.id
        const latest = (t.her || [])[(t.her || []).length - 1]
        return e('div', {
          key: 't' + i,
          style: { padding: '9px 10px', borderRadius: 9, marginBottom: 6, border: '1px solid var(--dsw-alias-border, rgba(127,127,127,0.16))', cursor: 'pointer' },
          onClick: () => setOpen(isOpen ? null : 't:' + t.id),
          children: [
            e('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }, children: [
              e('span', { style: { fontSize: 11, color: 'var(--dsw-alias-text-3, #999)' }, children: fmtTime(t.occurredAt) + ' · ' + ago(t.occurredAt) }, 'time'),
              e('span', { style: { ...chip, marginLeft: 'auto' }, children: t.summaryState === 'both' ? '双总结' : t.summaryState === 'her' ? '只有她' : t.summaryState === 'neutral' ? '只有中性' : '未总结' }, 'st'),
            ] }, 'h'),
            e('div', { style: { fontSize: 12.8, lineHeight: 1.6, whiteSpace: 'pre-wrap', maxHeight: isOpen ? 'none' : 66, overflow: 'hidden' }, children: t.neutral || '（还没有中性总结）' }, 'n'),
            latest ? e('div', { style: { fontSize: 12.5, color: 'var(--dsw-alias-text-2, #666)', marginTop: 3 }, children: '（' + latest.text + '）' }, 'her') : null,
            isOpen ? turnDetail(t) : null,
          ],
        })
      }

      const segBtn = (id, label) => e('button', {
        key: 'seg-' + id,
        style: tab === id ? { ...btnS, background: active, fontWeight: 600 } : btnS,
        onClick: () => { setTab(id); setOpen(null) },
        children: label,
      })

      return e('div', { style: { ...box, marginBottom: 0 }, children: [
        e('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 2 }, children: [
          e('div', { style: { fontWeight: 600, fontSize: 13.5 }, children: '记忆详情' }, 'h'),
          e('button', { style: btnS, onClick: () => setTick((n) => n + 1), children: '刷新' }, 'r'),
        ] }, 'head'),
        e('div', { style: { ...lab, fontSize: 11.5 }, children: statLine }, 'stat'),
        st.lock
          ? e('div', { style: { ...lab, fontSize: 11.5, color: 'var(--dsw-alias-warning, #b26a00)', marginTop: 2 }, children: '⚠ 另一个进程（pid ' + st.lock.pid + '）也在写这只鱼——双写会让记忆错乱' }, 'lock')
          : null,
        e('div', { style: { ...lab, fontSize: 11.5, marginBottom: 10 }, children: data.view === 'legacy'
          ? '数据来自旧结构（episode / semantic / procedure）：证据是行号、没有她与中性的两份总结。新的 turn / merged 落盘后这里自动切换。'
          : '数据来自新结构（turn / merged）。' }, 'banner'),

        e('div', { style: { display: 'flex', gap: 6, marginBottom: 8 }, children: [
          segBtn('merged', '合并记忆 ' + memories.length),
          segBtn('turns', '轮次记录 ' + turns.length),
        ] }, 'seg'),

        e('input', { style: { ...inp, padding: '6px 10px', fontSize: 12.5, boxSizing: 'border-box', marginBottom: 8 }, value: q, placeholder: tab === 'merged' ? '搜结论、态度、标签…' : '搜轮次内容…', onInput: (ev) => setQ(ev.target.value) }, 'q'),

        tab === 'merged' ? e('div', { children: [
          e('div', { style: { display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }, children: KINDS.map(([id, label]) =>
            e('button', {
              key: id,
              style: id === kind ? { ...btnS, background: active, fontWeight: 600 } : btnS,
              onClick: () => setKind(id),
              children: label + (id === 'all' ? '' : ' ' + ((st.byKind && st.byKind[id]) || 0)),
            })) }, 'kinds'),
          memList.length
            ? memList.map(memItem)
            : e('div', { style: { ...lab, padding: '10px 0' }, children: memories.length ? '没有匹配的记忆' : '还没有合并记忆。攒够整理阈值后会自动整理。' }, 'none'),
        ] }, 'm-merged') : e('div', { children: [
          turnList.length
            ? turnList.map(turnItem)
            : e('div', { style: { ...lab, padding: '10px 0' }, children: turns.length ? '没有匹配的轮次' : '还没有轮次记录。' }, 'none'),
        ] }, 'm-turns'),
      ] }, 'mdet')
    }

    /**
     * 上网（B 站只读）。所有字段都是环境参数，不是她的喜好。
     * 设置全局生效；配额与历史按鱼算。
     */
    function BrowsePanel(props) {
      const f = props.fish
      const [cfg, setCfg] = useState(null)
      const [status, setStatus] = useState(null)
      const [hist, setHist] = useState({ items: [], total: 0, pages: 1, page: 0 })
      const [auth, setAuth] = useState(null)
      const [comment, setComment] = useState(null)
      const [biliStatus, setBiliStatus] = useState(null)
      const [cookieText, setCookieText] = useState('')
      const [ownerMid, setOwnerMid] = useState('')
      const [ownerName, setOwnerName] = useState('')
      const [err, setErr] = useState('')
      const [msg, setMsg] = useState('')
      const [busy, setBusy] = useState('')
      const [runText, setRunText] = useState('')
      const [replyText, setReplyText] = useState('')

      const loadAll = useCallback(async () => {
        try {
          const b = await getJson(API + '/browse')
          setCfg(b.config)
          setStatus(await getJson(API + '/fish/' + f.id + '/browse'))
          const h = await getJson(API + '/fish/' + f.id + '/browse/history?days=14&page=0')
          setHist(h)
          const bl = await getJson(API + '/bili')
          setAuth(bl.auth)
          setComment(bl.comment)
          setOwnerMid(bl.auth?.mid ?? '')
          setOwnerName(bl.auth?.nickname ?? '')
          setBiliStatus(await getJson(API + '/fish/' + f.id + '/bili'))
          setErr('')
        } catch (x) {
          const m = String((x && x.message) || x)
          setErr(m.includes('404')
            ? '宿主后端还是旧版本（HTTP 404）：请完全退出 DSH 再启动，重新启用 fishbowl 后刷新本页。'
            : m)
        }
      }, [f.id])
      useEffect(() => { void loadAll() }, [loadAll])

      if (!cfg) return e('div', { style: box, children: err || '上网配置读取中…' }, 'b-loading')
      const set = (k, v) => setCfg(Object.assign({}, cfg, { [k]: v }))
      const setAvoid = (k, v) => setCfg(Object.assign({}, cfg, { avoid: Object.assign({}, cfg.avoid || {}, { [k]: v }) }))
      const setPace = (k, v) => setCfg(Object.assign({}, cfg, { pacing: Object.assign({}, cfg.pacing || {}, { [k]: v }) }))
      const numInp = { ...inp, width: 88, padding: '4px 8px', boxSizing: 'border-box' }
      const field = (label, control, hint, key) => e('div', { key, style: { marginBottom: 9 }, children: [
        e('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, children: [
          e('span', { style: { fontSize: 13 }, children: label }, 'l'),
          e('span', { style: { display: 'flex', gap: 6, alignItems: 'center' }, children: control }, 'v'),
        ] }, 'r'),
        hint ? e('div', { style: { ...lab, fontSize: 11.5 }, children: hint }, 'h') : null,
      ] })
      const num = (k, lo, hi, val, onChange) => e('input', {
        type: 'number', min: String(lo), max: String(hi), value: val, style: numInp,
        onInput: (ev) => onChange(Number(ev.target.value)),
      }, k)
      const time = (val, onChange, key) => e('input', { key, type: 'time', value: val, style: { ...inp, width: 112 }, onInput: (ev) => onChange(ev.target.value) }, key)
      const sourceBox = (id, label) => e('label', {
        key: 'src-' + id,
        style: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, marginRight: 10, cursor: 'pointer' },
        children: [
          e('input', {
            type: 'checkbox', checked: (cfg.sources || []).includes(id),
            onChange: (ev) => {
              const cur = new Set(cfg.sources || [])
              if (ev.target.checked) cur.add(id); else cur.delete(id)
              set('sources', [...cur])
            },
          }, 'c'),
          label,
        ],
      })

      const act = async (fn, okMsg) => {
        setBusy('save'); setErr(''); setMsg('')
        try { await fn(); setMsg(okMsg || ''); await loadAll() }
        catch (x) { setErr(String((x && x.message) || x)) }
        finally { setBusy('') }
      }
      const save = () => act(async () => {
        const r = await postJson(API + '/fish/' + f.id + '/config', { browse: cfg })
        setCfg(r.config)
      }, '上网设置已保存')
      const run = () => act(async () => {
        setBusy('run'); setRunText('')
        try {
          const r = await postJson(API + '/fish/' + f.id + '/browse/run', {})
          setRunText(r.result?.ok ? String(r.result.text || '') : ('这次没看到什么：' + String(r.result?.note || '')))
          if (r.status) setStatus(r.status)
          await loadAll()
        } finally { setBusy('') }
      }, '')

      const cm = comment || { enabled: false, perDay: 1, replyPerDay: 2, replyToReplies: true, scanEveryMin: 30, window: ['20:00', '23:00'], atOwner: true }
      const setCm = (k, v) => setComment(Object.assign({}, cm, { [k]: v }))
      const saveBili = () => act(async () => {
        // 账号是这台机器一份；评论开关是这条鱼自己的
        await postJson(API + '/bili', { auth: { mid: ownerMid, nickname: ownerName } })
        await postJson(API + '/fish/' + f.id + '/config', { comment: cm })
      }, 'B 站设置已保存')
      const saveCookie = () => act(async () => {
        const r = await postJson(API + '/bili/auth', { cookie: cookieText })
        setCookieText('')
        setMsg(r.note || '存下了。')
      }, 'cookie 已保存')
      const testCookie = () => act(async () => {
        const r = await postJson(API + '/bili/auth/test', {})
        setMsg(r.note || '能说话。')
      }, 'cookie 有效')
      const clearCookie = () => act(async () => {
        await postJson(API + '/bili/auth/clear', {})
        setCookieText('')
      }, 'cookie 已清除')
      const scanNow = () => act(async () => {
        setBusy('scan')
        try {
          const r = await postJson(API + '/fish/' + f.id + '/bili/scan', {})
          setReplyText(r.text || (r.items?.length ? '' : '现在没人回她。'))
        } finally { setBusy('') }
      }, '')

      const s = status || {}
      const risk = s.risk || {}
      const cards = [
        e('div', { style: box, key: 'onoff', children: [
          e('div', { style: rowS, children: [
            e('div', { style: { fontWeight: 600, fontSize: 13.5 }, children: '能不能上网' }, 'h'),
          ] }, 'head'),
          e('div', { style: { ...lab, marginBottom: 8 }, children: '上网的开关在「状态 → 能力」里（关掉后工具和这一页都会消失）。' }, 'hint'),
          e('div', { style: rowS, children: [
            e('span', { style: lab, children: '看 B 站前要先得到我同意' }, 'pl'),
            e(Toggle, { on: cfg.requirePermit === true, onChange: () => set('requirePermit', cfg.requirePermit !== true), k: 'permit' }),
          ] }, 'permitrow'),
          e('div', { style: { ...lab, fontSize: 11.5, marginBottom: 8 }, children: '打开后：没有许可时工具直接返回「需要许可才能调用」，她自己醒着时也一样。' }, 'permithint'),
          e('div', { style: rowS, children: [
            e('span', { style: lab, children: '上网时段' }, 'l'),
            e('span', { style: { display: 'flex', gap: 6, alignItems: 'center' }, children: [
              time((cfg.window || [])[0] ?? '08:00', (v) => set('window', [v, (cfg.window || [])[1] ?? '23:00']), 'w1'),
              e('span', { style: lab, children: '到' }, 'sep'),
              time((cfg.window || [])[1] ?? '23:00', (v) => set('window', [(cfg.window || [])[0] ?? '08:00', v]), 'w2'),
            ] }, 'w'),
          ] }, 'win'),
        ] }, 'b-onoff'),
        e('div', { style: box, key: 'freq', children: [
          e('div', { style: { fontWeight: 600, fontSize: 13.5, marginBottom: 8 }, children: '频率' }, 'h'),
          e('div', { style: { ...lab, fontSize: 11.5, marginBottom: 8 }, children: '这个次数主要管她自处时；你让她现在看时不受它限制。' }, 'fhint'),
          field('每天最多几次', num('perDay', 0, 4, cfg.perDay, (v) => set('perDay', v)), '0 = 从不；一次 = 看一批。', 'b-perday'),
          field('一次看几条', num('topN', 1, 10, cfg.topN, (v) => set('topN', v)), '挑几条进「打算看」的清单。', 'b-topn'),
          field('每条深读几条热评', num('deepRead', 0, 20, cfg.deepRead, (v) => set('deepRead', v)), '0 = 只读简介。', 'b-deep'),
          field('每条抽几条弹幕', num('danmaku', 0, 30, cfg.danmaku, (v) => set('danmaku', v)), '0 = 不抽。', 'b-dm'),
        ] }, 'b-freq'),
        e('div', { style: box, key: 'src', children: [
          e('div', { style: { fontWeight: 600, fontSize: 13.5, marginBottom: 6 }, children: '从哪儿看' }, 'h'),
          e('div', { style: { display: 'flex', flexWrap: 'wrap', marginBottom: 8 }, children: [
            sourceBox('popular', '热门'), sourceBox('ranking', '排行'), sourceBox('precious', '入站必刷'),
          ] }, 'sources'),
          e('div', { style: { ...lab, marginBottom: 4 }, children: '额外的搜索词（逗号分隔，可空）' }, 'kl'),
          e('input', { style: inp, value: (cfg.keywords || []).join('，'), placeholder: '例：纪录片，手工', onInput: (ev) => set('keywords', ev.target.value.split(/[,，]/).map((x) => x.trim()).filter(Boolean)) }, 'kw'),
        ] }, 'b-src'),
        e('div', { style: box, key: 'avoid', children: [
          e('div', { style: { fontWeight: 600, fontSize: 13.5, marginBottom: 6 }, children: '不想看的东西' }, 'h'),
          e('div', { style: { ...lab, marginBottom: 4 }, children: '标题/UP/标签命中这些词就不点进去（逗号分隔）' }, 'al'),
          e('input', { style: inp, value: (cfg.avoid?.keywords || []).join('，'), placeholder: '例：恐怖，血腥', onInput: (ev) => setAvoid('keywords', ev.target.value.split(/[,，]/).map((x) => x.trim()).filter(Boolean)) }, 'ak'),
          e('div', { style: { ...rowS, marginTop: 8 }, children: [
            e('span', { style: lab, children: '太短的不看' }, 'l'),
            e('span', { style: { display: 'flex', gap: 6, alignItems: 'center' }, children: [
              num('minDuration', 0, 3600, cfg.avoid?.minDuration ?? 60, (v) => setAvoid('minDuration', v)),
              e('span', { style: lab, children: '秒' }, 'u'),
            ] }, 'v'),
          ] }, 'md'),
        ] }, 'b-avoid'),
        e('div', { style: box, key: 'pace', children: [
          e('div', { style: { fontWeight: 600, fontSize: 13.5, marginBottom: 6 }, children: '请求节奏（网络环境）' }, 'h'),
          e('div', { style: { ...lab, marginBottom: 8 }, children: '家宽 800ms 安全；机房 IP 建议 2000–3000ms。' }, 'ph'),
          e('div', { style: rowS, children: [
            e('span', { style: lab, children: '两次请求最少隔' }, 'l'),
            e('span', { style: { display: 'flex', gap: 6, alignItems: 'center' }, children: [
              num('minIntervalMs', 200, 120000, cfg.pacing?.minIntervalMs ?? 800, (v) => setPace('minIntervalMs', v)),
              e('span', { style: lab, children: '毫秒' }, 'u'),
            ] }, 'v'),
          ] }, 'p1'),
          e('div', { style: rowS, children: [
            e('span', { style: lab, children: '每次再随机多等' }, 'l'),
            e('span', { style: { display: 'flex', gap: 6, alignItems: 'center' }, children: [
              num('jitterMs', 0, 60000, cfg.pacing?.jitterMs ?? 500, (v) => setPace('jitterMs', v)),
              e('span', { style: lab, children: '毫秒' }, 'u'),
            ] }, 'v'),
          ] }, 'p2'),
        ] }, 'b-pace'),
      ]

      const statusCard = e('div', { style: box, key: 'status', children: [
        e('div', { style: { fontWeight: 600, fontSize: 13.5, marginBottom: 4 }, children: '今天' }, 'h'),
        e('div', { style: { ...lab, fontSize: 12, lineHeight: 1.8 }, children: [
          e('div', { children: `已用 ${s.usedToday ?? 0} / ${s.perDay ?? cfg.perDay} 次；今天翻到 ${s.todayCount ?? 0} 条。` }, 'u'),
          e('div', { children: s.lastAt ? `上次上网：${fmtTime(s.lastAt)}` : '还没上过网。' }, 'last'),
          e('div', { children: risk.cooling ? `风控冷却中，还要约 ${risk.remainMin} 分钟。` : '风控：没在冷却。' }, 'risk'),
          e('div', { children: s.granted ? '他允许她没事时自己刷 B 站。' : '他还没说过「没事可以刷刷 B 站」。' }, 'grant'),
          s.granted && !cfg.enabled ? e('div', { style: { color: 'var(--dsw-alias-warning, #b26a00)' }, children: '他允许了，但硬开关还关着——打开后才会生效。' }, 'warn') : null,
        ] }, 'lines'),
      ] }, 'b-status')

      const historyCard = e('div', { style: box, key: 'history', children: [
        e('div', { style: { fontWeight: 600, fontSize: 13.5, marginBottom: 4 }, children: '她翻到过什么' }, 'h'),
        e('div', { style: { ...lab, fontSize: 11.5, marginBottom: 8 }, children: '只记标题和 UP；标「只翻到过」的是没看画面的。' }, 'hint'),
        (hist.items || []).length
          ? (hist.items || []).map((it, i) => e('div', { key: 'h' + i, style: { fontSize: 12.5, marginBottom: 5, display: 'flex', gap: 8, alignItems: 'baseline' }, children: [
            e('span', { style: { ...chip, flex: '0 0 auto' }, children: it.day?.slice(5) || '' }, 'd'),
            e('a', { href: it.url, target: '_blank', rel: 'noreferrer', style: { color: 'inherit', textDecoration: 'underline' }, children: it.title || it.bvid }, 't'),
            e('span', { style: { ...lab, fontSize: 11.5 }, children: it.how === 'watch' ? '看过画面' : '只翻到过' }, 'how'),
          ] }, 'h' + i))
          : e('div', { style: lab, children: '还没有记录。' }, 'none'),
      ] }, 'b-history')

      const au = auth || {}
      const bs = biliStatus || {}
      const numCm = (k, lo, hi, val) => e('input', {
        type: 'number', min: String(lo), max: String(hi), value: val, style: numInp,
        onInput: (ev) => setCm(k, Number(ev.target.value)),
      }, 'cm-' + k)
      const loginCard = e('div', { style: box, key: 'bili-auth', children: [
        e('div', { style: { fontWeight: 600, fontSize: 13.5, marginBottom: 4 }, children: 'B 站登录（cookie）' }, 'h'),
        e('div', { style: { ...lab, fontSize: 12, marginBottom: 8, lineHeight: 1.8 }, children: [
          e('div', { children: au.hasCookie
            ? `已存${au.account?.name ? `，登录账号：${au.account.name}${au.account.mid ? `（uid ${au.account.mid}）` : ''}` : ''}${au.hasCsrf ? '' : '，但少了 bili_jct（不能说话）'}。`
            : '还没存。没存也能看视频，只是不能在评论区说话。' }, 'st'),
          e('div', { style: { color: 'var(--dsw-alias-text-3, #999)' }, children: '只落本机 bili-auth.json（0600）；存完不回显。建议用小号。' }, 'hint'),
        ] }, 'status'),
        e('textarea', {
          rows: 3,
          style: { ...inp, minHeight: 62, resize: 'vertical', boxSizing: 'border-box' },
          value: cookieText,
          placeholder: 'SESSDATA=...; bili_jct=...',
          onInput: (ev) => setCookieText(ev.target.value),
        }, 'cookie'),
        e('div', { style: { ...rowS, marginTop: 8 }, children: [
          e('span', { style: { ...lab, fontSize: 11.5 }, children: '从浏览器 DevTools 的 Cookie 头整段粘贴；也可以从 cookies.txt 粘。' }, 'h'),
          e('span', { style: { display: 'flex', gap: 6 }, children: [
            e('button', { style: btnS, disabled: busy === 'save' || !cookieText.trim(), onClick: saveCookie, children: '保存 cookie' }, 'saveck'),
            e('button', { style: btnS, disabled: busy === 'save' || !au.hasCookie, onClick: testCookie, children: '测试能不能说话' }, 'testck'),
            e('button', { style: btnS, disabled: busy === 'save' || !au.hasCookie, onClick: clearCookie, children: '清除' }, 'clrck'),
          ] }, 'acts'),
        ] }, 'row'),
      ] }, 'bili-login')

      const speakCard = e('div', { style: box, key: 'bili-speak', children: [
        e('div', { style: rowS, children: [
          e('div', { style: { fontWeight: 600, fontSize: 13.5 }, children: '在 B 站说话' }, 'h'),
          e(Toggle, { on: cm.enabled, onChange: () => setCm('enabled', !cm.enabled), k: 'sw' }),
        ] }, 'head'),
        e('div', { style: { ...lab, fontSize: 11.5, marginBottom: 8 }, children: '说话的总开关在「状态 → 能力」里。这是唯一会动账号的功能：评论公开留痕。她只评今天自己看过的视频；回复只回别人在她评论下面的楼。' }, 'hint'),
        e('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 8, marginBottom: 8 }, children: [
          e('div', { children: [e('div', { style: lab, children: '每天最多发几条评论' }, 'l'), numCm('perDay', 0, 5, cm.perDay ?? 1)] }, 'p'),
          e('div', { children: [e('div', { style: lab, children: '每天最多回几条' }, 'l'), numCm('replyPerDay', 0, 10, cm.replyPerDay ?? 2)] }, 'r'),
          e('div', { children: [e('div', { style: lab, children: '多久查一次有没有人回（分钟）' }, 'l'), numCm('scanEveryMin', 5, 720, cm.scanEveryMin ?? 30)] }, 's'),
          e('div', { children: [
            e('div', { style: lab, children: '允许说话的时间段' }, 'sl'),
            e('span', { style: { display: 'flex', gap: 6, alignItems: 'center' }, children: [
              time((cm.window || [])[0] ?? '20:00', (v) => setCm('window', [v, (cm.window || [])[1] ?? '23:00']), 'cw1'),
              e('span', { style: lab, children: '到' }, 'sep'),
              time((cm.window || [])[1] ?? '23:00', (v) => setCm('window', [(cm.window || [])[0] ?? '20:00', v]), 'cw2'),
            ] }, 'w'),
          ] }, 'w'),
        ] }, 'grid'),
        e('div', { style: rowS, children: [
          e('span', { style: lab, children: '说话前要先得到我同意' }, 'pl'),
          e(Toggle, { on: cm.requirePermit === true, onChange: () => setCm('requirePermit', cm.requirePermit !== true), k: 'permit' }),
        ] }, 'cmpermit'),
        e('div', { style: rowS, children: [
          e('span', { style: lab, children: '有人回她时允许她回一句' }, 'l'),
          e(Toggle, { on: cm.replyToReplies !== false, onChange: () => setCm('replyToReplies', cm.replyToReplies === false), k: 'rt' }),
        ] }, 'reply'),
        e('div', { style: { borderTop: '1px solid var(--dsw-alias-border, rgba(127,127,127,0.15))', paddingTop: 8, marginTop: 8 }, children: [
          e('div', { style: { ...lab, fontSize: 11.5, marginBottom: 4 }, children: '评论最前面 @ 的人（一般是你自己；需要昵称，不是登录账号）' }, 'oh'),
          e('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 8 }, children: [
            e('input', { style: inp, value: ownerMid, placeholder: 'B 站 uid（数字）', onInput: (ev) => setOwnerMid(ev.target.value) }, 'om'),
            e('input', { style: inp, value: ownerName, placeholder: 'B 站昵称（@ 用）', onInput: (ev) => setOwnerName(ev.target.value) }, 'on'),
          ] }, 'owner'),
          e('div', { style: rowS, children: [
            e('span', { style: lab, children: '发评论时在最前面 @ 你' }, 'l'),
            e(Toggle, { on: cm.atOwner !== false, onChange: () => setCm('atOwner', cm.atOwner === false), k: 'at' }),
          ] }, 'at'),
        ] }, 'ownerbox'),
        e('div', { style: { ...rowS, marginTop: 8 }, children: [
          e('span', { style: { ...lab, fontSize: 11.5 }, children: '说出去的话会过秘密/隐私闸；公开场合，不该带你们之间的私事。' }, 'h'),
          e('button', { style: { ...btnP, padding: '5px 14px', fontSize: 12.5 }, disabled: busy === 'save', onClick: saveBili, children: '保存说话设置' }, 'save'),
        ] }, 'acts'),
      ] }, 'bili-speak')

      const replyCard = e('div', { style: box, key: 'bili-reply', children: [
        e('div', { style: { fontWeight: 600, fontSize: 13.5, marginBottom: 4 }, children: '她的评论区' }, 'h'),
        e('div', { style: { ...lab, fontSize: 12, lineHeight: 1.8 }, children: [
          e('div', { children: `今天说了 ${bs.commentToday ?? 0} 条评论、回了 ${bs.replyToday ?? 0} 条。` }, 'c'),
          e('div', { children: bs.lastScanAt ? `上次查看：${fmtTime(bs.lastScanAt)}；当时有 ${bs.waiting ?? 0} 条没回。` : '还没查过有没有人回。' }, 's'),
        ] }, 'st'),
        e('div', { style: { ...rowS, marginTop: 8 }, children: [
          e('span', { style: { ...lab, fontSize: 11.5 }, children: '她醒着的时候会自动查；也可以现在查一下。' }, 'h'),
          e('button', { style: btnS, disabled: busy === 'scan', onClick: scanNow, children: busy === 'scan' ? '查着…' : '查一下有没有人回' }, 'scan'),
        ] }, 'row'),
        replyText ? e('div', { style: { marginTop: 8, fontSize: 12, whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }, children: replyText }, 'replytext') : null,
      ] }, 'bili-replies')

      return e('div', { children: [
        e('div', { style: { ...lab, marginBottom: 8, fontSize: 12 }, children: '这些是环境参数，不是她的喜好。设置对所有鱼生效；配额与历史按鱼算。' }, 'top'),
        e('div', { className: 'fb-page', children: cards }, 'cards'),
        statusCard,
        historyCard,
        loginCard,
        speakCard,
        replyCard,
        runText ? e('div', { style: { ...box, fontSize: 12, whiteSpace: 'pre-wrap', maxHeight: 260, overflow: 'auto' }, children: runText }, 'run') : null,
        e('div', { style: rowS, children: [
          e('span', { style: { ...lab, fontSize: 12 }, children: msg || err }, 'm'),
          e('span', { style: { display: 'flex', gap: 8 }, children: [
            e('button', { style: { ...btnS, padding: '6px 14px' }, disabled: busy === 'run' || !cfg.enabled, onClick: run, children: busy === 'run' ? '出门中…' : '让她现在去刷一次' }, 'runbtn'),
            e('button', { style: { ...btnP, padding: '6px 16px', fontSize: 13 }, disabled: busy === 'save', onClick: save, children: busy === 'save' ? '保存中…' : '保存' }, 'save'),
          ] }, 'acts'),
        ] }, 'acts'),
      ] }, 'browse-panel')
    }

    /** 目录浏览器：只列目录、可新建文件夹。给「新建工作区」用。 */
  function FolderPicker({ start, onPick, onClose }) {
    const [cur, setCur] = useState(null)
    const [name, setName] = useState('')
    const [err, setErr] = useState('')
    const loadDir = useCallback(async (p) => {
      try {
        const r = await getJson(API + '/fs/dirs' + (p ? '?path=' + encodeURIComponent(p) : ''))
        setCur(r)
        setErr('')
      } catch (x) { setErr(String((x && x.message) || x)) }
    }, [])
    useEffect(() => { void loadDir(start || '') }, [loadDir, start])
    const mk = async () => {
      if (!cur) return
      try {
        const r = await postJson(API + '/fs/mkdir', { parent: cur.path, name })
        setName('')
        await loadDir(r.path)
      } catch (x) { setErr(String((x && x.message) || x)) }
    }
    return e('div', { style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center' }, onClick: onClose, children: [
      e('div', { style: { background: 'var(--dsw-alias-bg-1, #fff)', color: 'var(--dsw-alias-text-1, #222)', borderRadius: 14, padding: '18px 20px', width: 520, maxWidth: '94vw', boxShadow: '0 12px 40px rgba(0,0,0,0.28)' }, onClick: (ev) => ev.stopPropagation(), children: [
        e('div', { style: { fontWeight: 600, fontSize: 14, marginBottom: 8 }, children: '选一个文件夹' }, 'h'),
        e('div', { style: { display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }, children: (cur && cur.places || []).map((pl, i) => e('button', { style: { ...btnS, padding: '3px 9px', fontSize: 12 }, onClick: () => loadDir(pl.path), children: pl.label }, 'p' + i)) }, 'places'),
        e('div', { style: { ...lab, fontSize: 12, marginBottom: 6, wordBreak: 'break-all' }, children: (cur && cur.path) || '…' }, 'cur'),
        e('div', { style: { maxHeight: 240, overflow: 'auto', border: '1px solid var(--dsw-alias-border, #ddd)', borderRadius: 8, padding: 4 }, children: [
          (cur && cur.parent) ? e('button', { style: { ...btnS, padding: '4px 8px', fontSize: 12, marginBottom: 4 }, onClick: () => loadDir(cur.parent), children: '↑ 上一级' }, 'up') : null,
          ...((cur && cur.dirs) || []).map((d, i) => e('div', { key: 'd' + i, style: { padding: '5px 8px', fontSize: 13, cursor: 'pointer', borderRadius: 6 }, onClick: () => loadDir((cur.path + (cur.path.endsWith('\\') || cur.path.endsWith('/') ? '' : (navigator.platform.toLowerCase().includes('win') ? '\\' : '/'))) + d), children: '📁 ' + d }, 'd' + i)),
          (!cur || !cur.dirs || !cur.dirs.length) ? e('div', { style: { ...lab, fontSize: 12, padding: 6 }, children: '（没有子文件夹）' }, 'empty') : null,
        ] }, 'list'),
        e('div', { style: { display: 'flex', gap: 6, marginTop: 10 }, children: [
          e('input', { style: { ...inp, padding: '6px 9px', flex: 1 }, value: name, placeholder: '新文件夹名', onInput: (ev) => setName(ev.target.value) }, 'n'),
          e('button', { style: { ...btnS, padding: '5px 10px' }, onClick: mk, children: '新建文件夹' }, 'mk'),
        ] }, 'newrow'),
        err ? e('div', { style: { color: 'var(--dsw-alias-danger, #d33)', fontSize: 12.5, marginTop: 6 }, children: err }, 'err') : null,
        e('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }, children: [
          e('button', { style: { ...btnS, padding: '5px 14px' }, onClick: onClose, children: '取消' }, 'c'),
          e('button', { style: { ...btnP, padding: '6px 16px', fontSize: 13 }, onClick: () => { if (cur && cur.path) { onPick(cur.path); onClose() } }, children: '选这个文件夹' }, 'ok'),
        ] }, 'acts'),
      ] }, 'modal'),
    ] })
  }
  function Section() {
      const [data, setData] = useState(null)
      const [view, setView] = useState({ level: 'list' })
      const [err, setErr] = useState('')
      const [msg, setMsg] = useState('')
      const [growth, setGrowth] = useState(1)
      const [seedName, setSeedName] = useState('')
      const [seedBg, setSeedBg] = useState('')
      const [ws, setWs] = useState('')
      const [sess, setSess] = useState('')
      const [moveOpen, setMoveOpen] = useState(false)
      const [pick, setPick] = useState(null)
      const [pickWs, setPickWs] = useState(null)
      const [moveErr, setMoveErr] = useState('')
      const [newOpen, setNewOpen] = useState(false)
      const [newName, setNewName] = useState('')
      const [newErr, setNewErr] = useState('')
      const [newHouse, setNewHouse] = useState({ mode: 'new-session', id: '', path: '' })
      const [fp, setFp] = useState(null)
      const [cleanOpen, setCleanOpen] = useState(false)
      const [xf, setXf] = useState(null)
      const [cleanWs, setCleanWs] = useState('')
      const [cleanMsg, setCleanMsg] = useState('')
      const [nameInput, setNameInput] = useState('')
      const [delConfirm, setDelConfirm] = useState(false)
      const [routine, setRoutine] = useState(null)
      useEffect(() => { ensureStyle() }, [])

      const load = useCallback(async (attempt = 0) => {
        try {
          const d = await getJson(API + '/fish')
          setData(d)
          setSeedName(d.config.seed?.name ?? '')
          setSeedBg(d.config.seed?.background ?? '')
          setRoutine({ wake: d.config.wake ?? {}, contact: d.config.contact ?? {}, selfTime: d.config.selfTime ?? {}, affect: d.config.affect ?? {}, diary: d.config.diary ?? {} })
          setErr('')
        } catch (x) {
          setErr(String((x && x.message) || x))
          // 宿主的路由可能刚启动还没挂好：前几次自动重试
          if (attempt < 4) setTimeout(() => { void load(attempt + 1) }, 1500)
        }
      }, [])
      useEffect(() => { void load() }, [load])
      // 成长率是每条鱼自己的：看哪条鱼就显示哪条鱼的值，保存后刷新也是它
      useEffect(() => {
        if (!data || view.level !== 'fish') return
        const f0 = (data.fish || []).find((x) => x.id === view.id)
        if (f0 && typeof f0.config?.growth === 'number') setGrowth(f0.config.growth)
      }, [data, view.level, view.id])

      const fish = (data && data.fish) || []
      const selected = view.level === 'fish' ? fish.find((f) => f.id === view.id) : null
      const born = !!(data && data.born)

      const act = async (fn, okMsg) => {
        try { await fn(); setMsg(okMsg || ''); setErr(''); await load() }
        catch (x) { setErr(String((x && x.message) || x)); setMsg('') }
      }

      const openFish = (id) => {
        const f0 = ((data && data.fish) || []).find((x) => x.id === id)
        if (f0 && f0.config) { setRoutine({ wake: f0.config.wake ?? {}, contact: f0.config.contact ?? {}, selfTime: f0.config.selfTime ?? {}, affect: f0.config.affect ?? {}, diary: f0.config.diary ?? {} }); if (typeof f0.config.growth === 'number') setGrowth(f0.config.growth) }
        setView({ level: 'fish', id, page: 'home' }); setWs(''); setSess(''); setMsg(''); setMoveOpen(false); setPick(null)
      }

      // ---------- 列表 ----------
      if (view.level === 'list') {
        const allWs = (data && data.scopes && data.scopes.workspaces) || []

        return e('div', { className: 'fb', children: [
          e('div', { children: [
            e('div', { className: 'fb-title', children: 'fishbowl · 养的鱼' }, 't'),
            e('div', { className: 'fb-sub', children: '每条鱼都有自己的房间（一个会话），终身唯一。一个屋子可以住多条鱼；搬家会归档旧房间并新建一间房。' }, 'd'),
          ] }, 'head'),
          err ? e('div', { className: 'fb-error', children: err }, 'err') : null,
          (data && data.health && data.health.issues && data.health.issues.length)
            ? e('div', { style: { ...box, borderColor: 'var(--dsw-alias-warning, #c90)', background: 'rgba(255,200,0,0.10)', fontSize: 12.5 }, children: [
                e('div', { style: { fontWeight: 600, marginBottom: 4 }, children: 'fishbowl 配置可能不完整' }, 'hh'),
                ...data.health.issues.map((x, i) => e('div', { key: 'h' + i, style: { marginTop: 2 }, children: '· ' + x })),
                e('div', { style: { ...lab, fontSize: 11.5, marginTop: 6 }, children: '常见原因：DSH 设置页保存时重写了 profile 的 cordis.patch.yml，把 fishbowl 那段冲掉了。' }, 'hk'),
              ] }, 'health')
            : null,
          fish.length
            ? fish.map((f, i) => e(FishCard, { f, k: 'f' + i, onOpen: () => openFish(f.id) }))
            : e('div', { style: box, children: '还没有鱼。点下面「带一条新的回家」。' }, 'none'),
          e('div', { style: { ...rowS, marginTop: 8 }, children: [
            e('span', { style: lab, children: fish.length + ' 条' }, 'c'),
            e('button', { style: { ...btnP, padding: '7px 16px' }, onClick: () => { setNewOpen(true); setNewName(''); setNewErr(''); setNewHouse({ mode: 'new-session', id: '', path: '' }) }, children: '带一条新的回家' }, 'newbtn'),
            e('button', {
              style: { ...btnS, padding: '7px 14px', marginLeft: 8 },
              onClick: () => { setCleanOpen(true); setCleanWs(''); setCleanMsg('') },
              children: '清理空房间',
            }, 'cleanup'),
            e('button', { style: { ...btnS, padding: '7px 14px', marginLeft: 8 }, onClick: () => setXf({ mode: 'export', start: '' }), children: '导出' }, 'exportbtn'),
            e('button', { style: { ...btnS, padding: '7px 14px', marginLeft: 8 }, onClick: () => setXf({ mode: 'import', start: '' }), children: '导入' }, 'importbtn'),
          ] }, 'add'),
          fp ? e(FolderPicker, { start: fp.start, onPick: (p) => setNewHouse({ ...newHouse, path: p }), onClose: () => setFp(null) }, 'fp') : null,
          xf ? e(FolderPicker, {
            start: xf.start,
            onPick: async (dir) => {
              try {
                if (xf.mode === 'export') {
                  const r = await postJson(API + '/export', { path: dir })
                  window.alert('导出到：' + r.dir + '（' + r.count + ' 条鱼）')
                } else {
                  const r = await postJson(API + '/import', { path: dir })
                  await load()
                  const got = (r.imported || []).length
                  const placed = (r.housed || []).length
                  const skipped = (r.skipped || []).length
                  window.alert(
                    '导入 ' + got + ' 条鱼；这次新安置 ' + placed + ' 条' + (skipped ? '，跳过 ' + skipped + ' 条（已有房间）' : '') + '\n屋子：' + r.house,
                  )
                }
              } catch (x) { window.alert('失败：' + String((x && x.message) || x)) }
            },
            onClose: () => setXf(null),
          }, 'xf') : null,
          cleanOpen ? e('div', { style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }, onClick: () => setCleanOpen(false), children: [
            e('div', { style: { background: 'var(--dsw-alias-bg-1, #fff)', color: 'var(--dsw-alias-text-1, #222)', borderRadius: 14, padding: '20px 22px', width: 430, maxWidth: '92vw', boxShadow: '0 12px 40px rgba(0,0,0,0.25)' }, onClick: (ev) => ev.stopPropagation(), children: [
              e('div', { style: { fontWeight: 600, fontSize: 14, marginBottom: 6 }, children: '清理空房间' }, 'h'),
              e('div', { style: { ...lab, fontSize: 12, marginBottom: 10 }, children: '先选一个屋子：只会清理这个屋子里没有鱼住的房间（归档：侧边栏隐藏，文件保留）。' }, 'hint'),
              e('div', { style: { maxHeight: 280, overflow: 'auto', border: '1px solid var(--dsw-alias-border, #ddd)', borderRadius: 8, padding: 4 }, children: [
                ...allWs.map((w, i) => e('div', {
                  key: 'cw' + i,
                  style: { padding: '6px 9px', fontSize: 13, cursor: 'pointer', borderRadius: 6, background: cleanWs === w ? 'var(--dsw-alias-bg-2, #eef1f6)' : 'transparent' },
                  onClick: () => { setCleanWs(w); setCleanMsg('') },
                  children: (cleanWs === w ? '● ' : '▸ ') + wsName(data.scopes && data.scopes.workspaceNames, w) + '（' + w + '）',
                }, 'cw' + i)),
                !allWs.length ? e('div', { style: lab, children: '还没有见过工作区' }, 'nows') : null,
              ] }, 'list'),
              cleanMsg ? e('div', { style: { color: 'var(--dsw-alias-danger, #d33)', fontSize: 12.5, marginTop: 8 }, children: cleanMsg }, 'msg') : null,
              e('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }, children: [
                e('button', { style: { ...btnS, padding: '5px 14px' }, onClick: () => setCleanOpen(false), children: '取消' }, 'c'),
                e('button', { style: { ...btnP, padding: '6px 16px', fontSize: 13 }, onClick: async () => {
                  if (!cleanWs) { setCleanMsg('先选一个屋子'); return }
                  try {
                    const dry = await postJson(API + '/cleanup/rooms', { path: cleanWs, dryRun: true })
                    const cands = (dry.rooms && dry.rooms[0] && dry.rooms[0].candidates) || []
                    if (!cands.length) { setCleanMsg('这个屋子里没有需要清理的房间'); return }
                    const names = cands.map((c) => c.title || c.id.slice(0, 12)).join('、')
                    if (!window.confirm('这些房间会被归档（侧边栏隐藏，文件保留）：\n\n' + names + '\n\n继续？')) return
                    const done = await postJson(API + '/cleanup/rooms', { path: cleanWs, dryRun: false })
                    const n = ((done.rooms && done.rooms[0] && done.rooms[0].removed) || []).length
                    setCleanOpen(false)
                    await load()
                    window.alert('归档了 ' + n + ' 个房间。')
                  } catch (x) { setCleanMsg(String((x && x.message) || x)) }
                }, children: '开始清理' }, 'ok'),
              ] }, 'acts'),
            ] }, 'modal'),
          ] }) : null,
          newOpen ? e('div', { style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }, onClick: () => setNewOpen(false), children: [
            e('div', { style: { background: 'var(--dsw-alias-bg-1, #fff)', color: 'var(--dsw-alias-text-1, #222)', borderRadius: 14, padding: '20px 22px', width: 400, maxWidth: '92vw', boxShadow: '0 12px 40px rgba(0,0,0,0.25)' }, onClick: (ev) => ev.stopPropagation(), children: [
              e('div', { style: { fontWeight: 600, fontSize: 14, marginBottom: 12 }, children: '给新鱼起个名字' }, 'h'),
              e('input', { style: { ...inp, padding: '9px 12px', boxSizing: 'border-box' }, value: newName, placeholder: '例：大肥鱼', autofocus: true, onInput: (ev) => setNewName(ev.target.value) }, 'i'),
              e('div', { style: { ...lab, fontSize: 12, marginTop: 6 }, children: '名字是她的身份，之后只读（历史会被铭记）。' }, 'hint'),
              e('div', { style: { ...lab, fontSize: 12, marginTop: 10, marginBottom: 4 }, children: '屋子（必选）' }, 'hh'),
              e('select', {
                style: { ...inp, padding: '7px 10px', boxSizing: 'border-box', width: '100%' },
                value: newHouse.mode,
                onChange: (ev) => setNewHouse({ mode: ev.target.value, id: '', path: '' }),
                children: [
                  e('option', { value: 'new-session', children: '在现有屋子里新建一间房' }),
                  e('option', { value: 'new-both', children: '新建一个屋子 + 一间房' }),
                ],
              }, 'house-select'),
              (newHouse.mode === 'new-session') ? e('select', {
                style: { ...inp, padding: '7px 10px', boxSizing: 'border-box', width: '100%', marginTop: 6 },
                value: newHouse.id,
                onChange: (ev) => setNewHouse({ ...newHouse, id: ev.target.value }),
                children: [
                  e('option', { value: '', children: '选一个现有工作区' }),
                  ...allWs.map((w, i) => e('option', { value: w, children: wsName(data.scopes.workspaceNames, w) + '（' + w + '）' }, 'w' + i)),
                ],
              }, 'house-ws2') : null,
              (newHouse.mode === 'new-session') ? e('div', { style: { ...lab, fontSize: 11.5, marginTop: 4 }, children: '会在这个屋子里给她新建一间房，这间房只归她' }, 'house-hint2') : null,
              (newHouse.mode === 'new-both')
                ? e('div', { children: [
                    e('div', { style: { display: 'flex', gap: 6, marginTop: 6 }, children: [
                      e('input', { style: { ...inp, padding: '7px 10px', boxSizing: 'border-box', flex: 1 }, value: newHouse.path, placeholder: '目录，例：D:\\\\fish-home', onInput: (ev) => setNewHouse({ ...newHouse, path: ev.target.value }) }, 'house-path'),
                      e('button', { style: { ...btnS, padding: '6px 10px', whiteSpace: 'nowrap' }, onClick: () => setFp({ start: newHouse.path || '' }), children: '选择文件夹' }, 'house-pick'),
                    ] }),
                    e('div', { style: { ...lab, fontSize: 11.5, marginTop: 4 }, children: '会把这个目录登记成屋子，并在里面给她建一间房' }, 'house-hint'),
                  ] }, 'house-new')
                : null,
              newErr ? e('div', { style: { color: 'var(--dsw-alias-danger, #d33)', fontSize: 12.5, marginTop: 6 }, children: newErr }, 'e') : null,
              e('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }, children: [
                e('button', { style: { ...btnS, padding: '5px 14px' }, onClick: () => setNewOpen(false), children: '取消' }, 'c'),
                e('button', { style: { ...btnP, padding: '6px 16px', fontSize: 13 }, onClick: async () => {
                  const name = newName.trim()
                  if (!name) { setNewErr('先起个名字'); return }
                  try {
                    if (newHouse.mode === 'new-session' && !newHouse.id) { setNewErr('先选一个屋子'); return }
                    if (newHouse.mode === 'new-both' && !newHouse.path.trim()) { setNewErr('先选一个目录'); return }
                    const housing = newHouse.mode === 'new-both'
                      ? { kind: 'new-both', path: newHouse.path }
                      : { kind: 'new-session', workspace: newHouse.id }
                    await postJson(API + '/fish', { name, housing })
                    setNewOpen(false); setNewName(''); setNewErr(''); setNewHouse({ mode: 'new-session', id: '', path: '' })
                    await load()
                  } catch (x) { setNewErr(String((x && x.message) || x)) }
                }, children: '创建' }, 'ok'),
              ] }, 'acts'),
            ] }, 'modal'),
          ] }) : null,
        ] }, 'root')
      }

      // ---------- 单条鱼 ----------
      if (!selected) return e('div', { style: box, children: '这条鱼不见了，回去重新看看。' }, 'gone')
      const f = selected
      const page = view.page || 'status'
      const setPage = (p) => setView({ ...view, page: p })
      const caps = (f.config && f.config.capabilities) || {}
      const tabs = [
        ['status', '状态'], ['home', '住所'], ['routine', '作息'],
        ...(caps.browse === false ? [] : [['browse', '上网']]),
        ['persona', '人设'], ['memory', '记忆'],
      ]

      function renderStatus() {
        const capRow = (key, label) => e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }, children: [
          e('span', { style: { fontSize: 12.5 }, children: label }, 'l'),
          e('button', { style: caps[key] === false ? btnS : { ...btnP, padding: '3px 12px', fontSize: 12 }, onClick: () => act(async () => {
            const next = { browse: caps.browse !== false }
            next[key] = caps[key] === false
            await postJson(API + '/fish/' + f.id + '/config', { capabilities: next })
          }, '能力已更新'), children: caps[key] === false ? '关' : '开' }, key),
        ] }, key + 'row')
        const capRows = [capRow('browse', '上网（看视频、在 B 站说话）')]
        const mem = f.memory || {}
        const lines = []
        if (mem.semantics?.length) lines.push('记得: ' + mem.semantics.join('；'))
        if (mem.procedures?.length) lines.push('教训: ' + mem.procedures.join('；'))
        if (mem.self?.length) lines.push('自我认知: ' + mem.self.join('；'))
        if (mem.commitments?.length) lines.push('承诺: ' + mem.commitments.join('；'))
        if (mem.activity) lines.push('一起在做: ' + mem.activity)
        if (mem.folded) lines.push('记不清的旧事: ' + mem.folded + ' 件')
        return e('div', { children: [
          e('div', { style: box, children: [
            e('div', { style: { ...lab, marginBottom: 4 }, children: occText(f.occupancy) }, 'o'),
            e('div', { style: lab, children: '效价 ' + fmt(f.affect.v) + ' · 唤醒 ' + fmt(f.affect.a) + ' · 愧疚 ' + fmt(f.affect.guilt) + ' · 想念 ' + fmt(f.affect.longing) + ' · ' + f.episodes + ' 轮' }, 'a'),
          ] }, 's'),
          e('div', { style: box, children: lines.length
            ? lines.map((l, i) => e('div', { style: { fontSize: 12.5, lineHeight: 1.8 }, children: l }, 'l' + i))
            : e('div', { style: lab, children: '还没有记忆（聊几轮后会开始巩固）' }) }, 'm'),
          e('div', { style: box, children: [
            e('div', { style: { fontWeight: 600, fontSize: 13.5, marginBottom: 4 }, children: '能力' }, 'h'),
            e('div', { style: { ...lab, marginBottom: 8 }, children: '关掉后她拿不到上网的工具，设置页也不再显示「上网」页。记忆不是能力，不能关。' }, 'hint'),
            ...capRows,
          ] }, 'caps'),
        ] }, 'status')
      }

      function renderRoutine() {
        const r = routine || { wake: {}, contact: {}, selfTime: {} }
        const wake = r.wake || {}
        const contact = r.contact || {}
        const selfTime = r.selfTime || {}
        const setWake = (k, v) => setRoutine({ ...r, wake: { ...wake, [k]: v } })
        const setContact = (k, v) => setRoutine({ ...r, contact: { ...contact, [k]: v } })
        const diary = r.diary || {}
        const setDiary = (k, v) => setRoutine({ ...r, diary: { ...diary, [k]: v } })
        const affectCfg = r.affect || {}
        const setAffect = (k, v) => setRoutine({ ...r, affect: { ...affectCfg, [k]: v } })
        const setSelf = (k, v) => setRoutine({ ...r, selfTime: { ...selfTime, [k]: v } })
        const timeInput = (val, onChange, key) => e('input', { key, type: 'time', style: { ...inp, width: 112 }, value: val ?? '00:00', onInput: (ev) => onChange(ev.target.value) }, key)
        const numInput = (val, onChange, key, min, max) => e('input', { key, type: 'number', min: String(min), max: String(max), style: { ...inp, width: 84 }, value: val ?? 0, onInput: (ev) => onChange(Number(ev.target.value)) }, key)
        // 最近一次检查：她为什么没开口
        const ws = (data && data.wakeState) || null
        const entry = ws && Array.isArray(ws.entries) ? (ws.entries.find(x => x.creature === f.name) || ws.entries[0]) : null
        const gateLabel = { ok: '可以开口', no_reason: '没有由头', quiet_hours: '不在时段', daily_max: '今天次数用完', min_gap: '离上次太近', burst: '短时间太多', unanswered_stop: '连发没回', disabled: '自处没开', browse_quota: '今天上网次数用完', busy: '正在说话' }
        const lastCheck = entry ? new Date(entry.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '—'
        const selfLine = entry?.self
          ? ' · 自处：' + (entry.self.enabled ? (gateLabel[entry.self.gate?.reason] || entry.self.gate?.reason || '—') + `（今天上网 ${entry.self.usedToday}/${entry.self.perDay}）` : '没开')
          : ''
        const statusLine = entry
          ? '最近检查 ' + lastCheck + '：想念 ' + entry.longing + '（要 >0.4） · 未完成承诺 ' + entry.broken + ' · ' + (gateLabel[entry.gate?.reason] || entry.gate?.reason || '—') + (entry.live === false ? ' · 会话没开（她叫不醒，联系会进待送）' : '') + selfLine
          : '还没有检查记录（节律没开或刚启动）'
        const statusCard = e('div', { style: box, children: [
          e('div', { style: { ...rowS, marginBottom: 4 }, children: [
            e('div', { style: { fontWeight: 600, fontSize: 13.5 }, children: '现在的状态' }, 'h'),
            e('span', { style: { display: 'flex', gap: 6 }, children: [
              e('button', { style: { ...btnS, padding: '3px 12px' }, onClick: () => act(async () => {
                const r = await postJson(API + '/wake/now', {})
                setMsg('她开口了：' + (r.text || ''))
              }, '已叫她一次'), children: '叫一次（联系）' }, 'now'),
              e('button', { style: { ...btnS, padding: '3px 12px' }, onClick: () => act(async () => {
                const r = await postJson(API + '/wake/now', { mode: 'self' })
                setMsg('她醒了：' + (r.text || ''))
              }, '让她自己待了一会儿'), children: '自己待一会儿（测试）' }, 'selfnow'),
            ] }, 'btns'),
          ] }, 'head'),
          e('div', { style: { ...lab, fontSize: 12 }, children: statusLine }, 'line'),
        ] }, 'wstatus')
        return e('div', { children: [
          e('div', { style: box, children: [
            e('div', { style: { ...rowS, marginBottom: 4 }, children: [
              e('div', { style: { fontWeight: 600, fontSize: 13.5 }, children: '清醒节律' }, 'h'),
              e(Toggle, { on: wake.enabled, onChange: () => setWake('enabled', !wake.enabled), k: 'sw' }),
            ] }, 'head'),
            e('div', { style: { ...lab, marginBottom: 10 }, children: '打开后她会按间隔醒来；只有有由头（还没做完的承诺、很久没说话）才开口，否则继续睡。活动时段之外算睡着：不想念，也不会来叫你。' }, 'hint'),
            e('div', { style: { ...rowS, marginBottom: 6 }, children: [
              e('span', { style: lab, children: '活动时段' }, 'l'),
              e('span', { style: { display: 'flex', gap: 6, alignItems: 'center' }, children: [
                timeInput((wake.activeWindow ?? [])[0], (v) => setWake('activeWindow', [v, (wake.activeWindow ?? [])[1] ?? '23:30']), 'a'),
                e('span', { style: lab, children: '到' }, 'sep'),
                timeInput((wake.activeWindow ?? [])[1], (v) => setWake('activeWindow', [(wake.activeWindow ?? [])[0] ?? '08:00', v]), 'b'),
              ] }, 'w'),
            ] }, 'r1'),
            e('div', { style: { ...rowS, marginBottom: 6 }, children: [
              e('span', { style: lab, children: '间隔' }, 'l'),
              e('span', { style: { display: 'flex', gap: 6, alignItems: 'center' }, children: [
                e('select', { style: { ...inp, width: 92 }, value: wake.interval?.mode ?? 'fixed', onInput: (ev) => setWake('interval', { ...(wake.interval || {}), mode: ev.target.value }), children: [e('option', { value: 'fixed', children: '固定' }), e('option', { value: 'random', children: '随机' })] }, 'm'),
                e('input', { style: { ...inp, width: 76 }, value: wake.interval?.min ?? '60m', placeholder: '60m', onInput: (ev) => setWake('interval', { ...(wake.interval || {}), min: ev.target.value }) }, 'min'),
                (wake.interval?.mode === 'random') ? e('input', { style: { ...inp, width: 76 }, value: wake.interval?.max ?? '', placeholder: '120m', onInput: (ev) => setWake('interval', { ...(wake.interval || {}), max: ev.target.value }) }, 'max') : null,
              ] }, 'v'),
            ] }, 'r2'),

          ] }, 'wake'),
          e('div', { style: box, children: [
            e('div', { style: { ...rowS, marginBottom: 4 }, children: [
              e('div', { style: { fontWeight: 600, fontSize: 13.5 }, children: '自己待一会儿' }, 'h'),
              e(Toggle, { on: selfTime.enabled, onChange: () => setSelf('enabled', !selfTime.enabled), k: 'sw' }),
            ] }, 'head'),
            e('div', { style: { ...lab, marginBottom: 10 }, children: '醒来但不为了找你。她可以上网、写日记，也可以什么都不做；不算主动联系配额。他若说过「没事可以刷刷 B 站」，且上网开关开着，即使这里关着，也会为这条许可醒一次。' }, 'hint'),
            e('div', { style: { ...rowS, marginBottom: 6 }, children: [
              e('span', { style: lab, children: '时段' }, 'l'),
              e('span', { style: { display: 'flex', gap: 6, alignItems: 'center' }, children: [
                timeInput((selfTime.window ?? [])[0], (v) => setSelf('window', [v, (selfTime.window ?? [])[1] ?? '23:00']), 'sa'),
                e('span', { style: lab, children: '到' }, 'sep'),
                timeInput((selfTime.window ?? [])[1], (v) => setSelf('window', [(selfTime.window ?? [])[0] ?? '09:00', v]), 'sb'),
              ] }, 'v'),
            ] }, 's1'),
            e('div', { style: { ...rowS, marginBottom: 6 }, children: [
              e('span', { style: lab, children: '每天最多' }, 'l'),
              e('span', { style: { display: 'flex', gap: 6, alignItems: 'center' }, children: [
                numInput(selfTime.dailyMax ?? 1, (v) => setSelf('dailyMax', v), 'n', 0, 6),
                e('span', { style: lab, children: '次' }, 'u'),
              ] }, 'v'),
            ] }, 's2'),
            e('div', { style: rowS, children: [
              e('span', { style: lab, children: '最短间隔' }, 'l'),
              e('input', { style: { ...inp, width: 90 }, value: selfTime.minGap ?? '90m', onInput: (ev) => setSelf('minGap', ev.target.value) }, 'v'),
            ] }, 's3'),
          ] }, 'self'),
          e('div', { style: box, children: [
            e('div', { style: { fontWeight: 600, fontSize: 13.5, marginBottom: 4 }, children: '主动联系' }, 'h'),
            e('div', { style: { ...lab, marginBottom: 10 }, children: '去敲你之前要过这几道闸；没必要的联系不如不联系。' }, 'hint'),
            e('div', { style: { ...rowS, marginBottom: 6 }, children: [
              e('span', { style: lab, children: '时段' }, 'l'),
              e('span', { style: { display: 'flex', gap: 6, alignItems: 'center' }, children: [
                timeInput((contact.window ?? [])[0], (v) => setContact('window', [v, (contact.window ?? [])[1] ?? '22:30']), 'a'),
                e('span', { style: lab, children: '到' }, 'sep'),
                timeInput((contact.window ?? [])[1], (v) => setContact('window', [(contact.window ?? [])[0] ?? '09:00', v]), 'b'),
              ] }, 'v'),
            ] }, 'c1'),
            e('div', { style: { ...rowS, marginBottom: 6 }, children: [
              e('span', { style: lab, children: '每天最多' }, 'l'),
              e('span', { style: { display: 'flex', gap: 6, alignItems: 'center' }, children: [
                numInput(contact.dailyMax ?? 2, (v) => setContact('dailyMax', v), 'n', 0, 10),
                e('span', { style: lab, children: '次' }, 'u'),
              ] }, 'v'),
            ] }, 'c2'),
            e('div', { style: { ...rowS, marginBottom: 6 }, children: [
              e('span', { style: lab, children: '最短间隔' }, 'l'),
              e('input', { style: { ...inp, width: 90 }, value: contact.minGap ?? '3h', onInput: (ev) => setContact('minGap', ev.target.value) }, 'v'),
            ] }, 'c3'),
            e('div', { style: { ...rowS }, children: [
              e('span', { style: lab, children: '连发没回就停' }, 'l'),
              e('span', { style: { display: 'flex', gap: 6, alignItems: 'center' }, children: [
                numInput(contact.unansweredStop ?? 3, (v) => setContact('unansweredStop', v), 'n', 1, 10),
                e('span', { style: lab, children: '次' }, 'u'),
              ] }, 'v'),
            ] }, 'c4'),
          ] }, 'contact'),
          e('div', { style: box, children: [
            e('div', { style: { fontWeight: 600, fontSize: 13.5, marginBottom: 4 }, children: '日记' }, 'h'),
            e('div', { style: { ...lab, marginBottom: 10 }, children: '日记是一天的最后一件事。这个时间窗之外不写；第二天发现昨天的还没写，会先补昨天的。' }, 'hint'),
            e('div', { style: { ...rowS, marginBottom: 6 }, children: [e('span', { style: lab, children: '每天写日记的时间' }, 'l'), e('span', { style: { display: 'flex', gap: 6, alignItems: 'center' }, children: [timeInput(diary.start ?? '21:30', (v) => setDiary('start', v), 's'), e('span', { style: lab, children: '到' }, 'sep'), timeInput(diary.end ?? '23:59', (v) => setDiary('end', v), 'e')] }, 'v')] }, 'd1'),
            e('div', { style: rowS, children: [e('span', { style: lab, children: '第二天补写昨天' }, 'l'), e('button', { style: diary.catchUp !== false ? { ...btnP, padding: '3px 12px', fontSize: 12 } : btnS, onClick: () => setDiary('catchUp', diary.catchUp === false), children: diary.catchUp !== false ? '开' : '关' }, 'd2')] }, 'd3'),
          ] }, 'diary'),
          e('div', { style: box, children: [
            e('div', { style: { fontWeight: 600, fontSize: 13.5, marginBottom: 4 }, children: '心情半衰期' }, 'h'),
            e('div', { style: { ...lab, marginBottom: 10 }, children: '负面情绪会随时间淡下去。半衰期越短，忘得越快；正面状态（温暖、好奇）不在这里调。想念相反：你不理她会慢慢涨上来，见了面就回落。' }, 'hint'),
            e('div', { style: { ...rowS, marginBottom: 6 }, children: [e('span', { style: lab, children: '愧疚' }, 'l'), e('span', { style: { display: 'flex', gap: 6, alignItems: 'center' }, children: [numInput(affectCfg.guiltDays ?? 3, (v) => setAffect('guiltDays', v), 'a', 0.1, 60), e('span', { style: lab, children: '天' }, 'u')] }, 'v')] }, 'a1'),
            
            e('div', { style: rowS, children: [e('span', { style: lab, children: '负面情绪（警惕、烦躁）' }, 'l'), e('span', { style: { display: 'flex', gap: 6, alignItems: 'center' }, children: [numInput(affectCfg.negativeDays ?? 2, (v) => setAffect('negativeDays', v), 'c', 0.1, 60), e('span', { style: lab, children: '天' }, 'u')] }, 'v')] }, 'a3'),
          ] }, 'affect'),
          statusCard,
          e('div', { style: rowS, children: [
            e('span', { style: { ...lab, fontSize: 12 }, children: msg }, 'm'),
            e('button', { style: { ...btnP, padding: '6px 16px', fontSize: 13 }, onClick: () => act(async () => {
              await postJson(API + '/fish/' + f.id + '/config', { wake, contact, selfTime, affect: affectCfg, diary })
            }, '作息已保存'), children: '保存' }, 'save'),
          ] }, 'act'),
        ] }, 'routine')
      }

      function renderBrowse() {
        return e(BrowsePanel, { fish: f }, 'browse-panel')
      }

      function renderPersona() {
        const isDefaultName = /^fish-/.test(f.name)
        return e('div', { children: [
          born ? e('div', { style: { ...lab, marginBottom: 8 }, children: '她已经出生了：来历只读（历史会被铭记，只能说服，不能修改）。' }, 'born') : null,
          isDefaultName ? e('div', { style: box, children: [
            e('div', { style: { ...lab, marginBottom: 6 }, children: '这条鱼还没有名字（创建时没写上）。现在给她起一个：' }, 'h'),
            e('div', { style: { display: 'flex', gap: 8 }, children: [
              e('input', { style: { ...inp, flex: 1 }, value: nameInput, placeholder: '例：大肥鱼', onInput: (ev) => setNameInput(ev.target.value) }, 'i'),
              e('button', { style: { ...btnP, padding: '6px 14px', fontSize: 13 }, onClick: () => act(async () => {
                await postJson(API + '/fish/' + f.id + '/name', { name: nameInput.trim() })
                setNameInput('')
              }, '名字定下了') , children: '改名' }, 'ok'),
            ] }, 'row'),
          ] }, 'namebox') : null,
          e('div', { style: box, children: [

            e('div', { style: { ...lab, marginBottom: 6 }, children: '来历（一两句话；越具体，涌现越少）' }, 'l2'),
            e('textarea', { style: { ...inp, minHeight: 64, resize: 'vertical', opacity: born ? 0.5 : 1 }, value: seedBg, disabled: born, onInput: (ev) => setSeedBg(ev.target.value) }, 't'),
          ] }, 'seed'),
          e('div', { style: box, children: [
            e('div', { style: { ...rowS, marginBottom: 4 }, children: [
              e('span', { style: lab, children: '成长率' }, 'l'),
              e('span', { style: { fontSize: 12, color: 'var(--dsw-alias-text-2, #666)' }, children: growth.toFixed(2) + ' · 学得快也忘得快' }, 'v'),
            ] }, 'r'),
            e('input', { type: 'range', min: '0.25', max: '4', step: '0.05', value: growth, style: { width: '100%' }, onInput: (ev) => setGrowth(Number(ev.target.value)) }, 's'),
          ] }, 'growth'),
          e('div', { style: rowS, children: [
            e('span', { style: { ...lab, fontSize: 12 }, children: msg }, 'm'),
            e('button', { style: btnP, onClick: () => act(async () => {
              const body2 = born ? { growth } : { growth, seed: { name: seedName, background: seedBg } }
              await postJson(API + '/fish/' + f.id + '/config', body2)
            }, born ? '成长率已保存' : '已保存：来历从新出生的鱼开始生效'), children: '保存' }),
          ] }, 'act'),
          e('div', { style: { ...box, marginTop: 4 }, children: [
            e('div', { style: { ...lab, marginBottom: 6 }, children: '放生会删掉她的全部记忆和日记，不可恢复。' }, 'h'),
            delConfirm
              ? e('div', { style: { display: 'flex', gap: 8, alignItems: 'center' }, children: [
                  e('span', { style: { ...lab, color: 'var(--dsw-alias-danger, #d33)' }, children: '确定？' }, 'q'),
                  e('button', { style: { ...btnS, color: 'var(--dsw-alias-danger, #d33)' }, onClick: () => act(async () => {
                    await postJson(API + '/fish/' + f.id + '/delete')
                    setDelConfirm(false)
                    setView({ level: 'list' })
                  }, '放生了') , children: '确定放生' }, 'yes'),
                  e('button', { style: btnS, onClick: () => setDelConfirm(false), children: '算了' }, 'no'),
                ] }, 'confirm')
              : e('button', { style: { ...btnS, fontSize: 12, color: 'var(--dsw-alias-danger, #d33)' }, onClick: () => setDelConfirm(true), children: '放生这条鱼' }, 'del'),
          ] }, 'danger'),
        ] }, 'persona')
      }

      function renderMemory() {
        const memCfg = (f.config && f.config.memory) || (data.config && data.config.memory) || null
        return e('div', { children: [
          e(MemoryConfigCard, { cfg: memCfg, fishId: f.id }, 'mcfg'),
          e(MemoryDetail, { fishId: f.id }, 'mdet'),
        ] }, 'memory')
      }

      function renderHome() {
        const workspaces = (data.scopes && data.scopes.workspaces) || []
        const sessions = (data.scopes && data.scopes.sessions) || []
        const occupiedWs = {}     // 整个屋子被占（workspace 级）
        const occupiedSess = {}   // 单个房间被占（session 级）
        const sessInWs = {}       // 屋子下有房间被占（只影响「整个屋子」那行）
        for (const g of fish) {
          const o = g.occupancy
          if (!o) continue
          if (o.kind === 'workspace') occupiedWs[o.id] = g.name
          else {
            occupiedSess[o.id] = g.name
            if (o.workspace) { sessInWs[o.workspace] = sessInWs[o.workspace] || []; sessInWs[o.workspace].push(g.name) }
          }
        }
        const base = (p) => (p ? (p.split(/[\\/]/).filter(Boolean).pop() || '') : '')
        const wsPath = f.occupancy ? (f.occupancy.kind === 'workspace' ? f.occupancy.id : (f.occupancy.workspace || '')) : ''
        const roomName = !f.occupancy ? '未分配' : f.occupancy.kind === 'workspace' ? '整个屋子（所有会话）' : f.occupancy.id

        const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }
        const modal = { background: 'var(--dsw-alias-bg-1, #fff)', color: 'var(--dsw-alias-text-1, #222)', borderRadius: 12, padding: 16, width: 620, maxWidth: '92vw', maxHeight: '72vh', overflow: 'auto', boxShadow: '0 12px 40px rgba(0,0,0,0.25)' }
        const col = { flex: 1, minWidth: 0, border: '1px solid var(--dsw-alias-border, rgba(127,127,127,0.2))', borderRadius: 10, padding: 8, maxHeight: '44vh', overflow: 'auto' }
        const node = (label, disabled, active, onClick, key) => e('div', {
          key,
          style: {
            padding: '7px 9px', borderRadius: 8, marginBottom: 4, fontSize: 13,
            cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.45 : 1,
            background: active ? 'var(--dsw-alias-bg-2, rgba(127,127,127,0.16))' : 'transparent',
            fontWeight: active ? 600 : 400, wordBreak: 'break-all',
          },
          onClick: () => { if (!disabled) onClick() },
          children: label,
        })
        const roomsOf = (w) => sessions.filter((s2) => samePath(s2.workspace, w))
        // 占用判定要把"自己"排除：这屋子只有她住时，她可以重新选这个屋子
        const wsOthers = (w) => {
          const owner = occupiedWs[w]
          const rooms = (sessInWs[w] || []).filter((n) => n !== f.name)
          return { owner: owner && owner !== f.name ? owner : null, rooms, mine: owner === f.name }
        }
        const wsBlocked = (w) => { const o = wsOthers(w); return !!(o.owner || o.rooms.length) }
        const wsWhy = (w) => {
          const o = wsOthers(w)
          if (o.owner) return '（' + o.owner + ' 已住）'
          if (o.rooms.length) return '（有房间住着 ' + o.rooms[0] + '）'
          if (o.mine) return '（你现在住这）'
          return ''
        }

        const moveModal = moveOpen ? e('div', { style: overlay, onClick: () => { setMoveOpen(false); setPickWs(null); setMoveErr('') }, children: [
          e('div', { style: modal, onClick: (ev) => ev.stopPropagation(), children: [
            e('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }, children: [
              e('div', { style: { fontWeight: 600, fontSize: 14 }, children: '换房间 · ' + f.name }, 't'),
              e('button', { style: { ...btnS, padding: '2px 9px' }, onClick: () => { setMoveOpen(false); setPickWs(null); setMoveErr('') }, children: '×' }, 'x'),
            ] }, 'hdr'),
            e('div', { style: { ...lab, fontSize: 12, marginBottom: 8 }, children: '选一个新屋子：会在里面给她新建一间房。旧房间会被归档（侧边栏不再显示，记录保留），新的这间房只归她。' }, 'hint'),
            e('div', { style: { maxHeight: 260, overflow: 'auto' }, children: [
              ...workspaces.map((w, i) => node(
                (pickWs === w ? '● ' : '▸ ') + wsName(data.scopes && data.scopes.workspaceNames, w),
                false,
                pickWs === w,
                () => { setMoveErr(''); setPickWs(w) },
                'w' + i)),
              !workspaces.length ? e('div', { style: lab, children: '还没有见过工作区' }, 'nows') : null,
            ] }, 'left'),
            moveErr ? e('div', { style: { color: 'var(--dsw-alias-danger, #d33)', fontSize: 12.5, marginTop: 10 }, children: moveErr }, 'merr') : null,
            e('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }, children: [
              e('span', { style: { ...lab, fontSize: 12 }, children: pickWs ? '新屋子：' + (wsName(data.scopes && data.scopes.workspaceNames, pickWs) || base(pickWs)) : '还没选' }, 'sel'),
              e('div', { style: { display: 'flex', gap: 8 }, children: [
                e('button', { style: { ...btnS, padding: '5px 14px' }, onClick: () => { setMoveOpen(false); setPickWs(null); setMoveErr('') }, children: '取消' }, 'c'),
                e('button', { style: { ...btnP, opacity: pickWs ? 1 : 0.5, cursor: pickWs ? 'pointer' : 'not-allowed', fontSize: 13, padding: '6px 16px' }, onClick: async () => {
                  if (!pickWs) return
                  try {
                    await postJson(API + '/fish/' + f.id + '/move', { workspace: pickWs })
                    setMoveOpen(false); setPickWs(null); setMoveErr('')
                    await load()
                  } catch (x) { setMoveErr(String((x && x.message) || x)) }
                }, children: '换过去' }, 'ok'),
              ] }, 'acts'),
            ] }, 'foot'),
          ] }, 'modal'),
        ] }) : null

        return e('div', { children: [
          e('div', { style: box, children: [
            e('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 6 }, children: [
              e('div', { style: { fontWeight: 600, fontSize: 14 }, children: f.name + '的房间' }, 'rn'),
              e('div', { style: { display: 'flex', gap: 6 }, children: [
                e('button', { style: { ...btnS, fontSize: 12, padding: '3px 12px', fontWeight: 500 }, onClick: () => { setMoveOpen(true); setPick(null); setPickWs(null); setMoveErr('') }, children: '搬家' }),
              ] }, 'btns'),
            ] }, 'head'),
            e('div', { style: { display: 'grid', gridTemplateColumns: '52px 1fr', rowGap: 4, fontSize: 12.5, marginBottom: 4 }, children: [
              e('div', { style: { color: 'var(--dsw-alias-text-3, #999)' }, children: '屋子' }, 'wl'),
              e('div', { style: { wordBreak: 'break-all' }, children: wsPath ? base(wsPath) : '—' }, 'wv'),
              e('div', { style: { color: 'var(--dsw-alias-text-3, #999)' }, children: '房间' }, 'rl'),
              e('div', { style: { wordBreak: 'break-all' }, children: (roomName === '整个屋子（所有会话）' || roomName === '未分配') ? roomName : shortId(roomName) }, 'rv'),
            ] }, 'occ'),
            e('div', { style: { ...lab, fontSize: 12 }, children: f.episodes + ' 轮 · 身份文件 ' + (f.metaBytes || 0) + ' 字节' }, 'meta'),
          ] }, 'room'),
          moveModal,
          e('div', { style: box, children: [
            e('div', { style: { fontWeight: 600, fontSize: 13.5, marginBottom: 6 }, children: '她的请求' }, 'reqh'),
            e('div', { style: { ...lab, marginBottom: 8 }, children: '她有事想征求你同意时会提请求。一天最多一次，一周最多三次；没答的可以在这里补答。' }, 'reqhint'),
            (f.requests || []).length
              ? f.requests.map((r, i) => e('div', { key: 'r' + i, style: { marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid var(--dsw-alias-border, rgba(127,127,127,0.12))' }, children: [
                  e('div', { style: { fontSize: 13 }, children: r.text }, 'tx'),
                  r.answer === null
                    ? e('div', { style: { display: 'flex', gap: 8, marginTop: 6 }, children: [
                        e('button', { style: btnS, onClick: () => act(async () => { await postJson(API + '/fish/' + f.id + '/requests/' + r.id + '/answer', { answer: 'yes' }) }, '答应了'), children: '同意' }),
                        e('button', { style: btnS, onClick: () => act(async () => { await postJson(API + '/fish/' + f.id + '/requests/' + r.id + '/answer', { answer: 'no' }) }, '拒绝了'), children: '不同意' }),
                      ] }, 'ans')
                    : e('div', { style: { ...lab, marginTop: 4 }, children: r.answer === 'yes' ? '已同意' : '已拒绝' }, 'done'),
                ] }, 'r'))
              : e('div', { style: lab, children: '现在没有等你答的' }),
          ] }, 'req'),
          e('div', { style: box, children: [
            e('div', { style: { fontWeight: 600, fontSize: 13.5, marginBottom: 6 }, children: '日记' }, 'diaryh'),
            e('div', { style: { ...lab, marginBottom: 8 }, children: '每天一篇，写下今天发生的事和心情。多天的日记会攒在这里。' }, 'diaryhint'),
            (f.diary || []).length
              ? f.diary.map((d, i) => e('div', { style: { marginBottom: 10 }, children: [
                  e('div', { style: { ...lab, marginBottom: 2 }, children: d.date }, 'dt'),
                  e('div', { style: { fontSize: 13, whiteSpace: 'pre-wrap' }, children: d.text }, 'tx'),
                ] }, 'd' + i))
              : e('div', { style: lab, children: '还没写过日记' }),
          ] }, 'diary'),
          e('div', { style: box, children: [
            e('div', { style: { fontWeight: 600, fontSize: 13.5, marginBottom: 6 }, children: '小纸条' }, 'noteh'),
            e('div', { style: { ...lab, marginBottom: 8 }, children: '特意留给你的话，代表她当前的状态，可能藏着关键信息。' }, 'notehint'),
            (f.notes || []).length
              ? f.notes.map((n, i) => e('div', { style: { marginBottom: 8, fontSize: 13 }, children: '「' + n.text + '」' }, 'n' + i))
              : e('div', { style: lab, children: '还没有小纸条' }),
          ] }, 'notes'),
        ] }, 'home-root')
      }

      let body = null
      if (page === 'status') {
        body = renderStatus()
      } else if (page === 'home') {
        body = renderHome()
      } else if (page === 'routine') {
        body = renderRoutine()
      } else if (page === 'browse') {
        body = renderBrowse()
      } else if (page === 'persona') {
        body = renderPersona()
      } else if (page === 'memory') {
        body = renderMemory()
      }

      return e('div', { className: 'fb', children: [
        e('div', { className: 'fb-head', children: [
          e('div', { children: [
            e('div', { className: 'fb-title', children: f.name }, 'n'),
            e('div', { className: 'fb-sub', children: (f.occupancy ? occText(f.occupancy) : '还没安排住处') + ' · ' + f.episodes + ' 轮' }, 's'),
          ] }, 'title'),
          e('button', { style: btnS, onClick: () => setView({ level: 'list' }) , children: '← 所有鱼' }),
        ] }, 'hdr'),
        e('div', { className: 'fb-tabs', children: tabs.map(([id, label]) =>
          e('button', { key: id, type: 'button', className: 'fb-tab' + (id === page ? ' on' : ''), onClick: () => setPage(id), children: label })) }, 'tabs'),
        err ? e('div', { className: 'fb-error', children: err }, 'err') : null,
        body,
      ] }, 'root')
    }

    const name = 'fishbowl'
    const inject = ['slots', 'locale']

    /** 她有问题时，在页面右下角直接问，不用打开设置页。 */
    function mountRequestToast(ctx) {
      if (typeof document === 'undefined') return
      const box = document.createElement('div')
      box.id = 'fishbowl-toast'
      box.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:9999;display:flex;flex-direction:column;gap:8px;max-width:360px'
      document.body.appendChild(box)
      let timer = null
      let disposed = false

      const answer = async (fishId, reqId, yes) => {
        try {
          await postJson(API + '/fish/' + fishId + '/requests/' + reqId + '/answer', { answer: yes ? 'yes' : 'no' })
        } catch { /* 下一轮再试 */ }
        void refresh()
      }

      const card = (f, r) => {
        const el = document.createElement('div')
        el.style.cssText = 'background:var(--dsw-alias-bg-1,#fff);color:var(--dsw-alias-text-1,#222);border:1px solid var(--dsw-alias-border,#ddd);border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,0.18);padding:12px 14px'
        const t = document.createElement('div')
        t.style.cssText = 'font-size:12.5px;line-height:1.5;margin-bottom:8px;white-space:pre-wrap'
        t.textContent = f.name + '：' + String(r.text || '')
        const row = document.createElement('div')
        row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end'
        const mk = (label, primary, fn) => {
          const b = document.createElement('button')
          b.textContent = label
          b.style.cssText = 'font-size:12.5px;padding:4px 12px;border-radius:8px;cursor:pointer;border:1px solid '
            + (primary ? 'transparent' : 'var(--dsw-alias-border,#ccc)')
            + ';background:' + (primary ? 'var(--dsw-alias-accent,#3b82f6)' : 'transparent')
            + ';color:' + (primary ? '#fff' : 'inherit')
          b.onclick = fn
          return b
        }
        row.appendChild(mk('不同意', false, () => answer(f.id, r.id, false)))
        row.appendChild(mk('同意', true, () => answer(f.id, r.id, true)))
        el.appendChild(t)
        el.appendChild(row)
        return el
      }

      const refresh = async () => {
        if (disposed) return
        try {
          const d = await getJson(API + '/requests')
          box.textContent = ''
          for (const item of (d.requests || [])) {
            box.appendChild(card({ id: item.fishId, name: item.name }, item.request))
          }
        } catch { /* 宿主没起来：下一轮再试 */ }
      }

      timer = setInterval(() => { void refresh() }, 20_000)
      void refresh()
      try {
        ctx.effect(() => () => { disposed = true; clearInterval(timer); box.remove() })
      } catch {
        disposed = true
        clearInterval(timer)
        box.remove()
      }
    }

    function apply(ctx) {
      ensureStyle()
      try { mountRequestToast(ctx) } catch { /* 提醒失败不影响设置页 */ }
      ctx.slots.inject('settings.section', function* () {
        yield ctx.slots.register({
          name: 'settings.section',
          id: 'fishbowl-config',
          order: 31,
          label: () => 'fishbowl',
        }, Section)
      })
    }

    module.exports = { apply, inject, name }
    return module.exports
  }
}

window.__ModuleLoader__.load({ id: '@local/fishbowl', factory: makeFactory() })
