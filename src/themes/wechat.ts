/**
 * 公众号排版主题
 *
 * 一套主题 = 配色 + 若干「结构开关」。只换颜色的话，十几套主题看起来会是同一篇
 * 文章换了件衣服；真正拉开差距的是标题形态、是否衬线、首行缩进、引用块形态、
 * 代码块明暗、表格线条。
 *
 * 设计约束（微信编辑器会吃掉的东西）：
 * - 不能用 `::before` / `::after`，所以 H2 编号只能靠渲染时注入真实 <span>
 * - `box-shadow`、`linear-gradient` 不稳定，一律不用
 * - 不能用 class，所有样式必须内联；外层 <section> 承载全局样式靠继承省字符
 * - 正文上限 20000 字，但 HTML 体积越大粘贴越慢，所以共用项尽量上提到 root
 *
 * 中文正文的两个经验：
 * - 加粗不要用纯黑，用强调色 + 600 字重，纯黑加粗在中文里显得笨重
 * - 衬线体在 iOS 上是宋体，安卓常退化成黑体；所以衬线主题的差异不能只靠字体，
 *   还要配合首行缩进和居中标题才站得住
 */

import type { HtmlTheme, StyleMap } from '../core/html-inline'

// 字体名一律用单引号：这些字符串最终会进 style="..." 属性，
// 双引号会把属性提前闭合（见 html-inline.ts 里 attr() 的注释）
const FONT_SANS =
  "-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif"
const FONT_SERIF =
  "Georgia,'Songti SC','Source Han Serif SC','Noto Serif CJK SC','SimSun',serif"
const FONT_MONO = "Menlo,Consolas,'Liberation Mono',monospace"

/** 主题分组，只影响选择器的排布 */
export type ThemeGroup = '极简' | '书卷' | '色块' | '商务'

/** 标题形态：左竖线 / 零装饰 / 下划线 / 居中细线 / 色块 / 编号 */
export type HeadingVariant = 'bar' | 'plain' | 'underline' | 'center' | 'block' | 'index'
export type QuoteVariant = 'bar' | 'box' | 'plain'
export type CodeVariant = 'light' | 'dark'
export type TableVariant = 'bordered' | 'minimal'

interface Palette {
  /** 文章底色 */
  bg: string
  text: string
  heading: string
  secondary: string
  accent: string
  /** 强调色的浅底：色块标题、表头 */
  accentSoft: string
  /** 浅底上的文字色 */
  accentInk: string
  line: string
  softBg: string
  codeBg: string
  codeText: string
}

interface ThemeSpec {
  id: string
  name: string
  group: ThemeGroup
  /** 一句话说明，显示在选择卡片上 */
  hint: string
  palette: Palette
  heading: HeadingVariant
  quote: QuoteVariant
  code: CodeVariant
  table: TableVariant
  serif?: boolean
  /** 首行缩进两字 */
  indent?: boolean
  lineHeight?: string
  letterSpacing?: string
  pSize?: string
}

/* ------------------------------------------------------------------ */
/* 结构分支                                                            */
/* ------------------------------------------------------------------ */

