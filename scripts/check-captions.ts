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

import { parseArticle, renderPreviewHtml } from '../src/core/parse'
import { renderWechat } from '../src/renderers/wechat'
import { renderDouban } from '../src/renderers/douban'
import { renderSspai } from '../src/renderers/sspai'
import { imageCaption } from '../src/core/ir'

let failures = 0

function fail(msg: string) {
  failures++
  console.log(`  ✗ ${msg}`)
}

function ok(msg: string) {
  console.log(`  ✓ ${msg}`)
}

function check(cond: boolean, msg: string) {
  if (cond) ok(msg)
  else fail(msg)
}

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
check(altKept, '段落内图片的 alt 保留为「10 月跑量」')

const sspaiMd = renderSspai(d1, OPTS).primary
check(
  sspaiMd.includes('![10 月跑量](https://img.hulatu.com/post/UILBl6.jpg)'),
  '少数派 Markdown 输出保留 alt（以前会变成 ![](url)）',
)

/* ------------------------------------------------------------------ */
console.log('\n2. 公众号：图注在图下方，居中 / 灰 / 比正文小')

const wx = renderWechat(d1, OPTS).html ?? ''
check(wx.includes('>10 月跑量<'), '图注文字出现在 HTML 里')
check(
  /text-align:center[^>]*><img[^>]*><\/section><section[^>]*text-align:center[^>]*>10 月跑量</.test(wx),
  '图注是图片的下一个块，且居中',
)

const capStyle = /<section[^>]*>10 月跑量<\/section>/.exec(wx)?.[0] ?? ''
const fontSize = Number(/font-size:(\d+(?:\.\d+)?)px/.exec(capStyle)?.[1] ?? 0)
const bodySize = Number(/font-size:(\d+(?:\.\d+)?)px/.exec(/<section[^>]*>/.exec(wx)?.[0] ?? '')?.[1] ?? 0)
check(fontSize > 0 && fontSize < bodySize, `图注 ${fontSize}px < 正文 ${bodySize}px`)
check(/color:#[0-9a-f]{3,8}/i.test(capStyle), '图注带显式颜色（灰）')

// 灰色要真的是灰：r≈g≈b
const hex = /color:#([0-9a-f]{6})/i.exec(capStyle)?.[1] ?? ''
if (hex) {
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  const spread = Math.max(r, g, b) - Math.min(r, g, b)
  check(spread <= 24, `图注颜色 #${hex} 是低饱和灰（通道极差 ${spread}）`)
} else {
  fail('图注没有 hex 颜色')
}

/* ------------------------------------------------------------------ */
console.log('\n3. 图注文字取谁')

check(imageCaption('https://x.com/a/UILBl6.jpg', '10 月跑量') === '10 月跑量', '有 alt 用 alt')
check(imageCaption('/images/demo.png', '') === 'demo.png', 'alt 为空退回文件名')
check(imageCaption('https://x.com/a/pic.PNG?w=200', '  ') === 'pic.PNG', '文件名去掉 query，保留原大小写')
check(imageCaption('data:image/png;base64,AAA', '') === '', 'data URI 不产生图注')
check(imageCaption('https://x.com/post/abc123', '') === '', '没有扩展名的路径不产生图注')
check(imageCaption('/images/%E5%9B%BE.png', '') === '图.png', '文件名会做 URL 解码')

const noAlt = doc('![](/images/demo.png)')
const wxNoAlt = renderWechat(noAlt, OPTS).html ?? ''
check(wxNoAlt.includes('>demo.png<'), 'alt 为空的图，用文件名当图注')

const noName = doc('![](data:image/gif;base64,R0lGODlhAQABAAAAACw=)')
const wxNoName = renderWechat(noName, OPTS).html ?? ''
check(!wxNoName.includes('<figcaption'), '取不到名字时不输出图注')
check(
  (wxNoName.match(/<section[^>]*text-align:center[^>]*><img/g) ?? []).length === 1,
  '取不到名字时图片仍然居中',
)

/* ------------------------------------------------------------------ */
console.log('\n4. 只处理「整段只有一张图」')

const mixed = doc('文字和 ![图](https://x.com/a/pic.png) 在同一段里')
const wxMixed = renderWechat(mixed, OPTS).html ?? ''
check(!wxMixed.includes('text-align:center;">'), '图与文字混排时不做图注块')
check(wxMixed.includes('<img src="https://x.com/a/pic.png"'), '混排里的图片仍然正常输出')

const two = doc('![一](https://x.com/a/1.png)\n![二](https://x.com/a/2.png)')
const wxTwo = renderWechat(two, OPTS).html ?? ''
check(
  (wxTwo.match(/text-align:center[^>]*><img/g) ?? []).length === 2,
  '连续两张图各自成块，各有图注',
)

/* ------------------------------------------------------------------ */
console.log('\n5. 豆瓣（target=web）：图注不嵌套 <p>')

const db = renderDouban(d1, OPTS).html ?? ''
check(/<p style="[^"]*text-align:center[^"]*"><img[^>]*><\/p><p style="[^"]*">10 月跑量<\/p>/.test(db), '图片 <p> 与图注 <p> 并列，不嵌套')
check(!/<p[^>]*><img[^>]*><p/.test(db), '没有 <p> 套 <p>（浏览器会自动闭合，外层居中会失效）')

/* ------------------------------------------------------------------ */
console.log('\n6. 站内预览：<figure> + <figcaption>')

const preview = renderPreviewHtml('前一段\n\n![10 月跑量](https://img.hulatu.com/post/UILBl6.jpg)\n\n后一段\n')
check(preview.includes('<figure class="md-figure">'), '独立成段的图片渲染成 <figure>')
check(preview.includes('<figcaption>10 月跑量</figcaption>'), '<figcaption> 里是图注文字')
check(!/<p><figure/.test(preview), 'figure 外面没有残留的 <p>')

const previewMixed = renderPreviewHtml('文字和 ![图](https://x.com/a/pic.png) 在同一段里\n')
check(!previewMixed.includes('<figure'), '混排时不包 figure')

const previewNoAlt = renderPreviewHtml('![](/images/demo.png)\n')
check(previewNoAlt.includes('<figcaption>demo.png</figcaption>'), '预览里 alt 为空也用文件名')

/* ------------------------------------------------------------------ */
console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)
