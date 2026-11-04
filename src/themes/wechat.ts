/**
 * 公众号排版主题
 *
 * 三套主题共用同一套结构，只换配色，便于统一维护。
 *
 * 设计取向（对应「极简杂志风」）：
 * - 全局字体/行高/字距挂在外层 <section>，靠继承压缩字符数
 * - 加粗不用纯黑，而用强调色 + 600 字重 —— 中文正文里纯黑加粗会显得笨重
 * - 段落不首行缩进，靠 1.4em 段间距分隔（更接近现代杂志与网页阅读）
 * - 标题用左侧 3px 强调色竖线，替代大色块
 */

import type { HtmlTheme, StyleMap } from '../core/html-inline'

const FONT_SANS =
  '-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif'
const FONT_MONO = 'Menlo,Consolas,"Liberation Mono",monospace'

interface Palette {
  bg: string
  text: string
  heading: string
  secondary: string
  accent: string
  line: string
  softBg: string
  codeBg: string
}

function makeTheme(id: string, name: string, p: Palette): HtmlTheme {
  const headingBase: StyleMap = {
    'font-weight': '700',
    color: p.heading,
    'line-height': '1.4',
    'letter-spacing': '0.3px',
  }

  return {
    id,
    name,

    root: {
      'font-family': FONT_SANS,
      'font-size': '16px',
      'line-height': '1.75',
      'letter-spacing': '0.5px',
      color: p.text,
      'background-color': p.bg,
      'word-break': 'break-word',
      'text-align': 'left',
    },

    heading: {
      2: {
        ...headingBase,
        'font-size': '19px',
        margin: '2.2em 0 1em',
        'padding-left': '12px',
        'border-left': `3px solid ${p.accent}`,
      },
      3: {
        ...headingBase,
        'font-size': '17px',
        margin: '1.9em 0 0.8em',
        'padding-left': '10px',
        'border-left': `3px solid ${p.accent}`,
        opacity: '0.95',
      },
      4: {
        ...headingBase,
        'font-size': '16px',
        margin: '1.7em 0 0.7em',
        color: p.accent,
      },
    },

    p: {
      margin: '0 0 1.4em',
      'line-height': '1.75',
      'letter-spacing': '0.5px',
      'text-align': 'justify',
    },

    strong: {
      'font-weight': '600',
      color: p.accent,
    },

    em: {
      'font-style': 'italic',
      color: p.heading,
    },

    del: {
      'text-decoration': 'line-through',
      color: p.secondary,
    },

    inlineCode: {
      'font-family': FONT_MONO,
      'font-size': '0.9em',
      color: p.accent,
      'background-color': p.codeBg,
      padding: '2px 5px',
      'border-radius': '3px',
      'word-break': 'break-all',
    },

    link: {
      color: p.accent,
      'text-decoration': 'none',
      'border-bottom': `1px solid ${p.accent}`,
    },

    linkMark: {
      'font-size': '11px',
      color: p.accent,
      'vertical-align': 'super',
      'line-height': '0',
      'letter-spacing': '0',
    },

    imgBlock: {
      'max-width': '100%',
      height: 'auto',
      display: 'block',
      margin: '0 auto',
      'border-radius': '6px',
    },

    imgInline: {
      'max-width': '100%',
      height: 'auto',
      'vertical-align': 'middle',
      'border-radius': '4px',
    },

    caption: {
      'font-size': '13px',
      color: p.secondary,
      'text-align': 'center',
      'line-height': '1.6',
      'margin-top': '10px',
      'letter-spacing': '0.3px',
    },

    quote: {
      margin: '1.6em 0',
      padding: '14px 16px',
      'background-color': p.softBg,
      'border-left': `3px solid ${p.accent}`,
      'border-radius': '0 4px 4px 0',
    },

    quoteP: {
      margin: '0 0 0.6em',
      color: p.secondary,
      'font-size': '15px',
    },

    list: {
      margin: '0 0 1.4em',
      'padding-left': '1.5em',
    },

    listItem: {
      margin: '0 0 0.5em',
      'line-height': '1.75',
    },

    codeBlock: {
      'background-color': p.codeBg,
      'border-radius': '6px',
      padding: '14px 16px',
      margin: '0 0 1.5em',
      'font-family': FONT_MONO,
      'font-size': '13px',
      'line-height': '1.7',
      color: '#3a3a3a',
      'white-space': 'pre-wrap',
      'word-break': 'break-all',
      'letter-spacing': '0',
    },

    codeLine: {},

    table: {
      width: '100%',
      'border-collapse': 'collapse',
      'font-size': '14px',
      margin: '0 0 1.5em',
    },

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

    refsItem: {
      'font-size': '13px',
      color: p.secondary,
      'line-height': '1.8',
      margin: '0 0 0.7em',
      'letter-spacing': '0.2px',
    },

    fnTitle: {
      'font-size': '15px',
      'font-weight': '600',
      color: p.heading,
      margin: '2.4em 0 0.9em',
      'padding-top': '1.2em',
      'border-top': `1px solid ${p.line}`,
    },

    fnItem: {
      'font-size': '13px',
      color: p.secondary,
      'line-height': '1.8',
      margin: '0 0 0.6em',
    },
  }
}

export const paperTheme = makeTheme('paper', '纸白', {
  bg: '#ffffff',
  text: '#3f3f3f',
  heading: '#1a1a1a',
  secondary: '#7a7a7a',
  accent: '#c0392b',
  line: '#e8e4de',
  softBg: '#faf8f5',
  codeBg: '#f5f4f2',
})

export const sepiaTheme = makeTheme('sepia', '米黄书页', {
  bg: '#fbf8f3',
  text: '#4a443c',
  heading: '#2e2a24',
  secondary: '#8a7f70',
  accent: '#8b5e3c',
  line: '#e5ddd0',
  softBg: '#f3ece1',
  codeBg: '#f2ebe0',
})

export const navyTheme = makeTheme('navy', '藏青', {
  bg: '#ffffff',
  text: '#3a3a3a',
  heading: '#1b3a5c',
  secondary: '#7b8794',
  accent: '#1b3a5c',
  line: '#dde4ec',
  softBg: '#f4f7fa',
  codeBg: '#f4f6f9',
})

/** 豆瓣用：更朴素，贴近豆瓣日记的默认观感 */
export const doubanTheme: HtmlTheme = makeTheme('douban', '豆瓣', {
  bg: '#ffffff',
  text: '#333333',
  heading: '#111111',
  secondary: '#888888',
  accent: '#37a',
  line: '#e6e6e6',
  softBg: '#f6f6f6',
  codeBg: '#f4f4f4',
})

export const wechatThemes: HtmlTheme[] = [paperTheme, sepiaTheme, navyTheme]

export function getWechatTheme(id: string): HtmlTheme {
  return wechatThemes.find((t) => t.id === id) ?? paperTheme
}
