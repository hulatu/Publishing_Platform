/**
 * 发布台账
 *
 * 一篇文章要发 8 个地方，发到第几个、哪天发的、链接是什么，全靠脑子记不住。
 * 这里只存最轻的三件事：哪个平台、什么时候、发布后的链接，全部落在 localStorage。
 *
 * 为什么用「文章标题 / slug」而不是文件名做 key：
 * 同一篇文章可能被重新导入（改了几句话再发一次），文件名会变，标题不会。
 */

import type { Doc } from './ir'

export interface PlatformRecord {
  /** ISO 时间串，展示时再格式化 */
  at: string
  /** 发布后的链接，可选 */
  url?: string
}

export type ArticleLedger = Record<string, PlatformRecord>

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

function writeStore(store: Store): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prune(store)))
  } catch {
    // 写不进去不影响本次使用
  }
}

/** 只留最近活跃的 N 篇，避免 localStorage 无限长 */
function prune(store: Store): Store {
  const keys = Object.keys(store)
  if (keys.length <= MAX_ARTICLES) return store

  const lastAt = (k: string) => {
    const recs = Object.values(store[k])
    return recs.reduce((m, r) => (r.at > m ? r.at : m), '')
  }
  const sorted = keys.sort((a, b) => lastAt(b).localeCompare(lastAt(a)))
  const kept: Store = {}
  for (const k of sorted.slice(0, MAX_ARTICLES)) kept[k] = store[k]
  return kept
}

export function readLedger(doc: Doc): ArticleLedger {
  return readStore()[articleKeyOf(doc)] ?? {}
}

/** 写入或删除一条记录；record 为 null 表示取消标记 */
export function setRecord(doc: Doc, platformId: string, record: PlatformRecord | null): ArticleLedger {
  const store = readStore()
  const key = articleKeyOf(doc)
  const next: ArticleLedger = { ...(store[key] ?? {}) }

  if (record) next[platformId] = record
  else delete next[platformId]

  store[key] = next
  writeStore(store)
  return next
}

/** 复制成功即标记为已发布；保留原来填过的链接 */
export function markPublished(doc: Doc, platformId: string): ArticleLedger {
  const prev = readLedger(doc)[platformId]
  return setRecord(doc, platformId, { at: new Date().toISOString(), url: prev?.url })
}

export function unmark(doc: Doc, platformId: string): ArticleLedger {
  return setRecord(doc, platformId, null)
}

export function setUrl(doc: Doc, platformId: string, url: string): ArticleLedger {
  const prev = readLedger(doc)[platformId]
  return setRecord(doc, platformId, {
    at: prev?.at ?? new Date().toISOString(),
    url: url.trim() || undefined,
  })
}

export function clearArticle(doc: Doc): ArticleLedger {
  const store = readStore()
  delete store[articleKeyOf(doc)]
  writeStore(store)
  return {}
}

/** 10-31 21:03；今年的不显示年份 */
export function formatAt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  const md = `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  return d.getFullYear() === new Date().getFullYear() ? md : `${d.getFullYear()}-${md}`
}
