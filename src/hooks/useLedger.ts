/**
 * 发布台账
 *
 * 「这篇文章发到哪几个平台、什么时候、链接是什么」—— 只存在本机。
 * 从 App.tsx 里搬出来的是状态 + 三条写操作，注释保留原来的取舍：
 *
 * - 内存里的值照常更新（点了「标记已发」必须立刻有反应），
 *   但落盘失败要说出来 —— 否则刷新之后记录全没，用户还以为自己记过。
 * - 失败只提醒一次：台账里的数字是边敲边存的，每敲一个字符弹一条红字没法用。
 * - `apply` 返回「是否真的写进了本地存储」：调用方据此决定还能不能说
 *   「已记为已发」，否则会出现「先红后绿」两条自相矛盾的提示。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  markPublished as markPublishedRecord,
  readLedger,
  setStats as setLedgerStats,
  type ArticleLedger,
  type LedgerWrite,
  type PlatformStats,
} from '../core/ledger'

type Notify = (text: string, kind?: 'info' | 'success' | 'error') => void

export interface LedgerApi {
  ledger: ArticleLedger
  /** 落地一次写操作，返回是否真的写进了本地存储 */
  apply: (w: LedgerWrite) => boolean
  changeStats: (platformId: string, patch: PlatformStats) => void
  /** 标记某平台已发布；没有文章 key 时什么也不做 */
  markPublished: (platformId: string) => boolean
}

export function useLedger(articleKey: string, toast: Notify): LedgerApi {
  const [ledger, setLedger] = useState<ArticleLedger>({})
  const failedRef = useRef(false)

  // 换文章才重读台账。key 在导入时算一次就锁住，改标题不会把它冲掉
  useEffect(() => {
    setLedger(articleKey ? readLedger(articleKey) : {})
  }, [articleKey])

  const apply = useCallback(
    (w: LedgerWrite): boolean => {
      setLedger(w.ledger)
      if (w.persisted) {
        failedRef.current = false
        return true
      }
      if (!failedRef.current) {
        failedRef.current = true
        toast('台账没存上：浏览器本地存储已满或被禁用。这次的记录刷新后会丢', 'error')
      }
      return false
    },
    [toast],
  )

  const changeStats = useCallback(
    (platformId: string, patch: PlatformStats) => {
      if (!articleKey) return
      apply(setLedgerStats(articleKey, platformId, patch))
    },
    [articleKey, apply],
  )

  const markPublished = useCallback(
    (platformId: string) => {
      if (!articleKey) return false
      return apply(markPublishedRecord(articleKey, platformId))
    },
    [articleKey, apply],
  )

  return { ledger, apply, changeStats, markPublished }
}