function buildHeading(spec: ThemeSpec): HtmlTheme['heading'] {
  const p = spec.palette
  const base: StyleMap = {
    'font-weight': '700',
    color: p.heading,
    'line-height': '1.4',
    'letter-spacing': '0.3px',
  }

  switch (spec.heading) {
    case 'bar':
      return {
        2: { ...base, 'font-size': '19px', margin: '2.2em 0 1em', 'padding-left': '12px', 'border-left': `3px solid ${p.accent}` },
        3: { ...base, 'font-size': '17px', margin: '1.9em 0 0.8em', 'padding-left': '10px', 'border-left': `3px solid ${p.accent}`, opacity: '0.95' },
        4: { ...base, 'font-size': '16px', margin: '1.7em 0 0.7em', color: p.accent },
      }

    case 'plain':
      return {
        2: { ...base, 'font-size': '20px', margin: '2.6em 0 1.1em', 'letter-spacing': '1px' },
        3: { ...base, 'font-size': '17.5px', margin: '2.1em 0 0.9em' },
        4: { ...base, 'font-size': '16px', margin: '1.8em 0 0.7em', color: p.secondary },
      }

    case 'underline':
      return {
        2: { ...base, 'font-size': '19px', margin: '2.4em 0 1.1em', 'padding-bottom': '8px', 'border-bottom': `2px solid ${p.accent}` },
        3: { ...base, 'font-size': '17px', margin: '2em 0 0.9em', 'padding-bottom': '6px', 'border-bottom': `1px solid ${p.line}` },
        4: { ...base, 'font-size': '16px', margin: '1.7em 0 0.7em', color: p.accent },
      }

    case 'center':
      return {
        2: {
          ...base,
          'font-size': '19px',
          margin: '2.6em 0 1.3em',
          'text-align': 'center',
          'letter-spacing': '2px',
          padding: '10px 0',
          'border-top': `1px solid ${p.line}`,
          'border-bottom': `1px solid ${p.line}`,
        },
        3: { ...base, 'font-size': '17px', margin: '2em 0 0.9em', 'text-align': 'center', 'letter-spacing': '1px' },
        4: { ...base, 'font-size': '16px', margin: '1.7em 0 0.7em', color: p.accent },
      }

    case 'block':
      return {
        2: { ...base, 'font-size': '18px', margin: '2.2em 0 1em', padding: '10px 14px', 'background-color': p.accentSoft, color: p.accentInk, 'border-radius': '4px' },
        3: { ...base, 'font-size': '16.5px', margin: '1.9em 0 0.8em', padding: '6px 12px', 'background-color': p.softBg, color: p.heading, 'border-radius': '4px' },
        4: { ...base, 'font-size': '16px', margin: '1.7em 0 0.7em', color: p.accent },
      }

    case 'index':
      return {
        2: { ...base, 'font-size': '19px', margin: '2.4em 0 1.1em' },
        3: { ...base, 'font-size': '17px', margin: '2em 0 0.9em', 'padding-left': '10px', 'border-left': `2px solid ${p.line}` },
        4: { ...base, 'font-size': '16px', margin: '1.7em 0 0.7em', color: p.accent },
      }
  }
}

function buildQuote(spec: ThemeSpec): { quote: StyleMap; quoteP: StyleMap } {
  const p = spec.palette
  const quoteP: StyleMap = { margin: '0 0 0.6em', color: p.secondary, 'font-size': '15px', 'line-height': '1.8' }

  switch (spec.quote) {
    case 'bar':
      return {
        quote: {
          margin: '1.6em 0',
          padding: '14px 16px',
          'background-color': p.softBg,
          'border-left': `3px solid ${p.accent}`,
          'border-radius': '0 4px 4px 0',
        },
        quoteP,
      }

    case 'box':
      return {
        quote: {
          margin: '1.8em 0',
          padding: '16px 18px',
          'background-color': p.softBg,
          border: `1px solid ${p.line}`,
          'border-radius': '8px',
        },
        quoteP,
      }

    case 'plain':
      return {
        quote: {
          margin: '1.8em 0',
          padding: '0 0 0 1.2em',
          'border-left': `2px solid ${p.line}`,
        },
        quoteP: { ...quoteP, 'font-style': 'italic' },
      }
  }
}

