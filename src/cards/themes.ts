/**
 * 卡片配色（极简杂志风）
 *
 * 全部只用纯色 / 线性渐变 / 细线 / 圆角，禁用 backdrop-filter、filter:blur、
 * mix-blend-mode、mask —— 这些在 html-to-image 的 SVG foreignObject 渲染里会失败
 * 或产生黑边，是导出踩坑的主要来源。
 */

export interface CardTheme {
  id: string
  name: string
  bg: string
  /** 主文字色 */
  ink: string
  /** 次级文字色 */
  muted: string
  /** 细线色 */
  line: string
  /** 强调色 */
  accent: string
  /** 强调色上的文字色 */
  onAccent: string
  /** 背景装饰 */
  ornament: 'rule' | 'corner' | 'band' | 'none'
  /** 装饰用色（通常比 accent 更淡） */
  ornamentColor: string
  dark: boolean
}

export const cardThemes: CardTheme[] = [
  {
    id: 'paper',
    name: '纸白',
    bg: '#faf8f5',
    ink: '#1a1a1a',
    muted: '#8a8580',
    line: '#e5e1da',
    accent: '#c0392b',
    onAccent: '#ffffff',
    ornament: 'rule',
    ornamentColor: '#c0392b',
    dark: false,
  },
  {
    id: 'sand',
    name: '米黄',
    bg: '#f2ead9',
    ink: '#2e2a24',
    muted: '#8a7f70',
    line: '#dfd3bd',
    accent: '#8b5e3c',
    onAccent: '#ffffff',
    ornament: 'corner',
    ornamentColor: '#c9b394',
    dark: false,
  },
  {
    id: 'ink',
    name: '墨黑',
    bg: '#17171a',
    ink: '#f2efe9',
    muted: '#8f8b84',
    line: '#2e2e33',
    accent: '#d9a441',
    onAccent: '#17171a',
    ornament: 'band',
    ornamentColor: '#242428',
    dark: true,
  },
  {
    id: 'navy',
    name: '藏青',
    bg: '#f4f7fa',
    ink: '#1b3a5c',
    muted: '#7b8794',
    line: '#dde4ec',
    accent: '#c0392b',
    onAccent: '#ffffff',
    ornament: 'rule',
    ornamentColor: '#1b3a5c',
    dark: false,
  },
  {
    id: 'plain',
    name: '纯白',
    bg: '#ffffff',
    ink: '#111111',
    muted: '#999999',
    line: '#ececec',
    accent: '#111111',
    onAccent: '#ffffff',
    ornament: 'none',
    ornamentColor: '#ececec',
    dark: false,
  },
]

export function getCardTheme(id: string): CardTheme {
  return cardThemes.find((t) => t.id === id) ?? cardThemes[0]
}
