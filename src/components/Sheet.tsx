/**
 * 弹层的统一挂载点
 *
 * 每个面板都是 lazy 的，所以调用处都要包一层 Suspense。原来 12 个面板各写一遍
 * `{xxxOpen ? <Suspense fallback={null}>…</Suspense> : null}`，字字重复，
 * 而且「同时开两个弹层」在类型上完全合法。
 *
 * 收成一份之后，调用方只声明「我是哪个 sheet」，其余交给泛型：
 * `id` 必须来自同一个字面量联合（App 里的 SheetId），写错名字是编译错误，
 * 而不是「点了没反应」。
 */

import { Suspense, type ReactNode } from 'react'

/**
 * 能弹出来的面板。侧栏抽屉不在里面 —— 它是布局的一部分，和主区域并列，
 * 不是遮罩层。
 *
 * 用联合而不是 string：`<Sheet id="mtea">` 这种手误是编译错误，
 * 而不是「点了没反应」。
 */
export type SheetId =
  | 'filter'
  | 'readiness'
  | 'settings'
  | 'ledger'
  | 'images'
  | 'cover'
  | 'meta'
  | 'tail'
  | 'drafts'
  | 'review'
  | 'recovery'

export function Sheet<T extends string>({
  id,
  current,
  children,
}: {
  id: T
  current: T | null
  children: ReactNode
}) {
  if (current !== id) return null
  return <Suspense fallback={null}>{children}</Suspense>
}