function buildCode(spec: ThemeSpec): { codeBlock: StyleMap; inlineCode: StyleMap } {
  const p = spec.palette

  const inlineCode: StyleMap = {
    'font-family': FONT_MONO,
    'font-size': '0.9em',
    color: p.accent,
    'background-color': p.codeBg,
    padding: '2px 5px',
    'border-radius': '3px',
    'word-break': 'break-all',
  }

  if (spec.code === 'dark') {
    return {
      inlineCode,
      codeBlock: {
        'background-color': '#1f2430',
        'border-radius': '8px',
        padding: '16px',
        margin: '0 0 1.5em',
        'font-family': FONT_MONO,
        'font-size': '13px',
        'line-height': '1.7',
        color: '#d4dae6',
        'white-space': 'pre-wrap',
        'word-break': 'break-all',
        'letter-spacing': '0',
      },
    }
  }

  return {
    inlineCode,
    codeBlock: {
      'background-color': p.codeBg,
      'border-radius': '6px',
      padding: '14px 16px',
      margin: '0 0 1.5em',
      'font-family': FONT_MONO,
      'font-size': '13px',
      'line-height': '1.7',
      color: p.codeText,
      'white-space': 'pre-wrap',
      'word-break': 'break-all',
      'letter-spacing': '0',
    },
  }
}

function buildTable(spec: ThemeSpec): { table: StyleMap; th: StyleMap; td: StyleMap } {
  const p = spec.palette
  const table: StyleMap = { width: '100%', 'border-collapse': 'collapse', 'font-size': '14px', margin: '0 0 1.5em' }

  if (spec.table === 'minimal') {
    return {
      table,
      th: {
        'background-color': 'transparent',
        'border-bottom': `2px solid ${p.accent}`,
        padding: '10px 8px',
        'font-weight': '600',
        color: p.heading,
        'text-align': 'left',
      },
      td: {
        border: 'none',
        'border-bottom': `1px solid ${p.line}`,
        padding: '10px 8px',
        'text-align': 'left',
      },
    }
  }

  return {
    table,
    th: {
      'background-color': p.softBg,
      border: `1px solid ${p.line}`,
      padding: '8px 10px',
      'font-weight': '600',
      color: p.heading,
      'text-align': 'left',
    },
    td: {
      border: `1px solid ${p.line}`,
      padding: '8px 10px',
      'text-align': 'left',
    },
  }
}

/* ------------------------------------------------------------------ */
/* 组装                                                                */
/* ------------------------------------------------------------------ */

function makeTheme(spec: ThemeSpec): HtmlTheme {
  const p = spec.palette
  const { quote, quoteP } = buildQuote(spec)
  const { codeBlock, inlineCode } = buildCode(spec)
  const { table, th, td } = buildTable(spec)

  const root: StyleMap = {
    'font-family': spec.serif ? FONT_SERIF : FONT_SANS,
    'font-size': spec.pSize ?? '16px',
    'line-height': spec.lineHeight ?? '1.75',
    'letter-spacing': spec.letterSpacing ?? '0.5px',
    color: p.text,
    'background-color': p.bg,
    'word-break': 'break-word',
    'text-align': 'left',
  }

  const theme: HtmlTheme = {
    id: spec.id,
    name: spec.name,
    group: spec.group,
    hint: spec.hint,
    swatch: { bg: p.bg, accent: p.accent, ink: p.text },

    root,

    heading: buildHeading(spec),

    p: {
      margin: '0 0 1.4em',
      'line-height': spec.lineHeight ?? '1.75',
      'letter-spacing': spec.letterSpacing ?? '0.5px',
      'text-align': 'justify',
      ...(spec.indent ? { 'text-indent': '2em' } : {}),
    },

    strong: { 'font-weight': '600', color: p.accent },

    em: { 'font-style': 'italic', color: p.heading },

    del: { 'text-decoration': 'line-through', color: p.secondary },

    inlineCode,
    link: { color: p.accent, 'text-decoration': 'none', 'border-bottom': `1px solid ${p.accent}` },
    linkMark: {
      'font-size': '11px',
      color: p.accent,
      'vertical-align': 'super',
      'line-height': '0',
      'letter-spacing': '0',
    },

    imgBlock: { 'max-width': '100%', height: 'auto', display: 'block', margin: '0 auto', 'border-radius': '6px' },
    imgInline: { 'max-width': '100%', height: 'auto', 'vertical-align': 'middle', 'border-radius': '4px' },
    // 图注：正文的 0.82 倍（16px → 13px，15px → 12px），永远比正文小一号；
    // 写死 13px 的话，14px 正文字号的主题里几乎看不出区别
    caption: {
      'font-size': `${Math.max(11, Math.round(parseFloat(spec.pSize ?? '16') * 0.82))}px`,
      color: p.secondary,
      'text-align': 'center',
      'line-height': '1.6',
      'margin-top': '10px',
      'letter-spacing': '0.3px',
    },

    quote,
    quoteP,

    list: { margin: '0 0 1.4em', 'padding-left': '1.5em' },
    listItem: { margin: '0 0 0.5em', 'line-height': spec.lineHeight ?? '1.75' },

    codeBlock,
    codeLine: {},
    table,
    th,
    td,

    hr: {
      'border-top': `1px solid ${p.line}`,
      margin: '2.4em 0',
      height: '0',
      'font-size': '0',
      'line-height': '0',
    },

    refsTitle: {
      'font-size': '15px',
      'font-weight': '600',
      color: p.heading,
      margin: '2.4em 0 0.9em',
      'padding-top': '1.2em',
      'border-top': `1px solid ${p.line}`,
      'letter-spacing': '0.5px',
    },
    refsItem: { 'font-size': '13px', color: p.secondary, 'line-height': '1.8', margin: '0 0 0.7em', 'letter-spacing': '0.2px' },
    fnTitle: {
      'font-size': '15px',
      'font-weight': '600',
      color: p.heading,
      margin: '2.4em 0 0.9em',
      'padding-top': '1.2em',
      'border-top': `1px solid ${p.line}`,
    },
    fnItem: { 'font-size': '13px', color: p.secondary, 'line-height': '1.8', margin: '0 0 0.6em' },
  }

  // 编号主题：H2 前注入 01 / 02 …（微信剥 ::before，只能生成真实节点）
  if (spec.heading === 'index') {
    theme.headingIndex = {
      format: 'pad',
      style: {
        'font-family': FONT_MONO,
        'font-size': '15px',
        'font-weight': '700',
        color: p.accent,
        'margin-right': '10px',
        'letter-spacing': '0.5px',
      },
    }
  }

  return theme
}

