/**
 * 微信公众号
 *
 * 这是全工具踩坑最多的一个平台，几条约束直接决定了实现方式：
 *
 * 1. **正文上限 20000 字** —— 按字数算，不按 HTML 字符数（见下方 WECHAT_WORD_LIMIT）。
 *    不过 HTML 体积仍然要控制：每个节点都写完整 style 会膨胀到 3–5 万字符，粘贴变慢。
 *    对策：全局字体/行高/字距/颜色只写在外层 <section>，靠 CSS 继承；
 *    段落只写 margin 等差异属性。
 * 2. **正文图片可以直接用外链** —— 流传的说法是「必须是 mmbiz.qpic.cn，否则保存时被
 *    过滤成裂图」。实测自建图床（Cloudflare R2 + 自有域名）的图在公众号正文里显示正常，
 *    所以这里不再提示「逐张重传」，也不把图片数标成待办。
 *    图片清单（体检 / 按平台导出）仍然保留，那是工具，不是警告。
 * 3. **外链 <a> 在未认证号正文里整体失效** —— 抽成文末「参考链接」编号表，
 *    正文只留 [n] 上标。
 * 4. **不能用 <pre>** —— 微信移动端不支持横向滚动，overflow-x 被剥离会导致代码截断。
 *    改为逐行 <section>。
 */

import type { Doc } from '../core/ir'
import { collectImages, collectLinks } from '../core/ir'
import { renderHtml } from '../core/html-inline'
import { charCount } from '../core/cjk'
import { getWechatTheme } from '../themes/wechat'
import { activeBlocks, buildTailHtml } from '../core/tail'
import type { ConvertOptions, RenderOutput } from './index'
import { WECHAT_WORD_LIMIT } from './limits'

/** 常量本体在 ./limits.ts（App 首屏也要读它，不能把它留在大渲染器里）；这里只做再导出，检查脚本的旧 import 路径不用改。 */
export { WECHAT_WORD_LIMIT }

export function renderWechat(doc: Doc, opts: ConvertOptions): RenderOutput {
  const theme = getWechatTheme(opts.wechatThemeId)
  const result = renderHtml(doc.blocks, {
    theme,
    linkMode: 'refs',
    target: 'wechat',
    refsTitle: '参考链接',
    fnTitle: '注释',
  })

  const images = collectImages(doc.blocks)
  const links = collectLinks(doc.blocks)
  const warnings: string[] = []

  // 文末三块拼在正文（含参考链接）之后：关注引导放最后是公众号的惯例
  const tail = opts.tail ? buildTailHtml(opts.tail, theme, opts.account ?? '') : null
  const html = tail?.html ? result.html + tail.html : result.html
  // 纯文本通道也要带上文末 —— 富文本那条一旦降级成纯文本，少了它整块内容就没了
  const text = tail?.text ? `${result.text}\n\n${tail.text}` : result.text
  // 字符数只作为「粘进去要传多大一坨」的参考，不再拿它判超限
  const charTotal = [...html].length
  // 超限判定走字数，和微信编辑器的口径一致
  const words = charCount(text)
  const tailBlocks = opts.tail ? activeBlocks(opts.tail) : 0

  if (tail && tail.droppedLinks > 0) {
    warnings.push(
      `往期推荐有 ${tail.droppedLinks} 条带链接，微信会剥离正文外链，粘贴后需在编辑器里用「超链接」重新挂上。`,
    )
  }

  if (links.length > 0) {
    warnings.push(`${links.length} 个外链已抽成文末「参考链接」编号表（未认证号正文链接会失效）`)
  }

  const overLimit = words > WECHAT_WORD_LIMIT
  if (overLimit) {
    warnings.push(
      `正文 ${words} 字，超过微信编辑器 20000 字上限。请用「按 H2 拆篇」拆成多篇发布。`,
    )
  }

  const pct = Math.round((words / WECHAT_WORD_LIMIT) * 100)

  return {
    primary: html,
    html,
    text,
    format: 'html',
    copyMode: 'rich',
    warnings: [...warnings, ...result.warnings],
    stats: [
      {
        label: '正文字数',
        value: `${words} / ${WECHAT_WORD_LIMIT}（${pct}%）`,
        level: overLimit ? 'error' : pct > 85 ? 'warn' : 'ok',
      },
      { label: 'HTML', value: `${charTotal} 字符` },
      // 只是一个计数，不是待办：外链图在公众号里能正常显示，不需要重传
      { label: '图片', value: `${images.length} 张` },
      { label: '外链', value: `${links.length} 个已转文末` },
      { label: '文末', value: tailBlocks > 0 ? `${tailBlocks} 块` : '未启用' },
    ],
    fileName: `${doc.meta.slug || 'article'}.html`,
  }
}
