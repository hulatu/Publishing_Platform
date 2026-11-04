/**
 * 微信公众号
 *
 * 这是全工具踩坑最多的一个平台，几条约束直接决定了实现方式：
 *
 * 1. **content 字段上限 20000 字符** —— 最长一篇正文 15.5k 字，若每个节点都写完整
 *    style 会膨胀到 3–5 万字符必然超限。对策：全局字体/行高/字距/颜色只写在外层
 *    <section>，靠 CSS 继承；段落只写 margin 等差异属性。
 * 2. **正文图片必须是微信自己的域名** —— 外链图在草稿箱里可能显示，但保存/发布时
 *    会被过滤成裂图。所以必须提示用户逐张重新上传。
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
import type { ConvertOptions, RenderOutput } from './index'

/** 微信公众号 content 字段的硬上限 */
export const WECHAT_CONTENT_LIMIT = 20000

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

  if (images.length > 0) {
    warnings.push(
      `正文有 ${images.length} 张外链图片。公众号正文图片必须来自微信自己的域名（mmbiz.qpic.cn）——` +
        '粘贴后请逐张删除，再用公众号后台的「图片」按钮重新上传，否则发布时会出现裂图。',
    )
  }
  if (links.length > 0) {
    warnings.push(`${links.length} 个外链已自动抽成文末「参考链接」编号表（未认证号正文里的 <a> 会整体失效）`)
  }

  const overLimit = result.charCount > WECHAT_CONTENT_LIMIT
  if (overLimit) {
    warnings.push(
      `HTML 已达 ${result.charCount} 字符，超过公众号 20000 字符上限。请用「按 H2 拆篇」把文章拆成多篇发布。`,
    )
  }

  const pct = Math.round((result.charCount / WECHAT_CONTENT_LIMIT) * 100)

  return {
    primary: result.html,
    html: result.html,
    text: result.text,
    format: 'html',
    copyMode: 'rich',
    warnings: [...warnings, ...result.warnings],
    stats: [
      {
        label: 'HTML 字符',
        value: `${result.charCount} / ${WECHAT_CONTENT_LIMIT}（${pct}%）`,
        level: overLimit ? 'error' : pct > 85 ? 'warn' : 'ok',
      },
      { label: '正文', value: `${charCount(result.text)} 字` },
      {
        label: '图片',
        value: `${images.length} 张待重传`,
        level: images.length > 0 ? 'warn' : 'ok',
      },
      { label: '外链', value: `${links.length} 个已转文末` },
    ],
    extras:
      images.length > 0
        ? [
            {
              title: '待重新上传的图片（公众号正文只认微信域名）',
              items: images.map((img, i) => `${i + 1}. ${img.src}`),
            },
          ]
        : undefined,
    fileName: `${doc.meta.slug || 'article'}.html`,
  }
}
