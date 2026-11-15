/**
 * 裸 HTML 清洗（正则黑名单）
 *
 * 服务对象是**交给平台的产物**：微信、豆瓣、头条的编辑器只认 HTML 子集，
 * 而作者在 Markdown 里写的裸 HTML 会原样走进去。这里只切明显危险和明显无用的部分
 * （脚本、内嵌框架、事件属性、伪协议、class/id），其余尽量保住 —— 保真优先。
 *
 * 站内预览**不用**这个：黑名单不收敛（无引号属性、实体编码、`<svg/onload=` 都能绕），
 * 而预览是在我们自己的页面里执行的。预览走 sanitize-preview.ts 的 DOM 允许列表。
 */

/** 连同内容一起丢掉的标签 */
export const BLOCKED_TAGS =
  'script|style|iframe|object|embed|noscript|svg|math|template|form|input|button|select|textarea|meta|link|base'

/** 值是 URL 的属性 */
const URL_ATTRS = 'href|src|srcset|poster|action|formaction|xlink:href|data'

/** 扫标签用的：`<a href="…">` / `</p>`；属性值里的 `>` 极少见，这里按简单扫描处理 */
const TAG_SCAN = /<\/?[a-zA-Z][^>]*>/g

const ENTITIES: Record<string, string> = {
  colon: ':',
  tab: '\t',
  newline: '\n',
  amp: '&',
  sol: '/',
  quest: '?',
  num: '#',
  equals: '=',
}

/**
 * 把属性值里的实体还原。
 *
 * 不做这一步，`href="&#106;avascript:alert(1)"` 会因为字面上不是 `javascript:`
 * 而被放过去，浏览器解码后照样执行。
 */
export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);?/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n: string) => ENTITIES[n.toLowerCase()] ?? m)
}

/**
 * 协议是否安全。
 *
 * 先解码实体，再抹掉所有控制字符和空白 —— `java\tscript:` 会因为浏览器
 * 解析 URL 时丢掉 tab 而变成 `javascript:`，不抹就漏。
 */
export function safeUrl(raw: string): boolean {
  const v = decodeEntities(raw).replace(/[\u0000- \u007f]/g, '').toLowerCase()
  if (!v) return true
  if (v.startsWith('javascript:') || v.startsWith('vbscript:')) return false
  if (v.startsWith('data:')) return /^data:image\/(png|jpe?g|gif|webp|avif);/.test(v)
  return true
}

/** 单个标签内的属性清理 */
function cleanTag(tag: string): string {
  return (
    tag
      // 事件属性。属性名前允许空白，也允许 `/` —— `<svg/onload=alert(1)>` 就是靠这个漏的
      .replace(/[\s/]+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      // URL 属性：带引号 / 不带引号都要管
      .replace(
        new RegExp(`\\s(${URL_ATTRS})\\s*=\\s*("[^"]*"|'[^']*'|[^\\s>]+)`, 'gi'),
        (matched, _name: string, rawVal: string) => {
          const value = rawVal.replace(/^["']|["']$/g, '')
          return safeUrl(value) ? matched : ''
        },
      )
  )
}

/**
 * 清洗裸 HTML：移除危险标签、事件属性，以及 class / id。
 *
 * `keepClasses` 只给站内阅读预览的兜底路径用（非浏览器环境没有 DOMParser 时）；
 * 交给平台的那份必须剥干净。
 */
export function sanitizeHtml(raw: string, opts: { keepClasses?: boolean } = {}): string {
  let out = raw
    .replace(new RegExp(`<(${BLOCKED_TAGS})\\b[^>]*>[\\s\\S]*?</\\1\\s*>`, 'gi'), '')
    .replace(new RegExp(`</?(${BLOCKED_TAGS})\\b[^>]*>`, 'gi'), '')
    .replace(TAG_SCAN, cleanTag)

  // class / id 必须剥掉：微信编辑器会静默丢弃它们，留着只会让人误以为样式生效；
  // 而 style 是唯一能在微信里活下来的内联属性，保留。
  if (!opts.keepClasses) {
    out = out.replace(/\s(class|id)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  }
  return out
}
