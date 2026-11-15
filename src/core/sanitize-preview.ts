/**
 * 预览层 HTML 清洗（允许列表）
 *
 * 为什么不用 parse.ts 里那个 sanitizeHtml：
 * 那个是正则黑名单，服务的是**交给平台的产物** —— 它必须尽量保住作者写的
 * 一切（内联 style、class、任意标签），只切掉明显的危险件。黑名单天然不收敛，
 * 实测能绕过（无引号属性、实体编码、`<svg/onload=`），而预览是插进我们自己的
 * 页面执行的，一旦执行脚本就能读走同源 localStorage 里的 API Key、草稿、台账。
 *
 * 所以这里按「解析成 DOM → 只留白名单里的标签和属性」来做，两个好处：
 * 1. 实体编码、属性大小写、`java\tscript:` 这类混淆由浏览器自己解析掉，
 *    不需要我们去猜编码；
 * 2. 不认识的标签默认不放行，新增攻击面不会自动漏进来。
 *
 * 有意的取舍：`style` 和 `class` 留在白名单里。微信产物是一整片内联样式，
 * 剥掉它预览就彻底失真；而 `style` 能做的「视觉欺骗」（铺满屏幕的假弹层）
 * 不构成窃取数据，真正的危害面（执行脚本）由标签/属性白名单和 CSP 一起挡住。
 */

import { safeUrl, sanitizeHtml } from './sanitize'

/** 连同内容一起丢掉：留着内容反而会把脚本源码当正文显示出来 */
const DROP_TAGS = new Set([
  'script', 'style', 'noscript', 'template',
  'iframe', 'frame', 'frameset', 'object', 'embed', 'applet',
  'svg', 'math',
  'form', 'input', 'button', 'select', 'option', 'optgroup', 'textarea', 'datalist', 'output',
  'meta', 'link', 'base', 'title',
])

/** 允许留下的标签。不在表里的默认「拆壳留字」，不整段删除 */
const ALLOWED_TAGS = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'blockquote', 'br', 'caption', 'cite', 'code',
  'del', 'details', 'dfn', 'div', 'dl', 'dt', 'dd', 'em', 'figcaption', 'figure',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'ins', 'kbd', 'li', 'main',
  'mark', 'ol', 'p', 'pre', 'q', 'rp', 'rt', 'ruby', 's', 'samp', 'section', 'small',
  'span', 'strike', 'strong', 'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'tfoot',
  'th', 'thead', 'tr', 'u', 'ul', 'var', 'video', 'audio', 'source',
])

/** 所有允许标签共用的属性 */
const GLOBAL_ATTRS = new Set([
  'class', 'id', 'style', 'title', 'lang', 'dir', 'align', 'width', 'height',
  'start', 'reversed', 'colspan', 'rowspan', 'scope', 'datetime', 'cite',
  'loading', 'decoding', 'controls', 'poster', 'open',
])

/** 值是 URL 的属性，要单独校验协议 */
const URL_ATTRS = new Set(['href', 'src', 'srcset', 'poster', 'cite', 'xlink:href', 'data'])

function attrAllowed(tag: string, name: string): boolean {
  const n = name.toLowerCase()
  if (GLOBAL_ATTRS.has(n)) return true
  if (URL_ATTRS.has(n)) {
    // video/audio 的 poster、a 的 href、img 的 src 都是这几类标签的常规属性；
    // 其余标签带 URL 属性一律不放行（比如 <td data="..."> 没有意义）
    return tag === 'a' || tag === 'img' || tag === 'video' || tag === 'audio' ||
      tag === 'source' || tag === 'blockquote' || tag === 'q'
  }
  // <a target="_blank">：允许，但下面会强制补 rel
  if (n === 'target' && tag === 'a') return true
  // <source type="video/mp4"> / <ol type="a">：类型声明无害，但只给它
  if (n === 'type' && (tag === 'source' || tag === 'ol' || tag === 'ul')) return true
  return false
}

/**
 * 内联样式的二次收紧。
 *
 * `style` 必须留在白名单里（公众号产物整篇靠它），但有两类声明只对攻击者有用：
 * - `position:fixed/absolute` 能把一段正文铺满整个视口，做成假弹层做钓鱼；
 * - `url(...)` 会让别人的服务器拿到「谁在什么时候打开了这篇预览」的 IP。
 * 公众号主题里这两样一个都没用（`grep position:` / `url(` 都是 0），删掉不影响预览保真。
 */
function cleanStyle(style: string): string {
  return style
    .split(';')
    .filter((decl) => {
      const d = decl.trim()
      if (!d) return false
      if (/^position\s*:/i.test(d)) return false
      if (/url\s*\(/i.test(d)) return false
      if (/^(-moz-binding|behavior)\s*:/i.test(d)) return false
      return true
    })
    .join(';')
}

function cleanNode(root: Element): void {
  // 先把子节点拍平：边遍历边改树会让 live 集合漏掉节点
  for (const el of [...root.children]) {
    const tag = el.tagName.toLowerCase()

    if (DROP_TAGS.has(tag)) {
      el.remove()
      continue
    }

    if (!ALLOWED_TAGS.has(tag)) {
      // 未知标签拆壳留字（<div> 之外的脏标签大多是包裹结构）
      el.replaceWith(...el.childNodes)
      continue
    }

    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase()
      if (!attrAllowed(tag, name)) {
        el.removeAttribute(attr.name)
        continue
      }
      if (URL_ATTRS.has(name)) {
        // srcset 是逗号分隔的多条 URL，逐条校验
        const ok =
          name === 'srcset'
            ? attr.value.split(',').every((part) => safeUrl(part.trim().split(/\s+/)[0] ?? ''))
            : safeUrl(attr.value)
        if (!ok) el.removeAttribute(attr.name)
      }

      if (name === 'style') {
        const next = cleanStyle(attr.value)
        if (next) el.setAttribute('style', next)
        else el.removeAttribute('style')
      }
    }

    if (tag === 'a') {
      const target = el.getAttribute('target')
      if (target && target !== '_blank' && target !== '_self') el.removeAttribute('target')
      // 预览里的外链一律新窗口打开，且不留 opener
      if (el.getAttribute('target') === '_blank') el.setAttribute('rel', 'noopener noreferrer')
    }

    cleanNode(el)
  }
}

/**
 * 清洗预览 HTML。
 *
 * 非浏览器环境（`npm run check` 在 Node 里跑）没有 DOMParser，退回到
 * parse.ts 的正则清洗 —— 检查脚本关心的是结构（图注、脚注、表格），
 * 不是安全边界；安全边界只存在于浏览器里，也就只在那里用白名单。
 */
export function sanitizePreview(html: string): string {
  if (typeof DOMParser === 'undefined') return sanitizeHtml(html, { keepClasses: true })
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  cleanNode(doc.body)
  return doc.body.innerHTML
}
