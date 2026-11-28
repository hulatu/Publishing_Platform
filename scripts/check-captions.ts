/**
 * 图注自检脚本（开发用）
 *
 * 用法：
 *   node_modules/.bin/esbuild scripts/check-captions.ts --bundle --platform=node \
 *     --format=esm --outfile=.tmp/check-captions.mjs && node .tmp/check-captions.mjs
 *
 * 断言四件事：
 * 1. 解析不再丢 alt（markdown-it 把 alt 放在 token.content 里，不在 attrs 里）
 * 2. 公众号 / 豆瓣的 HTML：图片下方有图注，且图注是居中、灰色、比正文小
 * 3. 图注文字优先 alt，alt 为空才退回文件名，两者都没有就不输出空行
 * 4. 站内预览把独立成段的图片渲染成 <figure> + <figcaption>
 */

import { ok, fail, report } from './harness'
import { parseArticle, renderPreviewHtml } from '../src/core/parse'
import { renderWechat } from '../src/renderers/wechat'
import { renderDouban } from '../src/renderers/douban'
import { renderSspai } from '../src/renderers/sspai'
import { renderZhihu } from '../src/renderers/zhihu'
import { imageCaption } from '../src/core/ir'




const OPTS = { wechatThemeId: 'paper' }

/** 造一篇带图的文章；body 里写图片语法 */
function doc(body: string) {
  return parseArticle({
    source: `---\ntitle: 图注测试\ndate: 2026-11-08\n---\n\n${body}\n`,
    fileName: 'captions.md',
  })
}

/* ------------------------------------------------------------------ */
console.log('1. alt 不再丢失')

const d1 = doc('![10 月跑量](https://img.hulatu.com/post/UILBl6.jpg)')
const imgBlock = d1.blocks.find((b) => b.t === 'p')
const altKept =
  imgBlock?.t === 'p' && imgBlock.inline.some((n) => n.t === 'img' && n.alt === '10 月跑量')
ok(altKept, '段落内图片的 alt 保留为「10 月跑量」')

const sspaiMd = renderSspai(d1, OPTS).primary
ok(
  sspaiMd ===
    '![10 月跑量](https://img.hulatu.com/post/UILBl6.jpg)\n\n*10 月跑量*',
  '少数派 Markdown：图下补一行斜体图注（裸 HTML 会被编辑器转义成源码）',
)
ok(!sspaiMd.includes('<figure'), '少数派 Markdown 里没有裸 <figure>，粘过去不会出现源码')
ok(
  (renderSspai(d1, OPTS).html ?? '').includes('<figcaption'),
  '少数派富文本：编辑器若采用 HTML，图注在 <figcaption> 里',
)
ok(
  renderZhihu(d1, OPTS).primary.includes('<figcaption>10 月跑量</figcaption>'),
  '知乎 .md：导入后图注进原生「图片注释」',
)
ok(
  renderZhihu(d1, OPTS).copyMode === 'rich' &&
    (renderZhihu(d1, OPTS).html ?? '').includes('<figcaption'),
  '知乎默认复制富文本：粘贴时图注进「图片注释」',
)
ok(
  !renderZhihu(d1, OPTS).text.includes('<figure'),
  '知乎的纯文本兜底不露裸 figure（用斜体图注）',
)
ok(
  renderSspai(d1, OPTS).htmlOnly === true &&
    (renderSspai(d1, OPTS).html ?? '').includes(
      '<figure class="image ss-img-wrapper"><img',
    ),
  '少数派只写 HTML，且 figure 带 CKEditor 认的 image 类',
)
const sspaiHardened = renderSspai(d1, OPTS).html ?? ''
const sspaiRules = [
  /\[.*]\(.*\)/,
  /(^|\n)#{2,6}\s.*/,
  /(^|\n)[0-9]\.\s.*/,
  /(^|\n)[*+-]\s.*/,
  /(^|\n)>\s.*/,
]
ok(
  sspaiRules.every((re) => !re.test(sspaiHardened)),
  '少数派 HTML 不命中它的 Markdown 检测规则（不会弹转换框）',
)
ok(!sspaiHardened.includes('\n'), '少数派 HTML 不含换行，直接过它的 5 行早退')
const noAltMd = renderSspai(doc('![](https://img.hulatu.com/post/UILBl6.jpg)'), OPTS).primary
ok(
  noAltMd === '![](https://img.hulatu.com/post/UILBl6.jpg)',
  '没写 alt 的图不凭空生成图注',
)

/* ------------------------------------------------------------------ */
console.log('\n2. 公众号：图注在图下方，居中 / 灰 / 比正文小')

const wx = renderWechat(d1, OPTS).html ?? ''
ok(wx.includes('>10 月跑量<'), '图注文字出现在 HTML 里')
ok(
  /text-align:center[^>]*><img[^>]*><\/section><section[^>]*text-align:center[^>]*>10 月跑量</.test(wx),
  '图注是图片的下一个块，且居中',
)

