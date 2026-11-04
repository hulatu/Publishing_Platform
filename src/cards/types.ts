/** 卡片数据模型 */

export type CardLayout = 'cover' | 'quote' | 'points' | 'section' | 'end'

export interface CardSpec {
  id: string
  layout: CardLayout
  /** 主文字：封面标题 / 金句正文 / 要点标题 / 小节标题 / 结尾总结 */
  title: string
  /** 副文字：封面摘要 / 金句出处 / 小节摘要 / 结尾标签 */
  subtitle?: string
  /** 要点列表（仅 points 版式） */
  points?: string[]
  /** 左上角小标签，通常是分类 */
  kicker?: string
  /** 右上角页码，形如 03 / 08；一套图连起来读时知道进度 */
  mark?: string
  /** 底部左侧署名 */
  footer?: string
  /** 底部右侧日期 */
  date?: string
  themeId: string
}

/* ------------------------------------------------------------------ */
/* 导出尺寸                                                            */
/* ------------------------------------------------------------------ */

/**
 * 三个比例都是「CSS 尺寸 × 2 = 成品像素」，和 3:4 那套一样：
 * 模板按 CSS 像素排版，导出时 pixelRatio: 2，内存只翻两倍。
 * 尺寸取各平台推荐的成品像素反推，不是随便定的：
 * - 3:4  → 1080×1440 小红书标准竖图
 * - 1:1  → 1280×1280 朋友圈 / 方图，微信不压缩
 * - 16:9 → 1920×1080 视频号封面 / 横版首图
 */
export type CardFormatId = '3:4' | '1:1' | '16:9'

export interface CardFormat {
  id: CardFormatId
  label: string
  hint: string
  /** CSS 宽度（导出时 ×2） */
  w: number
  /** CSS 高度（导出时 ×2） */
  h: number
}

export const CARD_FORMATS: CardFormat[] = [
  { id: '3:4', label: '3:4', hint: '小红书竖图 1080×1440', w: 540, h: 720 },
  { id: '1:1', label: '1:1', hint: '方图 1280×1280', w: 640, h: 640 },
  { id: '16:9', label: '16:9', hint: '横版封面 1920×1080', w: 960, h: 540 },
]

export function getCardFormat(id: CardFormatId): CardFormat {
  return CARD_FORMATS.find((f) => f.id === id) ?? CARD_FORMATS[0]
}

/** 默认尺寸，模板与预览的基准 */
export const CARD_WIDTH = 540
export const CARD_HEIGHT = 720

export const layoutNames: Record<CardLayout, string> = {
  cover: '封面',
  quote: '金句',
  points: '要点',
  section: '小节',
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
