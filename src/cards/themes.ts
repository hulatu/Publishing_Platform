/**
 * 卡片配色（Kami 纸感一系）
 *
 * 取色参照 tw93/kami 的设计系统：暖米纸的画布、油墨蓝作唯一强调色、
 * 灰都偏暖（R ≈ G > B），标签底色只用实色 hex。
 *
 * 约束（html-to-image 的 SVG foreignObject 渲染）：
 * 全部只用纯色 / 线性渐变 / 细线 / 圆角，禁用 backdrop-filter、filter:blur、
 * mix-blend-mode、mask —— 这些在导出时会失败或产生黑边，是踩坑的主要来源。
 *
 * 每一套都要满足：muted 在 bg 上 ≥ 4.5:1、ink 在 bg 上 ≥ 12:1，
 * 否则缩到小图里先糊的就是说明文字。scripts/check-contrast.ts 不覆盖这里，
 * 改色时请人工核对一遍。
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
  /** 标签底色（实色，不用 rgba） */
  tint: string
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
    bg: '#f5f4ed',
    ink: '#141413',
    muted: '#6b6a64',
    line: '#e2ddcf',
    accent: '#1b365d',
    onAccent: '#f5f4ed',
    tint: '#e4ecf5',
    ornament: 'rule',
    ornamentColor: '#1b365d',
    dark: false,
  },
  {
    id: 'ivory',
    name: '象牙',
    bg: '#faf9f5',
    ink: '#1d1c19',
    muted: '#7d786e',
    line: '#e9e5db',
    accent: '#2d5a8a',
    onAccent: '#faf9f5',
    tint: '#eef2f7',
    ornament: 'corner',
    ornamentColor: '#e8e6dc',
    dark: false,
  },
  {
    id: 'sand',
    name: '暖砂',
    bg: '#e8e6dc',
    ink: '#26241f',
    muted: '#6f6a5f',
    line: '#d3cfbf',
    accent: '#8b5e3c',
    onAccent: '#faf9f5',
    tint: '#f1ebdf',
    ornament: 'rule',
    ornamentColor: '#8b5e3c',
    dark: false,
  },
  {
    id: 'clay',
    name: '陶红',
    bg: '#f4eae5',
    ink: '#2b2320',
    muted: '#7d6a62',
    line: '#e2d2c9',
    accent: '#b53333',
    onAccent: '#fdf7f4',
    tint: '#f7e3dd',
    ornament: 'band',
    ornamentColor: '#b53333',
    dark: false,
  },
  {
    id: 'moss',
    name: '苔绿',
    bg: '#eef0e6',
    ink: '#23271f',
    muted: '#6d7163',
    line: '#dbe0cf',
    accent: '#4a5d3f',
    onAccent: '#f5f4ed',
    tint: '#e2e8d6',
    ornament: 'corner',
    ornamentColor: '#d5ddc6',
    dark: false,
  },
  {
    id: 'ink',
    name: '墨黑',
    bg: '#141413',
    ink: '#f5f4ed',
    muted: '#9a968c',
    line: '#2f2e2a',
    accent: '#d9a441',
    onAccent: '#141413',
    tint: '#2a2823',
    ornament: 'band',
    ornamentColor: '#d9a441',
    dark: true,
  },
  {
    id: 'navy',
    name: '藏青',
    bg: '#1b365d',
    ink: '#f5f4ed',
    muted: '#b9c6d8',
    line: '#2f4d73',
    accent: '#e8e6dc',
    onAccent: '#1b365d',
    tint: '#27476f',
    ornament: 'corner',
    ornamentColor: '#2d5a8a',
    dark: true,
  },
  {
    id: 'plain',
    name: '纯白',
    bg: '#ffffff',
    ink: '#141413',
    muted: '#6b6a64',
    line: '#ececec',
    accent: '#1b365d',
    onAccent: '#ffffff',
    tint: '#eef2f7',
    ornament: 'none',
    ornamentColor: '#ececec',
    dark: false,
  },
]

export function getCardTheme(id: string): CardTheme {
  return cardThemes.find((t) => t.id === id) ?? cardThemes[0]
}
