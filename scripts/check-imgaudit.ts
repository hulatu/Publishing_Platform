/**
 * 图片体检的判定逻辑
 *
 * 这个脚本只测**纯函数**（judge / summarize / 扩展名归一），不碰网络 ——
 * 「能不能取到图」取决于图床今天开没开，不该让 CI 红。
 *
 * 为什么值得单独立一条回归：这里的每一条判断都会直接影响人「要不要重新处理这张图」，
 * 判错的代价是白折腾一场，或者反过来 —— 明明会裂却没报。
 * 尤其是「防盗链」和「打不开」这两条：它们长得像，但修法完全不同
 * （一个去关 Cloudflare 的开关，一个去查图还在不在）。
 */

import {
  fmtBytes,
  imageRule,
  judge,
  mimeExt,
  normalizeExt,
  summarize,
  urlExt,
  type ImageFacts,
  type ImageIssue,
} from '../src/core/image-audit'

let fail = 0
const check = (cond: boolean, msg: string) => {
  if (cond) {
    console.log(`  ✓ ${msg}`)
  } else {
    console.log(`  ✗ ${msg}`)
    fail++
  }
}

const tags = (issues: ImageIssue[]) => issues.map((i) => i.tag).join(',')
const has = (issues: ImageIssue[], tag: string) => issues.some((i) => i.tag === tag)
const levelOf = (issues: ImageIssue[], tag: string) => issues.find((i) => i.tag === tag)?.level

const WECHAT = imageRule('wechat')
const XHS = imageRule('xiaohongshu')
const GENERIC = imageRule('sspai')

console.log('\n扩展名归一')
check(normalizeExt('JPEG') === 'jpg', 'JPEG → jpg')
check(normalizeExt('.jpeg') === 'jpg', '.jpeg → jpg（带点也认）')
check(normalizeExt('svg+xml') === 'svg', 'svg+xml → svg')
check(normalizeExt('PNG') === 'png', 'PNG → png（大小写无关）')

console.log('\n从地址取扩展名')
check(urlExt('https://a.com/x/a.WEBP') === 'webp', '.WEBP → webp')
check(urlExt('https://a.com/a.jpg?v=2') === 'jpg', '丢掉 ?query')
check(urlExt('https://a.com/a.jpg#frag') === 'jpg', '丢掉 #hash')
check(urlExt('https://a.com/no-ext') === '', '没有扩展名返回空串')
check(urlExt('./images/a.png') === 'png', '相对路径也认')

console.log('\n从 MIME 取扩展名')
check(mimeExt('image/jpeg') === 'jpg', 'image/jpeg → jpg')
check(mimeExt('image/jpeg; charset=binary') === 'jpg', '带参数也能取')
check(mimeExt('text/html') === '', '不是图片返回空串')
check(mimeExt(undefined) === '', 'undefined 返回空串')

console.log('\n判定：地址本身就有问题')
check(has(judge({}, GENERIC, './images/a.jpg'), '本地路径'), '本地相对路径 → 报「本地路径」')
check(
  levelOf(judge({}, GENERIC, '/images/a.jpg'), '本地路径') === 'error',
  '本地路径是 error 不是 warn（粘出去必然取不到）',
)
check(has(judge({}, GENERIC, 'data:image/png;base64,AAA'), '内嵌图片'), 'base64 内嵌 → 报「内嵌图片」')
check(
  !has(judge({}, GENERIC, 'data:image/png;base64,AAA'), '本地路径'),
  '内嵌图不再被当成「本地路径」重复报',
)

console.log('\n判定：取不到 vs 防盗链')
const dead = judge({ loaded: false }, GENERIC, 'https://a.com/a.jpg')
check(has(dead, '打不开'), '加载失败 → 报「打不开」')

const hot = judge({ loaded: true, hotlink: true }, GENERIC, 'https://a.com/a.jpg')
check(has(hot, '防盗链'), '取得到但别的站引用被拒 → 报「防盗链」')
check(!has(hot, '打不开'), '图本身取得到时不报「打不开」')
check(levelOf(hot, '防盗链') === 'error', '防盗链是 error')

// 既死又被拦：两条都说。修法不同，合并成一条会漏掉一半信息
const both = judge({ loaded: false, hotlink: true }, GENERIC, 'https://a.com/a.jpg')
check(has(both, '打不开') && has(both, '防盗链'), '既取不到又被拦 → 两条都报')

// 代理说「200 + 是张图」，浏览器说「没加载出来」—— 图是存在的，
// 报成「打不开」会让人去删图重传，方向全错。降成 warn 并说清成因。
const ghost = judge({ loaded: false, reachable: true }, GENERIC, 'https://a.com/a.jpg')
check(!has(ghost, '打不开'), '代理确认取得到时，不许报「打不开」')
check(has(ghost, '没显示'), '改报「没显示」—— 说明是这边没加载出来，不是图没了')
check(levelOf(ghost, '没显示') === 'warn', '「没显示」是 warn（图还在，不用重传）')

