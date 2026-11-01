/**
 * 每只鱼自己的「翻到过什么」。
 *
 * 放 creatures/<id>/browse/seen.ndjson（append-only，可搬迁），
 * 不放 log.ndjson：原始素材不是她的记忆，只有她自己说的话才进记忆。
 */
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { allSeenBvids, browseDayKey, parseSeenLine, seenItemsForDay, slimItem } from '../../../src/core/browse.ts'

export function browseDir(creature) {
  return path.join(creature.store.dir, 'browse')
}

export function seenPath(creature) {
  return path.join(browseDir(creature), 'seen.ndjson')
}

export function readSeen(creature) {
  try {
    const text = fs.readFileSync(seenPath(creature), 'utf8')
    return text
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => parseSeenLine(l))
      .filter(Boolean)
  } catch {
    return []
  }
}

export function appendSeen(creature, record) {
  const dir = browseDir(creature)
  fs.mkdirSync(dir, { recursive: true })
  const rec = {
    id: record?.id ?? randomUUID(),
    ts: Number(record?.ts) || Date.now(),
    day: String(record?.day ?? browseDayKey(Date.now())),
    mode: record?.mode === 'self' || record?.mode === 'manual' ? record.mode : 'tool',
    what: String(record?.what ?? 'home').slice(0, 20),
    status: record?.status === 'empty' || record?.status === 'error' ? record.status : 'ok',
    items: Array.isArray(record?.items) ? record.items.map(slimItem).filter((x) => x.bvid).slice(0, 20) : [],
    note: record?.note ? String(record.note).slice(0, 200) : '',
  }
  fs.appendFileSync(seenPath(creature), JSON.stringify(rec) + '\n')
  return rec
}

export function seenBvids(creature) {
  return allSeenBvids(readSeen(creature))
}

/** 今天成功上网了几次（只算有素材的）。 */
export function countToday(creature, day) {
  return readSeen(creature).filter((r) => r?.day === day && r?.status === 'ok').length
}

export function lastSeenAt(creature) {
  const list = readSeen(creature)
  return Number(list[list.length - 1]?.ts ?? 0)
}

export function todayItems(creature, day) {
  return seenItemsForDay(readSeen(creature), day)
}

/**
 * 按天分组的历史（新的在前）。
 * @param {number} days 最多几天
 */
export function history(creature, days = 14, now = Date.now(), timezone = 'Asia/Shanghai') {
  const keep = new Set()
  for (let i = 0; i < Math.max(1, Math.min(365, days)); i++) {
    keep.add(browseDayKey(now - i * 86_400_000, timezone))
  }
  const groups = new Map()
  for (const rec of readSeen(creature)) {
    if (!rec?.day || !keep.has(rec.day)) continue
    for (const it of rec.items ?? []) {
      const bvid = String(it?.bvid ?? '')
      if (!bvid) continue
      const list = groups.get(rec.day) ?? []
      if (!list.some((x) => x.bvid === bvid)) {
        list.push({ ...it, url: `https://www.bilibili.com/video/${bvid}`, how: 'glance' })
      }
      groups.set(rec.day, list)
    }
  }
  return [...groups.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([day, items]) => ({ day, items }))
}

export function browseSummary(creature, cfg, day, now = Date.now()) {
  const records = readSeen(creature)
  const today = records.filter((r) => r?.day === day)
  const items = seenItemsForDay(records, day)
  return {
    usedToday: today.filter((r) => r.status === 'ok').length,
    perDay: Number(cfg?.perDay ?? 0),
    todayCount: items.length,
    lastAt: Number(records[records.length - 1]?.ts ?? 0),
    total: records.filter((r) => r.status === 'ok').length,
    granted: false,
  }
}