/* ------------------------------------------------------------------ */
/* 主题清单                                                            */
/* ------------------------------------------------------------------ */

export const paperTheme = makeTheme({
  id: 'paper',
  name: '纸白',
  group: '极简',
  hint: '红竖线，最稳的默认款',
  heading: 'bar',
  quote: 'bar',
  code: 'light',
  table: 'bordered',
  palette: {
    bg: '#ffffff',
    text: '#3f3f3f',
    heading: '#1a1a1a',
    secondary: '#7a7a7a',
    accent: '#c0392b',
    accentSoft: '#f7e9e7',
    accentInk: '#8f2c21',
    line: '#e8e4de',
    softBg: '#faf8f5',
    codeBg: '#f5f4f2',
    codeText: '#3a3a3a',
  },
})

const plainTheme = makeTheme({
  id: 'plain',
  name: '素页',
  group: '极简',
  hint: '零装饰，只靠字号和留白',
  heading: 'plain',
  quote: 'plain',
  code: 'light',
  table: 'minimal',
  lineHeight: '1.9',
  letterSpacing: '0.8px',
  palette: {
    bg: '#ffffff',
    text: '#2f2f2f',
    heading: '#111111',
    secondary: '#8c8c8c',
    accent: '#2f2f2f',
    accentSoft: '#f2f2f2',
    accentInk: '#111111',
    line: '#e9e9e9',
    softBg: '#f7f7f7',
    codeBg: '#f4f4f4',
    codeText: '#333333',
  },
})

const inkTheme = makeTheme({
  id: 'ink',
  name: '墨线',
  group: '极简',
  hint: '下划线标题，冷静克制',
  heading: 'underline',
  quote: 'bar',
  code: 'light',
  table: 'minimal',
  palette: {
    bg: '#ffffff',
    text: '#33383d',
    heading: '#15181c',
    secondary: '#7c858d',
    accent: '#33475b',
    accentSoft: '#e8edf2',
    accentInk: '#263646',
    line: '#e2e6ea',
    softBg: '#f6f8fa',
    codeBg: '#f3f5f7',
    codeText: '#333333',
  },
})

