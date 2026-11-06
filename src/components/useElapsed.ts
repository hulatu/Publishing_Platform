/**
 * 生成过程的计时
 *
 * 长文一次生成动辄 40 秒以上。只有「已生成 N 字符」时，用户没法判断还要等多久 ——
 * 字符数在 2000 附近跳得很快，但他不知道终点是 3000 还是 8000。
 * 补一个秒数，用户自己就能算出速率，也就能判断「这破网是不是卡住了」。
 */

import { useEffect, useState } from 'react'

/** 生成中返回已用毫秒数；不在生成中时归零。 */
export function useElapsed(active: boolean): number {
  const [ms, setMs] = useState(0)

  useEffect(() => {
    if (!active) {
      setMs(0)
      return
    }
    const started = Date.now()
    setMs(0)
    const timer = setInterval(() => setMs(Date.now() - started), 500)
    return () => clearInterval(timer)
  }, [active])

  return ms
}
