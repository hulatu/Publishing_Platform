/**
 * 快捷键的平台差异
 *
 * 全局快捷键一直是「⌘ 或 Ctrl 都认」（App.tsx 里 metaKey || ctrlKey），
 * 但界面上的提示写死了 ⌘K / ⌘Enter —— Windows 上照着按 Win+K，打开的是系统的投放面板。
 * 这里只管两件事：提示怎么写给人看，以及按键怎么认。
 */

type UAData = { userAgentData?: { platform?: string } }

function detectApple(): boolean {
  if (typeof navigator === 'undefined') return true
  const nav = navigator as Navigator & UAData
  const platform = nav.userAgentData?.platform || nav.platform || nav.userAgent || ''
  return /Mac|iPhone|iPad|iPod/i.test(platform)
}

export const IS_APPLE = detectApple()

/** 写给人看：「⌘K」/「Ctrl K」 */
export function shortcutLabel(key: string): string {
  return IS_APPLE ? `⌘${key}` : `Ctrl ${key}`
}

/** aria-keyshortcuts 的写法：「Meta+K」/「Control+K」 */
export function ariaShortcut(key: string): string {
  return `${IS_APPLE ? 'Meta' : 'Control'}+${key}`
}

/**
 * 按的是不是某个字符键。
 *
 * 先看 key：尊重用户的键盘布局，Dvorak / AZERTY 上按出来是哪个字就是哪个字。
 * 只有 key 不是可打印 ASCII 时（俄文、希腊文这类非拉丁布局，按 K 位置出来的是「л」）
 * 才退回看物理位置 code —— 否则这些布局上快捷键整个失效。
 */
export function isKey(event: KeyboardEvent, char: string, code: string): boolean {
  if (/^[\x21-\x7e]$/.test(event.key)) return event.key.toLowerCase() === char.toLowerCase()
  return event.code === code
}
