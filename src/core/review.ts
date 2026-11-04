/**
 * 发布后数据复盘
 *
 * 数据全靠手填：11 个平台没有一家给个人号开数据接口，想自动抓就得写爬虫，
 * 维护成本远高于收益。所以这里只解决两件事 —— **填得快**、**看得清**。
 *
 * 「看得清」的关键是别只给一堆绝对数字。阅读 3 万在微博和在小红书是完全不同的量级，
 * 而互动率（点赞 + 评论 + 收藏 / 阅读）跨平台可比，才是真正能指导
 * 「下篇还发不发这个平台」的那个数。
 *
 * 全部是纯函数，不碰存储 —— 这样能在 node 里直接断言，
 * 不用为了测一个百分比去起浏览器。
 */

import type { ArticleLedger, PlatformStats } from './ledger'

/** 互动 = 点赞 + 评论 + 收藏。三样都没有就返回 0，调用方自己判断「没填」 */
export function interactionsOf(stats: PlatformStats | undefined): number {
  if (!stats) return 0
  return (stats.like ?? 0) + (stats.comment ?? 0) + (stats.fav ?? 0)
}

export function hasStats(stats: PlatformStats | undefined): boolean {
  if (!stats) return false
  return Object.values(stats).some((v) => typeof v === 'number' && Number.isFinite(v))
}

/**
 * 互动率。阅读为 0 或没填时返回 null，**不要返回 0** ——
 * 「0%」会被读成「发了没人理」，「—」才是「还没数据」。
 */
export function rateOf(stats: PlatformStats | undefined): number | null {
  const read = stats?.read
  if (typeof read !== 'number' || !Number.isFinite(read) || read <= 0) return null
  return interactionsOf(stats) / read
}

export interface ArticleSummary {
  key: string
  title: string
  /** 已标记发布的平台数 */
  published: number
  /** 填过数字的平台数 */
  filled: number
  read: number
  like: number
  comment: number
  fav: number
  interaction: number
  /** 全篇互动率；总阅读为 0 时为 null */
  rate: number | null
  /** 阅读最高的那个平台 */
  top: { platformId: string; read: number } | null
}

export function summarizeArticle(key: string, ledger: ArticleLedger, title?: string): ArticleSummary {
  let read = 0
  let like = 0
  let comment = 0
  let fav = 0
  let filled = 0
  let top: ArticleSummary['top'] = null

  for (const [platformId, rec] of Object.entries(ledger)) {
    if (!hasStats(rec.stats)) continue
    filled++
    const r = rec.stats?.read ?? 0
    read += r
    like += rec.stats?.like ?? 0
    comment += rec.stats?.comment ?? 0
    fav += rec.stats?.fav ?? 0
    if (r > 0 && (!top || r > top.read)) top = { platformId, read: r }
  }

  return {
    key,
    title: title?.trim() || key,
    published: Object.keys(ledger).length,
    filled,
    read,
    like,
    comment,
    fav,
    interaction: like + comment + fav,
    rate: read > 0 ? (like + comment + fav) / read : null,
    top,
  }
}

/**
 * 全部文章，按阅读倒序。
 * 一篇都没填数字的不进列表 —— 复盘的列表里塞满 0 只会让人找不到能看的那几行。
 */
export function summarizeAll(
  store: Record<string, ArticleLedger>,
  titleOf: (key: string) => string | undefined = () => undefined,
): ArticleSummary[] {
  return Object.keys(store)
    .map((key) => summarizeArticle(key, store[key], titleOf(key)))
    .filter((s) => s.filled > 0)
    .sort((a, b) => b.read - a.read || b.interaction - a.interaction)
}

/* ------------------------------------------------------------------ */
/* 展示                                                                */
/* ------------------------------------------------------------------ */

/**
 * 一万以上折成「万」。中文语境里 12345 读作「1.2 万」比「12,345」快得多，
 * 而复盘看的就是量级。
 */
export function formatNum(n: number | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—'
  if (n < 0) return '—'
  if (n < 10_000) return n.toLocaleString('zh-CN')
  const w = n / 10_000
  const s = w >= 100 ? Math.round(w).toString() : w.toFixed(1).replace(/\.0$/, '')
  return `${s} 万`
}

export function formatRate(rate: number | null): string {
  if (rate === null || !Number.isFinite(rate)) return '—'
  const pct = rate * 100
  // 小于 0.1% 时给两位小数，否则一律 0.1% 会显示成 0.0%，看着像没数据
  if (pct > 0 && pct < 0.1) return '<0.1%'
  return `${pct.toFixed(1)}%`
}
