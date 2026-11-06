/**
 * 时间显示
 *
 * 独立成文件是为了能在 node 里跑回归 —— 放进 useElapsed.ts 的话，
 * 测试脚本就得连带把 React 打进来。
 */

/** 12s / 1:23 —— 超过一分钟才用分:秒，否则「83s」读起来更直接 */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