// 代理也取不到 → 才是真的没了，仍然按 error 报
const gone = judge({ loaded: false, reachable: false }, GENERIC, 'https://a.com/a.jpg')
check(has(gone, '打不开') && levelOf(gone, '打不开') === 'error', '代理也取不到 → 「打不开」仍是 error')

console.log('\n判定：格式')
const svg = judge({ loaded: true, contentType: 'image/svg+xml' }, WECHAT, 'https://a.com/a.svg')
check(has(svg, 'SVG 不支持'), '公众号 + SVG → 报不支持')
check(
  !has(judge({ loaded: true, contentType: 'image/svg+xml' }, GENERIC, 'https://a.com/a.svg'), 'SVG 不支持'),
  '别的平台不报 SVG（只有公众号会剥）',
)

const lie = judge({ loaded: true, contentType: 'image/jpeg' }, GENERIC, 'https://a.com/a.webp')
check(has(lie, '格式不符'), '.webp 实际是 JPEG → 报「格式不符」')
check(levelOf(lie, '格式不符') === 'warn', '格式不符是 warn 不是 error（浏览器照样显示）')
check(
  !has(judge({ loaded: true, contentType: 'image/jpeg' }, GENERIC, 'https://a.com/a.jpg'), '格式不符'),
  '.jpg 实际是 JPEG 不误报（同一个东西）',
)
check(
  !has(judge({ loaded: true, contentType: 'image/jpeg' }, GENERIC, 'https://a.com/a.jpeg'), '格式不符'),
  '.jpeg 实际是 JPEG 不误报',
)

console.log('\n判定：体积')
const heavy: ImageFacts = { loaded: true, bytes: 3 * 1024 * 1024, contentType: 'image/gif' }
check(has(judge(heavy, GENERIC, 'https://a.com/a.gif'), '偏大'), '3 MB → 报「偏大」')
check(
  !has(judge({ loaded: true, bytes: 300 * 1024, contentType: 'image/jpeg' }, GENERIC, 'https://a.com/a.jpg'), '偏大'),
  '300 KB 不报',
)
check(fmtBytes(900) === '900 B', 'fmtBytes: 900 B')
check(fmtBytes(1536) === '2 KB', 'fmtBytes: 1536 → 2 KB')
check(fmtBytes(3 * 1024 * 1024) === '3.0 MB', 'fmtBytes: 3 MB')

console.log('\n判定：比例')
check(
  has(judge({ loaded: true, width: 1920, height: 1080 }, XHS, 'https://a.com/a.jpg'), '比例'),
  '小红书 + 16:9 横图 → 报「比例」',
)
check(
  !has(judge({ loaded: true, width: 1080, height: 1440 }, XHS, 'https://a.com/a.jpg'), '比例'),
  '小红书 + 3:4 竖图 → 不报',
)
check(
  !has(judge({ loaded: true, width: 1920, height: 1080 }, GENERIC, 'https://a.com/a.jpg'), '比例'),
  '别的平台不查比例',
)

console.log('\n判定：干净的情况')
const clean = judge(
  { loaded: true, width: 1080, height: 1440, bytes: 180 * 1024, contentType: 'image/jpeg' },
  XHS,
  'https://img.hulatu.com/post/a.jpg',
)
check(clean.length === 0, '尺寸、体积、格式、比例都合规 → 0 条结论')

console.log('\n汇总')
check(summarize([], true).line.includes('没有图片'), '0 张时直说「没有图片」')
check(
  summarize([{ issues: [], bytes: 1 }, { issues: [], bytes: 2 }], true).clean,
  '全干净 + 查过 → clean',
)
const partial = summarize([{ issues: [] }, { issues: [] }], false)
check(!partial.clean || partial.line.includes('还没查'), '没跑代理探测时不许说「都没问题」')
check(partial.line.includes('还没查'), '没跑探测时明说「体积和格式还没查」')
// 查了但量不到体积（取图被 403 挡住）—— 这时说「体积没问题」就是撒谎
const unmeasured = summarize([{ issues: [], bytes: 1 }, { issues: [] }], true)
check(unmeasured.measured === 1, '量到体积的张数单独统计')
check(unmeasured.line.includes('没查全'), '有图量不到体积时，结论里不许声称体积没问题')
const mixed = summarize([{ issues: [], bytes: 1 }, { issues: [{ level: 'error', tag: '防盗链', detail: '' }] }], true)
check(mixed.errors === 1, '有 1 张 error 时 errors=1')
check(mixed.line.includes('1 张不能直接用'), '总结句说清有几张不能用')

console.log('\n平台规则')
check(imageRule('wechat').banned.includes('svg'), '公众号禁 SVG')
check(imageRule('xiaohongshu').ratio?.[0] === 3 && imageRule('xiaohongshu').ratio?.[1] === 4, '小红书 3:4')
check(imageRule('不存在').heavyBytes > 0, '未知平台回落到默认规则，不会 undefined')
check(Boolean(imageRule('wechat').note), '每个规则都带一句说明')

console.log('')
console.log(fail === 0 ? '图片体检判定全部通过' : `${fail} 项失败`)
if (fail > 0) process.exitCode = 1
