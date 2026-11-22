/**
 * 公众号文末组件
 *
 * 三块：关注引导 / 往期推荐 / 版权声明。
 *
 * 为什么是「拼在正文后面」而不是做成一整套模板：
 * 正文排版由主题管，尾部这三块是**账号级**的东西 —— 换了主题它们不该跟着变，
 * 换了一篇文章它们也不该变。所以配置存在 localStorage，和主题、和文章都解耦。
 *
 * 几条和正文一样的微信硬约束：
 * - 只能内联样式，不能有 class / id / <style>
 * - 不能用 ::before / ::after（会被整条剥离），要装饰就画真实节点
 * - **只有 mp.weixin.qq.com 的文章链接能在正文里保留成可点击的 <a>**；
 *   其他域名（包括自己的博客）粘贴后会被微信整条剥离。所以往期推荐里
 *   公众号文章链接输出成 <a>，其余链接退回纯标题，由 wechat.ts 给出提示。
 * - 这些文字会拼在正文后面，所以每块都尽量短
 */

import type { HtmlTheme, StyleMap } from './html-inline'
import { escapeHtml } from './escape'

export interface TailHistoryItem {
  title: string
  url: string
}

export interface TailConfig {
  /** 关注引导 */
  follow: { on: boolean; title: string; text: string }
  /** 往期推荐 */
  history: { on: boolean; title: string; items: TailHistoryItem[] }
  /** 版权声明 */
  copyright: { on: boolean; text: string }
}

/** 模板里可用的占位符：{account} 账号名，{year} 当前年份 */
export const TAIL_VARS = ['{account}', '{year}']

/**
 * 往期推荐里能被微信保留成可点击链接的地址。
 *
 * 微信正文只认 mp.weixin.qq.com 的文章页（`/s/…` 短链或 `/s?__biz=…` 长链），
 * 其他域名粘贴后会被整条剥离。返回规范化后的 https 地址，不合法返回 null。
 *
 * 顺手修掉三种常见写法：带不带协议、`//` 开头、`http://`。
 */
export function wechatArticleUrl(raw: string): string | null {
  let s = raw.trim()
  if (!s) return null
  if (s.startsWith('//')) s = `https:${s}`
  else if (!/^https?:\/\//i.test(s)) {
    // 只给域名也行，但必须是公众号文章域，别的地址补了协议也没用
    if (!/^mp\.weixin\.qq\.com\//i.test(s)) return null
    s = `https://${s}`
  }

  let url: URL
  try {
    url = new URL(s)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.hostname.toLowerCase() !== 'mp.weixin.qq.com') return null
  // `/s` 和 `/s/xxx` 才是文章页；主页、话题页等不是「图文消息链接」，会被判不合法
  if (url.pathname !== '/s' && !url.pathname.startsWith('/s/')) return null
  url.protocol = 'https:'
  return url.toString()
}

export const defaultTailConfig: TailConfig = {
  follow: {
    on: true,
    // 小标题默认留空：开关本身已经写着「关注引导」，再填一遍同一个词只是重复
    title: '',
    text: '如果这篇内容对你有用，欢迎关注「{account}」，每周更新一篇长文。',
  },
  history: {
    on: false,
    title: '',
    items: [
      { title: '', url: '' },
      { title: '', url: '' },
    ],
  },
  copyright: {
    on: true,
    text: '© {year} {account} · 转载请注明出处与原文链接',
  },
}

const KEY = 'ad.wechat-tail.v1'

export function readTailConfig(): TailConfig {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return defaultTailConfig
    const parsed = JSON.parse(raw) as Partial<TailConfig>
    // 逐块合并：老版本存的配置缺字段时不能整块丢掉
    return {
      follow: { ...defaultTailConfig.follow, ...(parsed.follow ?? {}) },
      history: { ...defaultTailConfig.history, ...(parsed.history ?? {}) },
      copyright: { ...defaultTailConfig.copyright, ...(parsed.copyright ?? {}) },
    }
  } catch {
    return defaultTailConfig
  }
}

export function writeTailConfig(cfg: TailConfig): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(cfg))
  } catch {
    // 写不进去不影响本次使用
  }
}

/** 打开了几块（0 表示尾部不生效） */
export function activeBlocks(cfg: TailConfig): number {
  return (cfg.follow.on ? 1 : 0) + (cfg.history.on ? 1 : 0) + (cfg.copyright.on ? 1 : 0)
}

/* ------------------------------------------------------------------ */
/* 颜色                                                                */
/* ------------------------------------------------------------------ */

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1]
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

/** 把颜色朝白色混，用来给「关注引导」做浅底。非 hex 就退回一个中性浅色 */
function tint(color: string, ratio = 0.9): string {
  const rgb = parseHex(color)
  if (!rgb) return '#f6f3ee'
  const mix = rgb.map((c) => Math.round(c + (255 - c) * ratio))
  return `#${mix.map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

/** 主题里没有导出调色板，只能从已有样式里把颜色抠出来 */
function paletteOf(theme: HtmlTheme): { accent: string; ink: string; muted: string; line: string } {
  const accent = theme.link?.color ?? '#c0392b'
  const ink = theme.heading?.[2]?.color ?? theme.root?.color ?? '#1b1917'
  const muted = theme.caption?.color ?? '#8a8378'
  const borderTop = theme.hr?.['border-top'] ?? ''
  const line = /(?:solid|dashed|dotted)\s+(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))/.exec(borderTop)?.[1] ?? '#e7e1d8'
  return { accent, ink, muted, line }
}

/* ------------------------------------------------------------------ */
/* 生成 HTML                                                           */
/* ------------------------------------------------------------------ */

function attr(map: StyleMap): string {
  const body = Object.entries(map)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}:${String(v).replace(/"/g, '&quot;')}`)
    .join(';')
  return body ? ` style="${body}"` : ''
}

