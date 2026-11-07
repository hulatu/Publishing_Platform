/**
 * 发布台账
 *
 * 一篇文章要发 11 个地方，发到第几个、哪天发的、链接是什么，全靠脑子记不住。
 * 这里只存最轻的几件事：哪个平台、什么时候、发布后的链接、发布后的数据，
 * 全部落在 localStorage。
 *
 * 为什么用「文章标题 / slug」而不是文件名做 key：
 * 同一篇文章可能被重新导入（改了几句话再发一次），文件名会变，标题不会。
 */

import type { Doc } from './ir'

/**
 * 发布后的数据。全部手填 —— 这 11 个平台没有一家给个人号开数据接口，
 * 想让工具自动抓就得做爬虫，维护成本远高于收益。所以只做「填得快 + 看得清」。
 */
export interface PlatformStats {
  read?: number
  like?: number
  comment?: number
  fav?: number
}

export interface PlatformRecord {
  /** ISO 时间串，展示时再格式化 */
  at: string
  /** 发布后的链接，可选 */
  url?: string
  /** 发布后几天的数据，可选 */
  stats?: PlatformStats
}

export type ArticleLedger = Record<string, PlatformRecord>

/**
 * 一次写操作的结果。
 *
 * `ledger` 是内存里的新值（即使落盘失败也照样返回，界面该更新还是要更新，
 * 否则用户点了「标记已发」看着毫无反应）；`persisted` 才代表刷新之后还在不在。
 */
export interface LedgerWrite {
  ledger: ArticleLedger
  persisted: boolean
}

type Store = Record<string, ArticleLedger>

const KEY = 'ad.publish-ledger.v1'
/** 最多保留多少篇的历史，超出按最后发布时间淘汰 */
const MAX_ARTICLES = 120

export function articleKeyOf(doc: Doc): string {
  return (doc.meta.slug || doc.meta.title || '未命名').trim()
}

function readStore(): Store {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed as Store
  } catch {
    // 隐私模式 / 手改坏了，都当成空台账
    return {}
  }
}

/** 这篇文章最近一次发布的时间，用于淘汰排序 */
function lastAt(store: Store, key: string): string {
  return Object.values(store[key] ?? {}).reduce((m, r) => (r.at > m ? r.at : m), '')
}

/**
 * 写入。配额不足时淘汰最久没动过的一篇再试 ——
 * 和草稿箱同策略：宁可丢最旧的历史，也不能让「标记已发」静默失效。
 *
 * 以前这里是 try/catch 一吞了事，于是存储满之后每一次标记都失败、
 * 界面上却照样显示「已记为已发」，刷新一次全没了。
 */
function writeStore(store: Store): boolean {
  for (let attempt = 0; attempt <= 8; attempt++) {
    try {
      localStorage.setItem(KEY, JSON.stringify(prune(store)))
      return true
    } catch {
      const keys = Object.keys(store)
      if (keys.length <= 1) return false
      let oldest = keys[0]
      for (const k of keys) {
        if (lastAt(store, k) < lastAt(store, oldest)) oldest = k
      }
      delete store[oldest]
    }
  }
  return false
}

/** 只留最近活跃的 N 篇，避免 localStorage 无限长 */
function prune(store: Store): Store {
  const keys = Object.keys(store)
  if (keys.length <= MAX_ARTICLES) return store

  const sorted = keys.sort((a, b) => lastAt(store, b).localeCompare(lastAt(store, a)))
  const kept: Store = {}
  for (const k of sorted.slice(0, MAX_ARTICLES)) kept[k] = store[k]
  return kept
}

/**
 * 下面这些函数收的是 key 而不是 doc —— 因为用户可能导入后改标题，
 * 如果每次都从 doc 重算 key，改完标题台账就「清空」了（记录其实还在旧 key 下）。
 * key 由 App 在导入时算一次、锁定下来。
 */
export function readLedger(key: string): ArticleLedger {
  return readStore()[key] ?? {}
}

/** 全部文章的台账，复盘要跨篇看 */
export function readAllLedgers(): Record<string, ArticleLedger> {
  return readStore()
}

/** 写入或删除一条记录；record 为 null 表示取消标记 */
export function setRecord(key: string, platformId: string, record: PlatformRecord | null): LedgerWrite {
  const store = readStore()
  const next: ArticleLedger = { ...(store[key] ?? {}) }

  if (record) next[platformId] = record
  else delete next[platformId]

  store[key] = next
  return { ledger: next, persisted: writeStore(store) }
}

/** 复制成功即标记为已发布；保留原来填过的链接与数据 */
export function markPublished(key: string, platformId: string): LedgerWrite {
  const prev = readLedger(key)[platformId]
  return setRecord(key, platformId, { at: new Date().toISOString(), url: prev?.url, stats: prev?.stats })
}

export function unmark(key: string, platformId: string): LedgerWrite {
  return setRecord(key, platformId, null)
}

export function setUrl(key: string, platformId: string, url: string): LedgerWrite {
  const prev = readLedger(key)[platformId]
  return setRecord(key, platformId, {
    at: prev?.at ?? new Date().toISOString(),
    url: url.trim() || undefined,
    // 改链接不能顺手把数据抹掉 —— 用户往往是先填数据、后来才补链接
    stats: prev?.stats,
  })
}

/**
 * 填一个数字。传空串（或 NaN）表示清掉这一项。
 *
 * 不整体替换 stats 而是按字段 merge：用户一栏一栏地填，
 * 每敲一次都整体替换会把还没填的字段冲成 undefined。
 */
export function setStats(key: string, platformId: string, patch: PlatformStats): LedgerWrite {
  const prev = readLedger(key)[platformId]
  const merged: PlatformStats = { ...prev?.stats, ...patch }

  // 全空就整块删掉，别留一个 {} 在存储里让「有没有填过」判断变复杂
  const hasAny = Object.values(merged).some((v) => typeof v === 'number' && Number.isFinite(v))

  return setRecord(key, platformId, {
    at: prev?.at ?? new Date().toISOString(),
    url: prev?.url,
    stats: hasAny ? merged : undefined,
  })
}

export function clearArticle(key: string): LedgerWrite {
  const store = readStore()
  delete store[key]
  return { ledger: {}, persisted: writeStore(store) }
}

/** 10-31 21:03；今年的不显示年份 */
export function formatAt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  const md = `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  return d.getFullYear() === new Date().getFullYear() ? md : `${d.getFullYear()}-${md}`
}
