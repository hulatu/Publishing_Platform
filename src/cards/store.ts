/**
 * 卡片工坊的本地快照
 *
 * 为什么需要它：CardStudio 只在「配图卡片」平台下挂载，切到公众号看一眼排版
 * 再切回来，组件是重新挂载的 —— 原来卡片状态只活在组件里，于是手工改过的
 * 标题、加的数据卡、调过的字号全被「按文章重新生成」的默认套图覆盖。
 *
 * 这里按文章存一份卡片快照，切平台、刷新页面都能接回来：
 * - key 用发布台账同一个 articleKey（slug 优先），同一篇文章的草稿、台账、
 *   卡片能对上；
 * - 再叠一层正文指纹：增删小节后快照直接作废，否则页码和小节卡会对不上；
 * - dirty 跟着快照一起存：用户改过的卡不能被新摘要冲掉，没改过的仍然自动升级；
 * - 容量按「最近 N 篇」淘汰。卡片是纯文字，一篇十几张约 8KB，
 *   localStorage 的 5MB 里留 12 篇很安全；真写不进去也要如实返回 false，
 *   由 UI 提醒一次，而不是假装保存成功。
 */

import type { CardSpec } from './types'
import { layoutNames } from './types'
import { readJson } from '../core/storage'

const KEY = 'ad.cards.v1'

/** 最多留几篇文章的卡片快照。超了按最后编辑时间淘汰最旧的 */
export const MAX_ENTRIES = 12

export interface CardSnapshot {
  /** 最后写入时间，用于淘汰 */
  at: number
  /** 正文指纹；和当前文章对不上就丢弃快照 */
  hash: string
  /** 用户是否改过卡片 */
  dirty: boolean
  /** 还原时把光标放回上次编辑的那张 */
  selectedId: string
  cards: CardSpec[]
}

type Store = Record<string, CardSnapshot>

/**
 * 正文指纹：FNV-1a 32 位 + 原文长度。
 * 没必要上加密哈希 —— 这里只是「是不是同一版正文」的粗判断，
 * 长度一起带上，短文本的碰撞概率几乎可以忽略。
 */
export function hashDoc(raw: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return `${(h >>> 0).toString(16)}-${raw.length}`
}

/** 只留最近 max 篇；新写入的这篇 at 最大，一定会被留下 */
export function pruneSnapshots(store: Store, max = MAX_ENTRIES): Store {
  const entries = Object.entries(store).sort((a, b) => (b[1]?.at ?? 0) - (a[1]?.at ?? 0))
  return Object.fromEntries(entries.slice(0, Math.max(1, max)))
}

/** 存储被手改坏、或旧版本残留时，别把不认识的卡片塞进渲染器 */
function isCard(value: unknown): value is CardSpec {
  if (!value || typeof value !== 'object') return false
  const c = value as Partial<CardSpec>
  return (
    typeof c.id === 'string' &&
    typeof c.title === 'string' &&
    typeof c.themeId === 'string' &&
    typeof c.layout === 'string' &&
    c.layout in layoutNames
  )
}

function readStore(): Store {
  return readJson<Store>(KEY)
}

/** 写盘。配额不够时淘汰一半再试一次；两次都不行就返回 false */
function writeStore(store: Store): boolean {
  let next = pruneSnapshots(store)
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      localStorage.setItem(KEY, JSON.stringify(next))
      return true
    } catch {
      const keys = Object.keys(next)
      if (keys.length <= 1) return false
      next = pruneSnapshots(next, Math.ceil(keys.length / 2))
    }
  }
  return false
}

/**
 * 读一篇文章的卡片快照。
 * 指纹不符、结构不认识都当作「没有快照」，让调用方回退到重新生成 ——
 * 宁可丢一次编辑，也不能把旧结构的小节卡套到新正文上。
 */
export function readCardSnapshot(articleKey: string, hash: string): CardSnapshot | null {
  if (!articleKey) return null
  const snap = readStore()[articleKey]
  if (!snap || snap.hash !== hash) return null
  if (!Array.isArray(snap.cards) || snap.cards.length === 0) return null
  if (!snap.cards.every(isCard)) return null
  return {
    at: snap.at,
    hash: snap.hash,
    dirty: Boolean(snap.dirty),
    selectedId: typeof snap.selectedId === 'string' ? snap.selectedId : snap.cards[0].id,
    cards: snap.cards,
  }
}

/** 存一篇文章的卡片快照。返回 false 表示没写进去，调用方要如实告诉用户 */
export function saveCardSnapshot(
  articleKey: string,
  snap: Omit<CardSnapshot, 'at'>,
): boolean {
  if (!articleKey || snap.cards.length === 0) return false
  const store = readStore()
  store[articleKey] = { ...snap, at: Date.now() }
  return writeStore(store)
}
