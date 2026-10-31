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
    const box = { background: 'var(--dsw-alias-bg-2, rgba(127,127,127,0.07))', borderRadius: 10, padding: '12px 14px', marginBottom: 12 }
    const rowS = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 8 }
    const lab = { fontSize: 12.5, color: 'var(--dsw-alias-text-2, #666)' }
    const inp = { width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--dsw-alias-border, #ddd)', background: 'var(--dsw-alias-bg-1, transparent)', color: 'inherit', font: 'inherit', fontSize: 13 }
    const btn = { padding: '6px 12px', borderRadius: 8, border: '1px solid var(--dsw-alias-border, #ddd)', background: 'var(--dsw-alias-bg-1, transparent)', color: 'inherit', cursor: 'pointer', font: 'inherit', fontSize: 12.5 }
    const btnP = { ...btn, background: 'var(--dsw-alias-brand, #4d6bfe)', borderColor: 'transparent', color: '#fff' }
    const btnS = { ...btn, fontSize: 12, padding: '4px 10px' }

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
    const chip = { fontSize: 11, padding: '1px 7px', borderRadius: 6, background: 'var(--dsw-alias-bg-2, rgba(127,127,127,0.14))', color: 'var(--dsw-alias-text-2, #666)', whiteSpace: 'nowrap' }
    const kvRow = (k, v, key) => e('div', {
      key,
      style: { display: 'flex', gap: 8, marginTop: 3, fontSize: 12, lineHeight: 1.6 },
      children: [
        e('span', { style: { color: 'var(--dsw-alias-text-3, #999)', flex: '0 0 auto', minWidth: 36 }, children: k }, 'k'),
        e('span', { style: { wordBreak: 'break-all' }, children: v }, 'v'),
      ],
    })

    function FishCard(props) {
      const f = props.f
      return e('div', {
        style: { ...box, cursor: 'pointer', border: '1px solid var(--dsw-alias-border, rgba(127,127,127,0.18))' },
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
          const r = await postJson(API + '/memory/config', payload)
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
      const [nameInput, setNameInput] = useState('')
      const [delConfirm, setDelConfirm] = useState(false)
      const [routine, setRoutine] = useState(null)

      const load = useCallback(async (attempt = 0) => {
        try {
          const d = await getJson(API + '/fish')
          setData(d)
          setGrowth(d.config.growth)
          setSeedName(d.config.seed?.name ?? '')
          setSeedBg(d.config.seed?.background ?? '')
          setRoutine({ wake: d.config.wake ?? {}, contact: d.config.contact ?? {} })
          setErr('')
        } catch (x) {
          setErr(String((x && x.message) || x))
          // 宿主的路由可能刚启动还没挂好：前几次自动重试
          if (attempt < 4) setTimeout(() => { void load(attempt + 1) }, 1500)
        }
      }, [])
      useEffect(() => { void load() }, [load])

      const fish = (data && data.fish) || []
      const selected = view.level === 'fish' ? fish.find((f) => f.id === view.id) : null
      const born = !!(data && data.born)

      const act = async (fn, okMsg) => {
        try { await fn(); setMsg(okMsg || ''); setErr(''); await load() }
        catch (x) { setErr(String((x && x.message) || x)); setMsg('') }
      }

      const openFish = (id) => { setView({ level: 'fish', id, page: 'home' }); setWs(''); setSess(''); setMsg(''); setMoveOpen(false); setPick(null) }

      // ---------- 列表 ----------
      if (view.level === 'list') {
        return e('div', { style: { fontSize: 13.5, lineHeight: 1.75 }, children: [
          e('div', { style: { fontWeight: 600, fontSize: 15, marginBottom: 4 }, children: 'fishbowl · 养的鱼' }, 't'),
          e('div', { style: { ...lab, marginBottom: 12 }, children: '每条鱼一个住处：一个工作区，或工作区里的某个会话。一个工作区只能住一条鱼。' }, 'd'),
          err ? e('div', { style: { color: 'var(--dsw-alias-danger, #d33)', marginBottom: 8 }, children: err }, 'err') : null,
          fish.length
            ? fish.map((f, i) => e(FishCard, { f, k: 'f' + i, onOpen: () => openFish(f.id) }))
            : e('div', { style: box, children: '还没有鱼。点下面「带一条新的回家」。' }, 'none'),
          e('div', { style: { ...rowS, marginTop: 8 }, children: [
            e('span', { style: lab, children: fish.length + ' 条' }, 'c'),
            e('button', { style: { ...btnP, padding: '7px 16px' }, onClick: () => { setNewOpen(true); setNewName(''); setNewErr('') }, children: '带一条新的回家' }, 'newbtn'),
          ] }, 'add'),
          newOpen ? e('div', { style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }, onClick: () => setNewOpen(false), children: [
            e('div', { style: { background: 'var(--dsw-alias-bg-1, #fff)', color: 'var(--dsw-alias-text-1, #222)', borderRadius: 14, padding: '20px 22px', width: 400, maxWidth: '92vw', boxShadow: '0 12px 40px rgba(0,0,0,0.25)' }, onClick: (ev) => ev.stopPropagation(), children: [
              e('div', { style: { fontWeight: 600, fontSize: 14, marginBottom: 12 }, children: '给新鱼起个名字' }, 'h'),
              e('input', { style: { ...inp, padding: '9px 12px', boxSizing: 'border-box' }, value: newName, placeholder: '例：大肥鱼', autofocus: true, onInput: (ev) => setNewName(ev.target.value) }, 'i'),
              e('div', { style: { ...lab, fontSize: 12, marginTop: 6 }, children: '名字是她的身份，之后只读（历史会被铭记）。' }, 'hint'),
              newErr ? e('div', { style: { color: 'var(--dsw-alias-danger, #d33)', fontSize: 12.5, marginTop: 6 }, children: newErr }, 'e') : null,
              e('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }, children: [
                e('button', { style: { ...btnS, padding: '5px 14px' }, onClick: () => setNewOpen(false), children: '取消' }, 'c'),
                e('button', { style: { ...btnP, padding: '6px 16px', fontSize: 13 }, onClick: async () => {
                  const name = newName.trim()
                  if (!name) { setNewErr('先起个名字'); return }
                  try {
                    await postJson(API + '/fish', { name })
                    setNewOpen(false); setNewName(''); setNewErr('')
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
      const tabs = [
        ['status', '状态'], ['home', '住所'], ['routine', '作息'], ['persona', '人设'], ['memory', '记忆'],
      ]

      let body = null
      if (page === 'status') {
        const mem = f.memory || {}
        const lines = []
        if (mem.semantics?.length) lines.push('记得: ' + mem.semantics.join('；'))
        if (mem.procedures?.length) lines.push('教训: ' + mem.procedures.join('；'))
        if (mem.self?.length) lines.push('自我认知: ' + mem.self.join('；'))
        if (mem.commitments?.length) lines.push('承诺: ' + mem.commitments.join('；'))
        if (mem.activity) lines.push('一起在做: ' + mem.activity)
        if (mem.folded) lines.push('记不清的旧事: ' + mem.folded + ' 件')
        body = e('div', { children: [
          e('div', { style: box, children: [
            e('div', { style: { ...lab, marginBottom: 4 }, children: occText(f.occupancy) }, 'o'),
            e('div', { style: lab, children: '效价 ' + fmt(f.affect.v) + ' · 唤醒 ' + fmt(f.affect.a) + ' · 愧疚 ' + fmt(f.affect.guilt) + ' · 想念 ' + fmt(f.affect.longing) + ' · ' + f.episodes + ' 轮' }, 'a'),
          ] }, 's'),
          e('div', { style: box, children: lines.length
            ? lines.map((l, i) => e('div', { style: { fontSize: 12.5, lineHeight: 1.8 }, children: l }, 'l' + i))
            : e('div', { style: lab, children: '还没有记忆（聊几轮后会开始巩固）' }) }, 'm'),
        ] }, 'status')
      } else if (page === 'home') {
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
        const roomsOf = (w) => sessions.filter((s2) => (s2.workspace || '') === (w || ''))
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

        const moveModal = moveOpen ? e('div', { style: overlay, onClick: () => { setMoveOpen(false); setPick(null); setPickWs(null); setMoveErr('') }, children: [
          e('div', { style: modal, onClick: (ev) => ev.stopPropagation(), children: [
            e('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }, children: [
              e('div', { style: { fontWeight: 600, fontSize: 14 }, children: '搬家 · ' + f.name + '的房间' }, 't'),
              e('button', { style: { ...btnS, padding: '2px 9px' }, onClick: () => { setMoveOpen(false); setPick(null); setPickWs(null); setMoveErr('') }, children: '×' }, 'x'),
            ] }, 'hdr'),
            e('div', { style: { display: 'flex', gap: 8 }, children: [
              e('div', { style: col, children: [
                e('div', { style: { ...lab, marginBottom: 6 }, children: '屋子（工作区）' }, 'lw'),
                ...workspaces.map((w, i) => node(
                  (pick && pick.kind === 'workspace' && pick.id === w ? '● ' : pickWs === w ? '▾ ' : '▸ ') + base(w) + wsWhy(w),
                  false,
                  pick && pick.kind === 'workspace' && pick.id === w,
                  () => {
                    setMoveErr('')
                    setPickWs(w)
                    if (wsBlocked(w)) setPick(null)
                    else setPick({ kind: 'workspace', id: w })
                  },
                  'w' + i)),
                !workspaces.length ? e('div', { style: lab, children: '还没有见过工作区' }, 'nows') : null,
              ] }, 'left'),
              e('div', { style: col, children: [
                e('div', { style: { ...lab, marginBottom: 6 }, children: '房间（会话）' }, 'lr'),
                pickWs
                  ? e('div', { children: [

                      ...roomsOf(pickWs).map((s2, i) => {
                        const roomOwner = occupiedSess[s2.id]
                        const wsOwner = s2.workspace ? occupiedWs[s2.workspace] : null
                        const isCurrent = !!(f.occupancy && f.occupancy.kind === 'session' && f.occupancy.id === s2.id)
                        const blockedByRoom = !!roomOwner && roomOwner !== f.name
                        const blockedByWs = !!wsOwner && wsOwner !== f.name
                        const disabled = blockedByRoom || blockedByWs || isCurrent
                        const active = !!(pick && pick.kind === 'session' && pick.id === s2.id)
                        const why = blockedByRoom ? '（' + roomOwner + ' 已住）' : blockedByWs ? '（屋子被 ' + wsOwner + ' 住了）' : isCurrent ? '（当前住这）' : active ? '（已选）' : ''
                        return node(shortId(s2.id) + why, disabled, active, () => { setPick({ kind: 'session', id: s2.id, workspace: s2.workspace }); setMoveErr('') }, 'r' + i)
                      }),
                      !roomsOf(pickWs).length ? e('div', { style: lab, children: '这个屋子还没有记录到的房间' }, 'norooms') : null,
                    ] }, 'rooms')
                  : e('div', { style: lab, children: '先点左边选一个屋子，这里会展开它的房间' }, 'pickfirst'),
              ] }, 'right'),
            ] }, 'cols'),
            moveErr ? e('div', { style: { color: 'var(--dsw-alias-danger, #d33)', fontSize: 12.5, marginTop: 10 }, children: moveErr }, 'merr') : null,
            e('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }, children: [
              e('span', { style: { ...lab, fontSize: 12 }, children: pick ? '已选：' + (pick.kind === 'workspace' ? '整个屋子 ' + base(pick.id) : '房间 ' + shortId(pick.id)) : '还没选' }, 'sel'),
              e('div', { style: { display: 'flex', gap: 8 }, children: [
                e('button', { style: { ...btnS, padding: '5px 14px' }, onClick: () => { setMoveOpen(false); setPick(null); setPickWs(null); setMoveErr('') }, children: '取消' }, 'c'),
                e('button', { style: { ...btnP, opacity: pick ? 1 : 0.5, cursor: pick ? 'pointer' : 'not-allowed', fontSize: 13, padding: '6px 16px' }, onClick: async () => {
                  if (!pick) return
                  if (pick.kind === 'workspace' && wsBlocked(pick.id)) {
                    setMoveErr('这个住处已经住着「' + (occupiedWs[pick.id] || (sessInWs[pick.id] || [])[0]) + '」了')
                    return
                  }
                  if (pick.kind === 'session') {
                    const roomOwner = occupiedSess[pick.id]
                    const wsOwner = pick.workspace ? occupiedWs[pick.workspace] : null
                    if ((roomOwner && roomOwner !== f.name) || (wsOwner && wsOwner !== f.name)) {
                      setMoveErr('这个住处已经住着「' + (roomOwner && roomOwner !== f.name ? roomOwner : wsOwner) + '」了')
                      return
                    }
                  }
                  try {
                    await postJson(API + '/fish/' + f.id + '/occupy', { kind: pick.kind, id: pick.id, workspace: pick.workspace })
                    setMoveOpen(false); setPick(null); setPickWs(null); setMoveErr('')
                    await load()
                  } catch (x) { setMoveErr(String((x && x.message) || x)) }
                }, children: '入住' }, 'ok'),
              ] }, 'acts'),
            ] }, 'foot'),
          ] }, 'modal'),
        ] }) : null

        body = e('div', { children: [
          e('div', { style: box, children: [
            e('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 6 }, children: [
              e('div', { style: { fontWeight: 600, fontSize: 14 }, children: f.name + '的房间' }, 'rn'),
              e('div', { style: { display: 'flex', gap: 6 }, children: [
                e('button', { style: { ...btnS, fontSize: 12, padding: '3px 12px', fontWeight: 500 }, onClick: () => { setMoveOpen(true); setPick(null); setPickWs(null); setMoveErr('') }, children: '搬家' }),
                f.occupancy ? e('button', { style: { ...btnS, fontSize: 12, padding: '3px 12px', fontWeight: 400, color: 'var(--dsw-alias-text-2, #666)' }, onClick: () => act(async () => { await postJson(API + '/fish/' + f.id + '/release') }, '搬出来了'), children: '搬出' }) : null,
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
        ] }, 'home-root')      } else if (page === 'routine') {
        const r = routine || { wake: {}, contact: {} }
        const wake = r.wake || {}
        const contact = r.contact || {}
        const setWake = (k, v) => setRoutine({ ...r, wake: { ...wake, [k]: v } })
        const setContact = (k, v) => setRoutine({ ...r, contact: { ...contact, [k]: v } })
        const timeInput = (val, onChange, key) => e('input', { key, type: 'time', style: { ...inp, width: 112 }, value: val ?? '00:00', onInput: (ev) => onChange(ev.target.value) }, key)
        const numInput = (val, onChange, key, min, max) => e('input', { key, type: 'number', min: String(min), max: String(max), style: { ...inp, width: 84 }, value: val ?? 0, onInput: (ev) => onChange(Number(ev.target.value)) }, key)
        // 最近一次检查：她为什么没开口
        const ws = (data && data.wakeState) || null
        const entry = ws && Array.isArray(ws.entries) ? ws.entries[0] : null
        const gateLabel = { ok: '可以开口', no_reason: '没有由头', quiet_hours: '不在时段', daily_max: '今天次数用完', min_gap: '离上次太近', burst: '短时间太多', unanswered_stop: '连发没回' }
        const lastCheck = entry ? new Date(entry.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '—'
        const statusLine = entry
          ? '最近检查 ' + lastCheck + '：想念 ' + entry.longing + '（要 >0.4） · 未完成承诺 ' + entry.broken + ' · ' + (gateLabel[entry.gate?.reason] || entry.gate?.reason || '—')
          : '还没有检查记录（节律没开或刚启动）'
        const statusCard = e('div', { style: box, children: [
          e('div', { style: { ...rowS, marginBottom: 4 }, children: [
            e('div', { style: { fontWeight: 600, fontSize: 13.5 }, children: '现在的状态' }, 'h'),
            e('button', { style: { ...btnS, padding: '3px 12px' }, onClick: () => act(async () => {
              const r = await postJson(API + '/wake/now', {})
              setMsg('她开口了：' + (r.text || ''))
            }, '已叫她一次') , children: '现在叫一次（测试）' }, 'now'),
          ] }, 'head'),
          e('div', { style: { ...lab, fontSize: 12 }, children: statusLine }, 'line'),
        ] }, 'wstatus')
        body = e('div', { children: [
          e('div', { style: box, children: [
            e('div', { style: { ...rowS, marginBottom: 4 }, children: [
              e('div', { style: { fontWeight: 600, fontSize: 13.5 }, children: '清醒节律' }, 'h'),
              e('button', { style: wake.enabled ? { ...btnP, padding: '4px 12px', fontSize: 12 } : { ...btn, padding: '4px 12px', fontSize: 12 }, onClick: () => setWake('enabled', !wake.enabled), children: wake.enabled ? '已开启' : '已关闭' }, 'sw'),
            ] }, 'head'),
            e('div', { style: { ...lab, marginBottom: 10 }, children: '打开后她会按间隔醒来；只有有由头（还没做完的承诺、很久没说话）才开口，否则继续睡。' }, 'hint'),
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
            e('div', { style: rowS, children: [
              e('span', { style: lab, children: '多久没说话就算想念' }, 'l'),
              e('span', { style: { display: 'flex', gap: 6, alignItems: 'center' }, children: [
                numInput(wake.absenceHours ?? 8, (v) => setWake('absenceHours', v), 'n', 1, 72),
                e('span', { style: lab, children: '小时' }, 'u'),
              ] }, 'v'),
            ] }, 'r3'),
          ] }, 'wake'),
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
          statusCard,
          e('div', { style: rowS, children: [
            e('span', { style: { ...lab, fontSize: 12 }, children: msg }, 'm'),
            e('button', { style: { ...btnP, padding: '6px 16px', fontSize: 13 }, onClick: () => act(async () => {
              await postJson(API + '/config', { wake, contact })
            }, '作息已保存'), children: '保存' }, 'save'),
          ] }, 'act'),
        ] }, 'routine')      } else if (page === 'persona') {
        const isDefaultName = /^fish-/.test(f.name)
        body = e('div', { children: [
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
              await postJson(API + '/config', body2)
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
      } else if (page === 'memory') {
        const memCfg = (data.config && data.config.memory) || null
        body = e('div', { children: [
          e(MemoryConfigCard, { cfg: memCfg }, 'mcfg'),
          e(MemoryDetail, { fishId: f.id }, 'mdet'),
        ] }, 'memory')
      }

      return e('div', { style: { fontSize: 13.5, lineHeight: 1.75 }, children: [
        e('div', { style: { ...rowS, marginBottom: 8 }, children: [
          e('div', { style: { fontWeight: 600, fontSize: 15 }, children: f.name }, 'n'),
          e('button', { style: btnS, onClick: () => setView({ level: 'list' }) , children: '← 所有鱼' }),
        ] }, 'hdr'),
        e('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }, children: tabs.map(([id, label]) =>
          e('button', { key: id, style: id === page ? { ...btnS, background: 'var(--dsw-alias-bg-2, rgba(127,127,127,0.14))', fontWeight: 600 } : btnS, onClick: () => setPage(id) , children: label })) }, 'tabs'),
        err ? e('div', { style: { color: 'var(--dsw-alias-danger, #d33)', marginBottom: 8 }, children: err }, 'err') : null,
        body,
      ] }, 'root')
    }

    const name = 'fishbowl'
    const inject = ['slots', 'locale']

    function apply(ctx) {
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
