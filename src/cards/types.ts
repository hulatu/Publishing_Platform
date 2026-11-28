/** 卡片数据模型 */

export type CardLayout =
  | 'cover'
  | 'quote'
  | 'points'
  | 'section'
  | 'stat'
  | 'toc'
  | 'compare'
  | 'cta'
  | 'end'

/** 字号档位：同一套版式整体放大或收小，不改排版骨架 */
export type CardSize = 'sm' | 'md' | 'lg'
/** 对齐：只影响文字块，装饰线与页脚始终跟着版心走 */
export type CardAlign = 'left' | 'center'
/** 纵向密度：段落间距与行距的疏密 */
export type CardDensity = 'compact' | 'normal' | 'airy'

/** 数据卡的一项指标 */
export interface CardStat {
  /** 大数字，如「98%」「3.2 倍」 */
  value: string
  /** 数字下面的一行说明 */
  label: string
}

export interface CardSpec {
  id: string
  layout: CardLayout
  /** 主文字：封面标题 / 金句正文 / 要点标题 / 小节标题 / 数据卡标题 / 对照卡左栏头 / 结尾总结 */
  title: string
  /** 副文字：封面摘要 / 金句出处 / 小节摘要 / 对照卡右栏头 / 结尾标签 */
  subtitle?: string
  /** 要点列表（points / toc）或对照条目（compare，每行「左 | 右」） */
  points?: string[]
  /** 数据卡的指标（stat） */
  stats?: CardStat[]
  /** 对照卡的两栏标题（compare） */
  leftLabel?: string
  rightLabel?: string
  /** 左上角小标签，通常是分类 */
  kicker?: string
  /** 右上角页码，形如 03 / 08；一套图连起来读时知道进度 */
  mark?: string
  /** 底部左侧署名 */
  footer?: string
  /** 底部右侧日期 */
  date?: string
  themeId: string

  /* ---- 排版档位（都可留空，留空即默认） ---- */
  size?: CardSize
  align?: CardAlign
  density?: CardDensity
  /** 显示开关：默认全开，关掉就不画那一块 */
  showKicker?: boolean
  showMark?: boolean
  showFooter?: boolean
}

export const sizeScale: Record<CardSize, number> = { sm: 0.88, md: 1, lg: 1.12 }
export const densityGap: Record<CardDensity, number> = { compact: 0.82, normal: 1, airy: 1.2 }

export function specSize(spec?: Pick<CardSpec, 'size'>): CardSize {
  return spec?.size ?? 'md'
}

export function specDensity(spec?: Pick<CardSpec, 'density'>): CardDensity {
  return spec?.density ?? 'normal'
}

/* ------------------------------------------------------------------ */
/* 导出尺寸                                                            */
/* ------------------------------------------------------------------ */

/**
 * 导出尺寸：只保留 3:4 小红书竖图。
 *
 * 成品像素 = CSS 尺寸 × 2（导出 pixelRatio: 2），模板按 CSS 像素排版。
 * 3:4 → 1080×1440，是卡片最常用的场景；方图和横版封面使用频率低，不再提供切换。
 */
export type CardFormatId = '3:4'

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
  stat: '数据',
  toc: '目录',
  compare: '对比',
  cta: '引导',
  end: '结尾',
}

/** 每种版式一句话说明，加卡菜单与编辑区共用 */
export const layoutHints: Record<CardLayout, string> = {
  cover: '标题 + 摘要，整套图的第一张',
  quote: '一句话金句 + 出处，适合当转发图',
  points: '带编号的要点清单，最多 5 条',
  section: '一个小节一张，标题 + 摘要',
  stat: '大数字配一行说明，最多 3 项',
  toc: '把各节标题排成目录，最多 6 条',
  compare: '左右两栏对照，每行「左 | 右」',
  cta: '居中收尾，引导关注或点开原文',
  end: '结语 + 话题标签',
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
