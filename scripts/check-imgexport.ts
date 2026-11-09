/**
 * 按平台导出的决策逻辑
 *
 * 只测**纯函数**（规则、计划、命名、清单），不碰 canvas、不碰网络 ——
 * 转码能不能跑通取决于浏览器，不该让 CI 红；但「该不该压、该不该裁、
 * 动图为什么不动」这些判断必须钉死，因为它们直接决定交出去的是什么文件。
 *
 * 这里最要紧的一条：**跳过必须是有理由的跳过**。
 * 一张 3 MB 的 GIF 如果被「优化」成 400 KB 的静图，是静默的数据损坏 ——
 * 比交一张超标的原图坏得多。所以断言里专门守「动图超限时说清原因」。
 */

import {
  exportRule,
  extOfBlob,
  fileNameFor,
  fmtSize,
  manifestText,
  planExport,
  planSummary,
  type ExportStep,
} from '../src/core/image-export'

let fail = 0
const check = (cond: boolean, msg: string) => {
  if (cond) {
    console.log(`  ✓ ${msg}`)
  } else {
    console.log(`  ✗ ${msg}`)
    fail++
  }
}

const kinds = (steps: ExportStep[]) => steps.map((s) => s.kind).join(',')
const hasKind = (steps: ExportStep[], k: string) => steps.some((s) => s.kind === k)

const WECHAT = exportRule('wechat')
const XHS = exportRule('xiaohongshu')
const GENERIC = exportRule('zhihu')

const MB = 1024 * 1024

/* ------------------------------------------------------------------ */
console.log('规则')
check(WECHAT.maxBytes === 2 * MB, '公众号体积上限 2 MB')
check(WECHAT.flatten === true, '公众号要铺白底（透明会变黑）')
check(WECHAT.maxEdge === 1920, '公众号长边上限 1920')
check(XHS.ratio?.[0] === 3 && XHS.ratio?.[1] === 4, '小红书要 3:4')
check(GENERIC.maxBytes === 0 && GENERIC.maxEdge === 0, '未知平台不限体积、不缩边')
check(Boolean(GENERIC.note), '未知平台也有说明，面板不会空着')

/* ------------------------------------------------------------------ */
console.log('\n公众号：该压的压')
const big = planExport({ bytes: 3 * MB, contentType: 'image/jpeg', width: 800, height: 600 }, WECHAT)
check(hasKind(big, 'compress'), '3 MB 的图 → 压')
check(!hasKind(big, 'resize'), '800px 宽不需要缩')

const tall = planExport({ bytes: 100 * 1024, contentType: 'image/jpeg', width: 4000, height: 3000 }, WECHAT)
check(hasKind(tall, 'resize'), '长边 4000 → 缩')
check(!hasKind(tall, 'compress'), '100 KB 不需要压')

const small = planExport({ bytes: 90 * 1024, contentType: 'image/jpeg', width: 1200, height: 800 }, WECHAT)
check(!hasKind(small, 'compress'), '小图不压')
check(!hasKind(small, 'resize'), '小图不缩')

/* ------------------------------------------------------------------ */
console.log('\n动图：宁可不动，也不能悄悄变成静图')
const gifBig = planExport({ bytes: 3 * MB, contentType: 'image/gif', width: 800, height: 600 }, WECHAT)
check(kinds(gifBig) === 'skip', '超限的 GIF 只跳过，不做任何转码')
check((gifBig[0]?.text ?? '').includes('动画'), '跳过时说明「会丢动画」，不是一句「不支持」')
check((gifBig[0]?.text ?? '').includes('3.0 MB'), '跳过时带上实际体积，人能自己判断')

const gifOk = planExport({ bytes: 200 * 1024, contentType: 'image/gif', width: 800, height: 600 }, WECHAT)
check(gifOk.length === 0, '没超限的 GIF 什么都不用做，不该报成「没处理」')

// 动图在小红书上也不能裁 —— 裁切同样要重编码
const gifXhs = planExport({ bytes: 200 * 1024, contentType: 'image/gif', width: 1920, height: 1080 }, XHS)
check(gifXhs.length === 0, '小红书对 GIF 也不裁不压（重编码会丢动画）')

/* ------------------------------------------------------------------ */
console.log('\nSVG')
const svg = planExport({ bytes: 20 * 1024, contentType: 'image/svg+xml', width: 800, height: 600 }, WECHAT)
check(hasKind(svg, 'rasterize'), '有尺寸的 SVG → 栅格化成 PNG')

const svgNoSize = planExport({ bytes: 20 * 1024, contentType: 'image/svg+xml' }, WECHAT)
check(kinds(svgNoSize) === 'skip', '读不到尺寸的 SVG 跳过')
check((svgNoSize[0]?.text ?? '').includes('尺寸'), '跳过原因说得具体')

// 只有 URL 后缀、没有 content-type 时也要认出来
const svgByExt = planExport({ bytes: 20 * 1024, urlExt: 'svg', width: 800, height: 600 }, WECHAT)
check(hasKind(svgByExt, 'rasterize'), 'content-type 缺失时按 URL 后缀认出 SVG')

/* ------------------------------------------------------------------ */
console.log('\n小红书：比例')
const land = planExport({ bytes: 300 * 1024, contentType: 'image/jpeg', width: 1920, height: 1080 }, XHS)
check(hasKind(land, 'crop'), '16:9 横图 → 裁成 3:4')

const portrait = planExport({ bytes: 300 * 1024, contentType: 'image/jpeg', width: 1080, height: 1440 }, XHS)
check(!hasKind(portrait, 'crop'), '本来就是 3:4 → 不裁')

