/**
 * 订阅一个 CSS 媒体查询。
 *
 * 侧栏在 ≤1180px 才变成覆盖式抽屉；焦点陷阱和 inert 只在「真的覆盖」
 * 时才该生效，所以 JS 必须和 CSS 用同一个断点，并且跟着窗口变化。
 */

import { useEffect, useState } from 'react'

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  )

  useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = () => setMatches(mq.matches)
    // 首帧之后查询可能已经变了（比如断点两侧来回拖），先对齐一次
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])

  return matches
}