/** 替换 {account} / {year}；账号名留空时把「关注」这种半句话收拾干净 */
export function applyVars(text: string, account: string): string {
  const year = String(new Date().getFullYear())
  const name = account.trim() || '本号'
  return text.replace(/\{account\}/g, name).replace(/\{year\}/g, year)
}

export interface TailRenderResult {
  html: string
  /**
   * 与 html 内容等价的纯文本。
   *
   * 不能只产出 HTML：公众号复制走的是 text/html + text/plain 双通道，
   * 一旦富文本那条失败降级成纯文本，只给 result.text 的话**文末三块整块消失**，
   * 用户粘出来就是「复制不完全、丢了后面的内容」。
   */
  text: string
  /** 实际用到的往期条目数 */
  historyCount: number
  /** 输出成可点击 <a> 的公众号文章链接条数 */
  linkedCount: number
  /** 有链接但没法渲染成 <a> 的条目数（非公众号文章 / 地址不合法），用于提示 */
  droppedLinks: number
}

export function buildTailHtml(cfg: TailConfig, theme: HtmlTheme, account: string): TailRenderResult {
  const p = paletteOf(theme)
  const blocks: string[] = []
  /** 和 blocks 一一对应的纯文本，顺序必须完全一致 */
  const texts: string[] = []
  let historyCount = 0
  let linkedCount = 0
  let droppedLinks = 0

  if (cfg.follow.on && cfg.follow.text.trim()) {
    blocks.push(
      `<section${attr({
        margin: '2.4em 0 0',
        padding: '18px 20px',
        'border-radius': '6px',
        'background-color': tint(p.accent),
        'border-left': `3px solid ${p.accent}`,
      })}>` +
        (cfg.follow.title.trim()
          ? `<section${attr({
              'font-size': '12px',
              'font-weight': '600',
              color: p.accent,
              'letter-spacing': '1.5px',
              'margin-bottom': '6px',
            })}>${escapeHtml(cfg.follow.title.trim())}</section>`
          : '') +
        `<section${attr({
          'font-size': '14px',
          'line-height': '1.85',
          color: p.ink,
          'letter-spacing': '0.3px',
        })}>${escapeHtml(applyVars(cfg.follow.text, account))}</section>` +
        `</section>`,
    )
    texts.push(
      [cfg.follow.title.trim(), applyVars(cfg.follow.text, account)]
        .filter(Boolean)
        .join('\n'),
    )
  }

  if (cfg.history.on) {
    const items = cfg.history.items
      .filter((i) => i.title.trim())
      .map((item) => ({
        title: item.title.trim(),
        href: wechatArticleUrl(item.url),
        hasUrl: Boolean(item.url.trim()),
      }))
    if (items.length > 0) {
      historyCount = items.length
      linkedCount = items.filter((i) => i.href).length
      droppedLinks = items.filter((i) => i.hasUrl && !i.href).length
      const rows = items
        .map((item, i) => {
          // 公众号文章链接写成 <a>：粘贴到公众号后仍是可点击的蓝字。
          // 其他链接不写 href —— 写了也会被微信剥离，只会让用户误以为能点。
          const label = item.href
            ? `<a href="${escapeHtml(item.href)}"${attr({
                color: p.accent,
                'text-decoration': 'underline',
              })}>${escapeHtml(item.title)}</a>`
            : escapeHtml(item.title)
          return (
            `<section${attr({
              'font-size': '14px',
              'line-height': '1.9',
              color: p.muted,
              'letter-spacing': '0.2px',
            })}>${i + 1}. ${label}</section>`
          )
        })
        .join('')
      blocks.push(
        `<section${attr({ margin: '2em 0 0', 'padding-top': '16px', 'border-top': `1px solid ${p.line}` })}>` +
          (cfg.history.title.trim()
            ? `<section${attr({
                'font-size': '12px',
                'font-weight': '600',
                color: p.ink,
                'letter-spacing': '1.5px',
                'margin-bottom': '8px',
              })}>${escapeHtml(cfg.history.title.trim())}</section>`
            : '') +
          rows +
          `</section>`,
      )
      texts.push(
        [
          cfg.history.title.trim(),
          ...items.map((item, i) =>
            // 纯文本通道里链接没法可点击，把地址带上，降级时至少还能手动挂
            item.href ? `${i + 1}. ${item.title}（${item.href}）` : `${i + 1}. ${item.title}`,
          ),
        ]
          .filter(Boolean)
          .join('\n'),
      )
    }
  }

  if (cfg.copyright.on && cfg.copyright.text.trim()) {
    blocks.push(
      `<section${attr({
        margin: '2.2em 0 0',
        'padding-top': '14px',
        'border-top': `1px solid ${p.line}`,
        'font-size': '12px',
        'line-height': '1.8',
        color: p.muted,
        'letter-spacing': '0.2px',
      })}>${escapeHtml(applyVars(cfg.copyright.text, account))}</section>`,
    )
    texts.push(applyVars(cfg.copyright.text, account))
  }

  return { html: blocks.join(''), text: texts.join('\n\n'), historyCount, linkedCount, droppedLinks }
}