const serifTheme = makeTheme({
  id: 'serif',
  name: '宋刻',
  group: '书卷',
  hint: '衬线 + 首行缩进 + 居中标题',
  heading: 'center',
  quote: 'box',
  code: 'light',
  table: 'minimal',
  serif: true,
  indent: true,
  lineHeight: '1.9',
  letterSpacing: '0.6px',
  palette: {
    bg: '#fffefb',
    text: '#332f2a',
    heading: '#1c1a17',
    secondary: '#8a8175',
    accent: '#8c6a4a',
    accentSoft: '#f3ece3',
    accentInk: '#6d5138',
    line: '#e6dfd3',
    softBg: '#faf6ef',
    codeBg: '#f4efe6',
    codeText: '#3a3a3a',
  },
})

export const sepiaTheme = makeTheme({
  id: 'sepia',
  name: '米黄',
  group: '书卷',
  hint: '旧纸暖棕，久看不累',
  heading: 'bar',
  quote: 'bar',
  code: 'light',
  table: 'bordered',
  serif: true,
  indent: true,
  lineHeight: '1.85',
  palette: {
    bg: '#fbf8f3',
    text: '#4a443c',
    heading: '#2e2a24',
    secondary: '#8a7f70',
    accent: '#8b5e3c',
    accentSoft: '#f0e6d8',
    accentInk: '#6b4526',
    line: '#e5ddd0',
    softBg: '#f3ece1',
    codeBg: '#f2ebe0',
    codeText: '#3a3a3a',
  },
})

const pressTheme = makeTheme({
  id: 'press',
  name: '铅字',
  group: '书卷',
  hint: '报纸感，粗横线分节',
  heading: 'underline',
  quote: 'plain',
  code: 'light',
  table: 'minimal',
  serif: true,
  indent: true,
  lineHeight: '1.9',
  letterSpacing: '0.4px',
  palette: {
    bg: '#fdfcf8',
    text: '#26241f',
    heading: '#0f0e0c',
    secondary: '#7d776c',
    accent: '#1a1a1a',
    accentSoft: '#eeece5',
    accentInk: '#1a1a1a',
    line: '#d8d4c8',
    softBg: '#f4f2ea',
    codeBg: '#f1efe7',
    codeText: '#333333',
  },
})

const blockTheme = makeTheme({
  id: 'block',
  name: '靛蓝',
  group: '色块',
  hint: '标题带底色块，层次分明',
  heading: 'block',
  quote: 'box',
  code: 'light',
  table: 'bordered',
  palette: {
    bg: '#ffffff',
    text: '#333a42',
    heading: '#1b2833',
    secondary: '#7b8794',
    accent: '#2c5f8a',
    accentSoft: '#e6eef5',
    accentInk: '#1f4666',
    line: '#dde5ec',
    softBg: '#f4f8fb',
    codeBg: '#f2f6f9',
    codeText: '#333333',
  },
})

const indexTheme = makeTheme({
  id: 'index',
  name: '序号',
  group: '色块',
  hint: '01/02 编号，适合清单式长文',
  heading: 'index',
  quote: 'bar',
  code: 'light',
  table: 'minimal',
  palette: {
    bg: '#ffffff',
    text: '#3b3733',
    heading: '#1f1c19',
    secondary: '#8a8178',
    accent: '#d97706',
    accentSoft: '#fdf3e3',
    accentInk: '#a85c04',
    line: '#eae3d8',
    softBg: '#fdf9f2',
    codeBg: '#faf5ec',
    codeText: '#3a3a3a',
  },
})

