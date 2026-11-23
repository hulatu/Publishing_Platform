/**
 * 记住当前平台
 *
 * 原来 platform 写死从「公众号」开始：刷新、新开标签页、从书签打开都会回到公众号，
 * 一篇文章要连着发好几个平台时，每次刷新都得重新点回去。
 *
 * 两处来源，地址栏优先：
 * 1. `#p=<id>` —— 能分享「直接打开小红书那一栏」的链接；
 * 2. localStorage（`ad.platform.v1`）—— 没有 hash 时回到上次用的平台。
 *
 * 用 `#p=` 而不是裸 `#wechat`：预览里的脚注是 `#fn1` 这种页内锚点，点一下就会改 hash，
 * 带前缀才不会被误认成平台；改掉了也有 localStorage 兜底。
 * 写地址栏用 replaceState：切平台不进浏览器历史。`[` / `]` 连按十下就是十条记录，
 * 后退键会变成「倒着把平台再切一遍」，比回不去更烦。
 * 键名以 `ad.` 开头，「设置 → 本地数据」的导出 / 清空会自动带上它。
 */

const KEY = 'ad.platform.v1'
const HASH = /(?:^#|&)p=([\w-]+)/

/** 从 hash 里取平台 id；不认识的 id 当没有 */
export function platformFromHash(hash: string, known: Set<string>): string | null {
  const m = HASH.exec(hash)
  return m && known.has(m[1]) ? m[1] : null
}

/** 初始平台：地址栏 > 上次用的 > fallback。读不到存储（隐私模式）不报错 */
export function loadPlatform(known: string[], fallback: string): string {
  const set = new Set(known)
  const fromHash = typeof location === 'undefined' ? null : platformFromHash(location.hash, set)
  if (fromHash) return fromHash
  try {
    const saved = localStorage.getItem(KEY)
    if (saved && set.has(saved)) return saved
  } catch {
    // 读不到就用默认值
  }
  return fallback
}

/** 写回存储和地址栏；两处各自失败都不影响使用 */
export function savePlatform(id: string): void {
  try {
    localStorage.setItem(KEY, id)
  } catch {
    // 存不住就只在本次会话有效
  }
  try {
    const next = `#p=${id}`
    if (location.hash !== next) {
      history.replaceState(history.state, '', `${location.pathname}${location.search}${next}`)
    }
  } catch {
    // 个别内嵌环境禁止改地址栏，忽略
  }
}
