/** 卡片数据模型 */

export type CardLayout = 'cover' | 'quote' | 'points' | 'end'

export interface CardSpec {
  id: string
  layout: CardLayout
  /** 主文字：封面标题 / 金句正文 / 要点标题 / 结尾总结 */
  title: string
  /** 副文字 */
  subtitle?: string
  /** 要点列表（仅 points 版式） */
  points?: string[]
  /** 左上角小标签，通常是分类 */
  kicker?: string
  /** 底部左侧署名 */
  footer?: string
  /** 底部右侧日期 */
  date?: string
  themeId: string
}

export const CARD_WIDTH = 540
export const CARD_HEIGHT = 720

export const layoutNames: Record<CardLayout, string> = {
  cover: '封面',
  quote: '金句',
  points: '要点',
  end: '结尾',
}

/**
 * 按字数自动收缩标题字号。
 * 不做真实测量（那需要 canvas 或 DOM 回流，代价高且不稳定），
 * 用分段阈值已经足够 —— 中文标题的字宽很均匀，阈值法误差很小。
 */
export function fitFontSize(
  text: string,
  base: number,
  min: number,
  thresholds: { len: number; scale: number }[],
): number {
  const len = [...text].length
  for (const t of thresholds) {
    if (len <= t.len) return Math.round(base * t.scale)
  }
  return min
}

export const TITLE_THRESHOLDS = [
  { len: 9, scale: 1 },
  { len: 14, scale: 0.88 },
  { len: 20, scale: 0.76 },
  { len: 28, scale: 0.66 },
  { len: 38, scale: 0.56 },
]

export const QUOTE_THRESHOLDS = [
  { len: 16, scale: 1 },
  { len: 26, scale: 0.88 },
  { len: 40, scale: 0.76 },
  { len: 60, scale: 0.64 },
  { len: 90, scale: 0.54 },
]