const mintTheme = makeTheme({
  id: 'mint',
  name: '薄荷',
  group: '色块',
  hint: '浅绿圆角，轻快不轻浮',
  heading: 'block',
  quote: 'box',
  code: 'light',
  table: 'minimal',
  palette: {
    bg: '#fcfdfc',
    text: '#31403a',
    heading: '#16241e',
    secondary: '#7a8a83',
    accent: '#2f8f6f',
    accentSoft: '#e4f2ec',
    accentInk: '#1f6b52',
    line: '#d9e8e1',
    softBg: '#f2f9f6',
    codeBg: '#f1f7f4',
    codeText: '#333333',
  },
})

export const navyTheme = makeTheme({
  id: 'navy',
  name: '藏青',
  group: '商务',
  hint: '深色代码块，技术文首选',
  heading: 'bar',
  quote: 'bar',
  code: 'dark',
  table: 'bordered',
  palette: {
    bg: '#ffffff',
    text: '#3a3a3a',
    heading: '#1b3a5c',
    secondary: '#7b8794',
    accent: '#1b3a5c',
    accentSoft: '#e7eef5',
    accentInk: '#15304d',
    line: '#dde4ec',
    softBg: '#f4f7fa',
    codeBg: '#f4f6f9',
    codeText: '#3a3a3a',
  },
})

const slateTheme = makeTheme({
  id: 'slate',
  name: '石墨',
  group: '商务',
  hint: '无装饰标题 + 深色代码，最干练',
  heading: 'plain',
  quote: 'box',
  code: 'dark',
  table: 'minimal',
  lineHeight: '1.8',
  letterSpacing: '0.6px',
  palette: {
    bg: '#fbfbfc',
    text: '#34383d',
    heading: '#1a1d21',
    secondary: '#79808a',
    accent: '#3d4451',
    accentSoft: '#eceef1',
    accentInk: '#2a2f38',
    line: '#e3e6ea',
    softBg: '#f4f5f7',
    codeBg: '#f2f3f5',
    codeText: '#333333',
  },
})

const morandiTheme = makeTheme({
  id: 'morandi',
  name: '莫兰迪',
  group: '商务',
  hint: '低饱和豆沙色，柔和不刺眼',
  heading: 'underline',
  quote: 'box',
  code: 'light',
  table: 'minimal',
  lineHeight: '1.85',
  palette: {
    bg: '#fdfcfa',
    text: '#4a423d',
    heading: '#2f2a26',
    secondary: '#948a83',
    accent: '#a8836f',
    accentSoft: '#f3eae4',
    accentInk: '#8a6a58',
    line: '#e8e0d9',
    softBg: '#f8f3ef',
    codeBg: '#f6f0ec',
    codeText: '#3a3a3a',
  },
})

export const wechatThemes: HtmlTheme[] = [
  paperTheme,
  plainTheme,
  inkTheme,
  serifTheme,
  sepiaTheme,
  pressTheme,
  blockTheme,
  indexTheme,
  mintTheme,
  navyTheme,
  slateTheme,
  morandiTheme,
]

/** 按分组排好的主题，供选择器渲染 */
export const themeGroups: { name: ThemeGroup; themes: HtmlTheme[] }[] = (
  ['极简', '书卷', '色块', '商务'] as ThemeGroup[]
).map((name) => ({ name, themes: wechatThemes.filter((t) => t.group === name) }))

export function getWechatTheme(id: string): HtmlTheme {
  return wechatThemes.find((t) => t.id === id) ?? paperTheme
}

/** 豆瓣用：更朴素，贴近豆瓣日记的默认观感 */
export const doubanTheme: HtmlTheme = makeTheme({
  id: 'douban',
  name: '豆瓣',
  group: '极简',
  hint: '贴近豆瓣日记默认观感',
  heading: 'bar',
  quote: 'bar',
  code: 'light',
  table: 'bordered',
  palette: {
    bg: '#ffffff',
    text: '#333333',
    heading: '#111111',
    secondary: '#888888',
    accent: '#3377aa',
    accentSoft: '#eaf1f7',
    accentInk: '#2b6491',
    line: '#e6e6e6',
    softBg: '#f6f6f6',
    codeBg: '#f4f4f4',
    codeText: '#333333',
  },
})