// 容差：1080×1439 和 1080×1440 差 0.07%，手抖不该被裁一刀
const almost = planExport({ bytes: 300 * 1024, contentType: 'image/jpeg', width: 1080, height: 1439 }, XHS)
check(!hasKind(almost, 'crop'), '3% 容差内不裁，避免为一像素白丢内容')

const square = planExport({ bytes: 300 * 1024, contentType: 'image/jpeg', width: 1080, height: 1080 }, XHS)
check(hasKind(square, 'crop'), '1:1 方图 → 裁成 3:4')

// 不缩边时不产生 resize，避免「本来就够小还被重采样一遍」
const smallXhs = planExport({ bytes: 300 * 1024, contentType: 'image/jpeg', width: 1080, height: 1440 }, XHS)
check(!hasKind(smallXhs, 'resize'), '长边 1440 < 1920 → 不缩')

/* ------------------------------------------------------------------ */
console.log('\n铺白底：只对可能有透明的格式')
check(
  hasKind(planExport({ contentType: 'image/png' }, WECHAT), 'flatten'),
  'PNG 可能有透明 → 铺白',
)
check(
  hasKind(planExport({ contentType: 'image/webp' }, WECHAT), 'flatten'),
  'WebP 可能有透明 → 铺白',
)
// 这一条是真事故换来的：195 KB 的 JPEG 铺完白底变成 250 KB，越「优化」越大
check(
  !hasKind(planExport({ contentType: 'image/jpeg' }, WECHAT), 'flatten'),
  'JPEG 没有 alpha → 不铺白，不白白重编码一遍',
)
check(
  !hasKind(planExport({ contentType: 'image/bmp' }, WECHAT), 'flatten'),
  'BMP 没有 alpha → 不铺白',
)
check(
  !hasKind(planExport({}, WECHAT), 'flatten'),
  '连类型都不知道就不动它 —— 猜错就是重编码一遍还变大',
)

/* ------------------------------------------------------------------ */
console.log('\n事实缺失时不瞎判')
const unknown = planExport({}, WECHAT)
check(unknown.length === 0, '什么都不知道时什么都不做，原样导出')
check(!hasKind(unknown, 'compress'), '不知道体积就不说「要压」')
check(!hasKind(unknown, 'resize'), '不知道尺寸就不说「要缩」')

const unknownXhs = planExport({}, XHS)
check(!hasKind(unknownXhs, 'crop'), '不知道尺寸就不裁 —— 裁错比不裁糟得多')

/* ------------------------------------------------------------------ */
console.log('\n命名')
check(fileNameFor(0, 'jpg') === '01.jpg', '第 1 张是 01')
check(fileNameFor(9, 'png') === '10.png', '第 10 张是 10（补零，排序不会乱）')
check(fileNameFor(99, 'webp') === '100.webp', '三位数不截断')

check(extOfBlob(new Blob([], { type: 'image/jpeg' })) === 'jpg', 'JPEG → jpg')
check(extOfBlob(new Blob([], { type: 'image/svg+xml' })) === 'svg', 'SVG → svg')
// 关键：扩展名按内容取，不按 URL 取。实测图床上 53 张 .webp 全是 JPEG 字节
check(extOfBlob(new Blob([], { type: 'image/jpeg' }), 'webp') === 'jpg', '内容是 JPEG 就写 .jpg，不管 URL 写的是什么')
check(extOfBlob(new Blob([], { type: '' }), 'webp') === 'webp', '内容判不出来才回落到 URL 后缀')

/* ------------------------------------------------------------------ */
console.log('\n清单')
const text = manifestText(
  [
    {
      name: '01.jpg',
      src: 'https://img.example.com/a.jpg',
      alt: '一张封面',
      bytes: 400 * 1024,
      width: 1920,
      height: 1080,
      done: ['尺寸 4000×2250 → 1920×1080', '3.0 MB → 400 KB'],
      skipped: [],
    },
    {
      name: '02.gif',
      src: 'https://img.example.com/b.gif',
      alt: '',
      bytes: 3 * MB,
      done: [],
      skipped: ['动图超限，原样导出'],
    },
  ],
  '公众号',
  '2026-11-09 11:00',
)
check(text.includes('公众号'), '清单开头写明平台')
check(text.includes('01.jpg') && text.includes('02.gif'), '每张都列出文件名')
check(text.includes('https://img.example.com/a.jpg'), '保留原图地址，能对回 md')
check(text.includes('一张封面'), '保留原文说明文字')
check(text.includes('尺寸 4000×2250 → 1920×1080'), '写清做了什么处理')
check(text.includes('动图超限'), '写清没做什么处理')
check(text.includes('没有改动'), '说明正文链接没被改写')

// 空说明文字不能变成「原文说明：undefined」
check(text.includes('（无）'), '没有说明文字时写「（无）」')

/* ------------------------------------------------------------------ */
console.log('\n面板摘要')
check(planSummary(GENERIC).includes('原样'), '无规则平台说「原样导出」')
const ws = planSummary(WECHAT)
check(ws.includes('1920') && ws.includes('2.0 MB') && ws.includes('白'), '公众号摘要列出三条处理')
check(planSummary(XHS).includes('3:4'), '小红书摘要提到裁切比例')

/* ------------------------------------------------------------------ */
console.log('\n体积格式化')
check(fmtSize(900) === '900 B', '小于 1 KB 用 B')
check(fmtSize(400 * 1024) === '400 KB', 'KB 取整')
check(fmtSize(3 * MB) === '3.0 MB', 'MB 保留一位小数')

console.log('')
console.log(fail === 0 ? '图片导出判定全部通过' : `${fail} 项失败`)
if (fail > 0) process.exitCode = 1