const capStyle = /<section[^>]*>10 月跑量<\/section>/.exec(wx)?.[0] ?? ''
const fontSize = Number(/font-size:(\d+(?:\.\d+)?)px/.exec(capStyle)?.[1] ?? 0)
const bodySize = Number(/font-size:(\d+(?:\.\d+)?)px/.exec(/<section[^>]*>/.exec(wx)?.[0] ?? '')?.[1] ?? 0)
ok(fontSize > 0 && fontSize < bodySize, `图注 ${fontSize}px < 正文 ${bodySize}px`)
ok(/color:#[0-9a-f]{3,8}/i.test(capStyle), '图注带显式颜色（灰）')

// 灰色要真的是灰：r≈g≈b
const hex = /color:#([0-9a-f]{6})/i.exec(capStyle)?.[1] ?? ''
if (hex) {
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  const spread = Math.max(r, g, b) - Math.min(r, g, b)
  ok(spread <= 24, `图注颜色 #${hex} 是低饱和灰（通道极差 ${spread}）`)
} else {
  fail('图注没有 hex 颜色')
}

/* ------------------------------------------------------------------ */
console.log('\n3. 图注文字取谁')

ok(imageCaption('https://x.com/a/UILBl6.jpg', '10 月跑量') === '10 月跑量', '有 alt 用 alt')
ok(imageCaption('/images/demo.png', '') === 'demo.png', 'alt 为空退回文件名')
ok(imageCaption('https://x.com/a/pic.PNG?w=200', '  ') === 'pic.PNG', '文件名去掉 query，保留原大小写')
ok(imageCaption('data:image/png;base64,AAA', '') === '', 'data URI 不产生图注')
ok(imageCaption('https://x.com/post/abc123', '') === '', '没有扩展名的路径不产生图注')
ok(imageCaption('/images/%E5%9B%BE.png', '') === '图.png', '文件名会做 URL 解码')

const noAlt = doc('![](/images/demo.png)')
const wxNoAlt = renderWechat(noAlt, OPTS).html ?? ''
ok(wxNoAlt.includes('>demo.png<'), 'alt 为空的图，用文件名当图注')

const noName = doc('![](data:image/gif;base64,R0lGODlhAQABAAAAACw=)')
const wxNoName = renderWechat(noName, OPTS).html ?? ''
ok(!wxNoName.includes('<figcaption'), '取不到名字时不输出图注')
ok(
  (wxNoName.match(/<section[^>]*text-align:center[^>]*><img/g) ?? []).length === 1,
  '取不到名字时图片仍然居中',
)

/* ------------------------------------------------------------------ */
console.log('\n4. 只处理「整段只有一张图」')

const mixed = doc('文字和 ![图](https://x.com/a/pic.png) 在同一段里')
const wxMixed = renderWechat(mixed, OPTS).html ?? ''
ok(!wxMixed.includes('text-align:center;">'), '图与文字混排时不做图注块')
ok(wxMixed.includes('<img src="https://x.com/a/pic.png"'), '混排里的图片仍然正常输出')

const two = doc('![一](https://x.com/a/1.png)\n![二](https://x.com/a/2.png)')
const wxTwo = renderWechat(two, OPTS).html ?? ''
ok(
  (wxTwo.match(/text-align:center[^>]*><img/g) ?? []).length === 2,
  '连续两张图各自成块，各有图注',
)

/* ------------------------------------------------------------------ */
console.log('\n5. 豆瓣（target=web）：图注不嵌套 <p>')

const db = renderDouban(d1, OPTS).html ?? ''
ok(/<p style="[^"]*text-align:center[^"]*"><img[^>]*><\/p><p style="[^"]*">10 月跑量<\/p>/.test(db), '图片 <p> 与图注 <p> 并列，不嵌套')
ok(!/<p[^>]*><img[^>]*><p/.test(db), '没有 <p> 套 <p>（浏览器会自动闭合，外层居中会失效）')

/* ------------------------------------------------------------------ */
console.log('\n6. 站内预览：<figure> + <figcaption>')

const preview = renderPreviewHtml('前一段\n\n![10 月跑量](https://img.hulatu.com/post/UILBl6.jpg)\n\n后一段\n')
ok(preview.includes('<figure class="md-figure">'), '独立成段的图片渲染成 <figure>')
ok(preview.includes('<figcaption>10 月跑量</figcaption>'), '<figcaption> 里是图注文字')
ok(!/<p><figure/.test(preview), 'figure 外面没有残留的 <p>')

const previewMixed = renderPreviewHtml('文字和 ![图](https://x.com/a/pic.png) 在同一段里\n')
ok(!previewMixed.includes('<figure'), '混排时不包 figure')

const previewNoAlt = renderPreviewHtml('![](/images/demo.png)\n')
ok(previewNoAlt.includes('<figcaption>demo.png</figcaption>'), '预览里 alt 为空也用文件名')

/* ------------------------------------------------------------------ */
process.exit(report('图注层'))
