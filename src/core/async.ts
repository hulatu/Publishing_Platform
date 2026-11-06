/**
 * 并发小工具
 *
 * 这个工具里有三处「一堆独立请求排队跑」：图片打包、四个平台生成、
 * 卡片批量导出。串行跑都在浪费通道 —— 浏览器同域默认就允许 6 个并发连接。
 */

/**
 * 限并发地跑一批异步任务，结果按原顺序返回。
 *
 * fn 自己负责吞掉异常。这里不做 catch：一个失败就整体 reject 会让
 * 「20 张图里 1 张跨域」变成「一张都拿不到」，而调用方通常需要
 * 知道每一张各自的结果。
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0

  const worker = async () => {
    for (;;) {
      const i = cursor++
      if (i >= items.length) return
      results[i] = await fn(items[i], i)
    }
  }

  const n = Math.max(1, Math.min(limit, items.length))
  await Promise.all(Array.from({ length: n }, worker))
  return results
}

/**
 * 挪到浏览器空闲时段执行。
 *
 * 一篇文章的草稿带正文约 30–60KB，JSON.stringify + 同步写 localStorage
 * 会占住主线程十几毫秒 —— 如果这正好发生在用户还在输入的时候，就是肉眼可见的一顿。
 * timeout 兜底：真的一直不空闲，也不能永远不存盘。
 */
export function whenIdle(fn: () => void, timeout = 2000): void {
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    window.requestIdleCallback(fn, { timeout })
  } else {
    setTimeout(fn, 0)
  }
}
