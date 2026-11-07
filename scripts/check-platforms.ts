/**
 * 平台渲染器回归（覆盖全部 7 个格式转换平台）
 *
 * 三个新平台（B 站专栏 / 头条号 / 百家号）共用一套渲染，只有两处按平台分叉，
 * 而这两处恰好都是「看不见就出错」的地方：
 *
 * 1. **外链**：头条和百家号会剥掉正文里的 `<a>`。如果哪天有人手滑把
 *    `inlineLinks` 改回 true，页面上完全看不出来 —— 直到用户粘进编辑器、
 *    发现所有链接都变成了死文字。所以这里断言：这两家的产物里
 *    **一个 `<a href` 都不许有**，同时必须出现文末参考链接。
 * 2. **代码块**：三家都不保证等宽格式，必须有提示。提示漏了用户不会报错，
 *    只会默默发出一段排版烂掉的代码。
 *
 * 另外还扫 109 篇真实文章跑一遍，防止某个平台的渲染器在长文上崩。
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { POSTS } from './posts-dir'
import { parseArticle } from '../src/core/parse'
import { charCount } from '../src/core/cjk'
import { collectImages, collectLinks, type Doc } from '../src/core/ir'
import { convertPlatforms, rewritePlatforms, allPlatforms, platformGroups, type RenderOutput } from '../src/renderers'
import { renderCnBlog, renderBilibili, renderToutiao, renderBaijiahao } from '../src/renderers/cn-blogs'
import { loadOpenOnCopy, publishUrlOf, saveOpenOnCopy } from '../src/core/publish'
import { loadHidden, saveHidden, sortByWidth } from '../src/core/platform-visibility'
import { weightedLength } from '../src/core/cjk'

let failed = 0
function ok(cond: boolean, msg: string) {
  if (cond) console.log(`  ✓ ${msg}`)
  else {
    failed++
    console.log(`  ✗ ${msg}`)
  }
}

const OPTS = { wechatThemeId: 'paper' }

/** 手工构造一篇「什么都有」的文章，专门用来撞边界 */
const NASTY = `---
title: 一篇什么都有的文章
slug: nasty-everything
date: 2026-10-31
categories: [测试]
tags: [a, b]
---

开篇一段，带一个[站外链接](https://example.com/a)和[第二个链接](https://example.com/b)。

## 第一个小节

正文里有 **加粗**、\`行内代码\`、还有[重复的链接](https://example.com/a)。

![一张图](https://example.com/x.png)

\`\`\`ts
const x = 1
console.log(x)
\`\`\`

| 列一 | 列二 |
| --- | --- |
| 1 | 2 |

> 一段引用。

- 列表项一
- 列表项二

### 更深一层

正文里再放一个 <b>裸标签</b> 和 & 符号。

<span onclick="alert(1)" class="x">带事件的 span</span>

<script>alert('should be stripped')</script>
`

const nastyDoc = parseArticle({ source: NASTY, fileName: 'nasty-everything.md' })

/* ---------------- 1. 注册表完整性 ---------------- */

console.log('注册表：')

const ids = convertPlatforms.map((p) => p.id)
ok(ids.length === 7, `格式转换平台共 ${ids.length} 个（应为 7）`)
ok(new Set(ids).size === ids.length, '平台 id 无重复')
for (const id of ['bilibili', 'toutiao', 'baijiahao']) {
  ok(ids.includes(id), `已注册 ${id}`)
}
ok(
  convertPlatforms.every((p) => p.kind === 'convert' && typeof p.render === 'function'),
  '每项都是 convert 且有 render',
)

/* ---------------- 2. 外链分叉 ---------------- */

console.log('\n外链处置：')

const bi = renderBilibili(nastyDoc, OPTS)
const tt = renderToutiao(nastyDoc, OPTS)
const bj = renderBaijiahao(nastyDoc, OPTS)

const linkCount = collectLinks(nastyDoc.blocks).length
ok(linkCount === 2, `测试文章有 ${linkCount} 个不重复外链`)

ok(/<a href="https:\/\/example\.com\/a"/.test(bi.primary), 'B 站专栏保留正文 <a>')
ok(bi.primary.includes('example.com/b'), 'B 站专栏两个链接都在')

for (const [name, out] of [
  ['头条号', tt],
  ['百家号', bj],
] as const) {
  ok(!out.primary.includes('<a href'), `${name}产物里没有任何 <a href>（会被平台剥掉）`)
  ok(out.primary.includes('参考链接'), `${name}有文末「参考链接」标题`)
  ok(out.primary.includes('https://example.com/a'), `${name}把链接地址以纯文本留在文末`)
  ok(out.warnings.some((w) => w.includes('外链')), `${name}提示了外链被抽走`)
}

// 去重：两个链接指向同一 URL 时，文末只应出现一次
// （正文里的 [1] 上标是引用标记，不算 —— 只数文末列表项 `>[1] `）
const refsCount = (tt.primary.match(/>\[\d+\] /g) ?? []).length
ok(refsCount === 2, `文末参考列表共 ${refsCount} 条（重复链接合并，应为 2）`)

/* ---------------- 3. 代码块提示 ---------------- */

console.log('\n代码块：')

for (const [name, out] of [
  ['B 站专栏', bi],
  ['头条号', tt],
  ['百家号', bj],
] as const) {
  ok(out.warnings.some((w) => w.includes('代码')), `${name}对代码块给了提示`)
}
ok(bi.warnings.some((w) => w.includes('截图')), 'B 站专栏建议先截图（等宽会丢）')

/* ---------------- 4. 图片与结构 ---------------- */

console.log('\n图片与结构：')

const imgCount = collectImages(nastyDoc.blocks).length
for (const [name, out] of [
  ['B 站专栏', bi],
  ['头条号', tt],
  ['百家号', bj],
] as const) {
  ok(
    out.warnings.some((w) => w.includes('图床')),
    `${name}提示 ${imgCount} 张图要手动上传`,
  )
  ok(out.format === 'html' && out.copyMode === 'rich', `${name}走富文本复制`)
  ok(out.stats.some((s) => s.label === '图片'), `${name}有图片统计`)
}

// 标签配平：粘进编辑器前必须结构完整
const balanced = (html: string, tag: string) =>
  (html.match(new RegExp(`<${tag}[\\s>]`, 'g')) ?? []).length ===
  (html.match(new RegExp(`</${tag}>`, 'g')) ?? []).length

for (const [name, out] of [
  ['B 站专栏', bi],
  ['头条号', tt],
  ['百家号', bj],
] as const) {
  ok(balanced(out.primary, 'section'), `${name} <section> 配平`)
  ok(balanced(out.primary, 'table'), `${name} <table> 配平`)
  ok(balanced(out.primary, 'pre'), `${name} <pre> 配平`)
}

// 裸 HTML：`<b>` 这类无害标签是刻意放行的（三家编辑器都认加粗），
// 但 script 与事件属性必须已经在解析阶段被清掉 —— 这里检查的是「清洗确实发生过」
ok(bi.primary.includes('<b>裸标签</b>'), '无害的裸 <b> 保留（三家编辑器都认）')
ok(!bi.primary.includes('<script'), '<script> 已在解析阶段整块移除')
ok(!bi.primary.includes('onclick'), 'on* 事件属性已被清除')
ok(!bi.primary.includes('class="x"'), 'class 已被剥掉（微信会静默丢弃）')
ok(bi.primary.includes('&amp;'), '& 被转义成 &amp;')

/* ---------------- 5. 文本口径一致 ---------------- */

console.log('\n口径：')

const text = tt.text
ok(charCount(text) > 0, `纯文本非空（${charCount(text)} 字）`)
ok(!text.includes('<'), '纯文本里没有残留尖括号')
ok(tt.stats[0]?.value === `${charCount(text)} 字`, '「正文」统计与 text 字段一致')
ok(bi.fileName === 'nasty-everything.html', '文件名取 slug')

/* ---------------- 6. 直接调用 vs 包装函数 ---------------- */

console.log('\n包装函数：')

ok(
  renderCnBlog('bilibili', nastyDoc, OPTS).primary === bi.primary,
  'renderBilibili 与 renderCnBlog 输出一致',
)
ok(
  renderToutiao(nastyDoc, OPTS).primary === tt.primary &&
    renderBaijiahao(nastyDoc, OPTS).primary === bj.primary,
  '另外两个包装函数也一致',
)

/* ---------------- 7. 扫描 109 篇真实文章 ---------------- */

console.log('\n扫描真实文章：')

const files = readdirSync(POSTS).filter((f) => f.startsWith('_') === false && f.endsWith('.md'))

let crashes = 0
let empty = 0
let leakA = 0
let unbalanced = 0
const sizes: Record<string, number[]> = {}
for (const p of convertPlatforms) sizes[p.id] = []

for (const file of files) {
  const doc: Doc = parseArticle({ source: readFileSync(join(POSTS, file), 'utf8'), fileName: file })
  for (const p of convertPlatforms) {
    let out: RenderOutput
    try {
      out = p.render(doc, OPTS)
    } catch (e) {
      crashes++
      console.log(`  ✗ ${file} @ ${p.id}：${(e as Error).message}`)
      continue
    }
    if (!out.primary.trim()) {
      empty++
      console.log(`  ✗ ${file} @ ${p.id}：产物为空`)
    }
    sizes[p.id].push([...out.primary].length)

    // 头条/百家号不允许漏出 <a href>
    if ((p.id === 'toutiao' || p.id === 'baijiahao') && out.primary.includes('<a href')) {
      leakA++
      console.log(`  ✗ ${file} @ ${p.id}：正文里漏出了 <a href>`)
    }
    // 结构配平（只查最外层容器，够抓粗错）
    if (!balanced(out.primary, 'section')) {
      unbalanced++
      console.log(`  ✗ ${file} @ ${p.id}：<section> 不配平`)
    }
  }
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)

console.log(`\n  ${files.length} 篇 × ${convertPlatforms.length} 个平台 = ${files.length * convertPlatforms.length} 次渲染`)
console.log(`  崩溃 ${crashes} 次 · 空产物 ${empty} 次 · 漏 <a> ${leakA} 次 · 不配平 ${unbalanced} 次`)
for (const p of convertPlatforms) {
  const s = sizes[p.id]
  console.log(`  ${p.name.padEnd(6, '　')} 平均 ${avg(s).toFixed(0)} 字符，最多 ${Math.max(...s)}`)
}

/* ---------------- 发布页地址 ---------------- */

// 「复制后打开发布页」只是一个 URL 表，但错一处就会把用户送进 404。
// 这里守住三件：覆盖全、都是 https、没有两个平台共用一个地址。
console.log('\n发布页地址：')

const allPlatformIds = [...convertPlatforms.map((p) => p.id), ...rewritePlatforms.map((p) => p.id)]

const missingUrl = allPlatformIds.filter((id) => !publishUrlOf(id))
ok(
  missingUrl.length === 0,
  `${allPlatformIds.length} 个平台都配了发布页${missingUrl.length ? `（缺：${missingUrl.join('、')}）` : ''}`,
)

const notHttps = allPlatformIds.filter((id) => {
  const t = publishUrlOf(id)
  return !t || !t.url.startsWith('https://')
})
ok(notHttps.length === 0, '全部是 https（http 会被浏览器标「不安全」）')

const allUrls = allPlatformIds.map((id) => publishUrlOf(id)!.url)
ok(new Set(allUrls).size === allUrls.length, '没有两个平台共用同一个地址')

ok(publishUrlOf('cards') === null, '卡片平台没有发布页（它导出图片，不发布）')
ok(publishUrlOf('不存在的平台') === null, '未知平台返回 null 而不是抛异常')

/* ---------------- 「复制后打开发布页」开关 ---------------- */

console.log('\n发布页开关：')

const prefMem = new Map<string, string>()
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => prefMem.get(k) ?? null,
  setItem: (k: string, v: string) => void prefMem.set(k, v),
  removeItem: (k: string) => void prefMem.delete(k),
  clear: () => prefMem.clear(),
  key: () => null,
  length: 0,
} as Storage

ok(loadOpenOnCopy() === true, '没存过时默认打开（这是主要用法）')
saveOpenOnCopy(false)
ok(loadOpenOnCopy() === false, '关掉之后能读回来')
saveOpenOnCopy(true)
ok(loadOpenOnCopy() === true, '再打开也能读回来')

// 隐私模式下读写都会抛，必须降级成「默认开」而不是崩
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: () => {
    throw new Error('SecurityError')
  },
  setItem: () => {
    throw new Error('QuotaExceededError')
  },
  removeItem: () => {},
  clear: () => {},
  key: () => null,
  length: 0,
} as Storage
ok(loadOpenOnCopy() === true, '本地存储不可读时降级为默认打开')
let threw = false
try {
  saveOpenOnCopy(false)
} catch {
  threw = true
}
ok(!threw, '本地存储不可写时保存不抛异常')

/* ---------------- 侧栏排序与显示筛选 ---------------- */

console.log('\n侧栏排序：')

// 侧栏按名字长短排。用视觉宽度而不是字数：「B 站专栏」5 个字，
// 但 B 和空格都是半角，按字数排会跑到「配图卡片」前面，看着歪。
const convertSorted = sortByWidth(convertPlatforms).map((p) => p.name)
const rewriteSorted = sortByWidth(rewritePlatforms).map((p) => p.name)

console.log(`  格式转换：${convertSorted.join(' / ')}`)
console.log(`  内容改写：${rewriteSorted.join(' / ')}`)

ok(
  convertSorted.join(',') === '知乎,豆瓣,少数派,公众号,头条号,百家号,B 站专栏',
  `格式转换组顺序正确（实际：${convertSorted.join(',')}）`,
)
ok(
  rewriteSorted.join(',') === '即刻,微博,小红书,推特 / X',
  `内容改写组顺序正确（实际：${rewriteSorted.join(',')}）`,
)

const widths = (list: { name: string }[]) => list.map((p) => weightedLength(p.name))
const isMonotonic = (ws: number[]) => ws.every((w, i) => i === 0 || ws[i - 1] <= w)

ok(isMonotonic(widths(sortByWidth(convertPlatforms))), '格式转换组：宽度单调不减（短的在上面）')
ok(isMonotonic(widths(sortByWidth(rewritePlatforms))), '内容改写组：宽度单调不减')

// 只排不改：排序必须返回新数组，否则会把 renderers 里的注册表原地打乱
const before = convertPlatforms.map((p) => p.id).join(',')
sortByWidth(convertPlatforms)
ok(convertPlatforms.map((p) => p.id).join(',') === before, '排序不会改动原数组（注册表顺序不变）')

// 同宽度保持注册表顺序，避免每次渲染顺序漂移
const tied = sortByWidth([
  { name: '微博', id: 'a' },
  { name: '即刻', id: 'b' },
  { name: '豆瓣', id: 'c' },
])
ok(tied.map((x) => x.id).join(',') === 'a,b,c', '宽度相同的保持原有先后（稳定排序）')

console.log('\n显示筛选：')

// 筛选面板必须覆盖全部平台：漏一个，用户隐藏之后就再也找不回来了
const groupIds = new Set(platformGroups.flatMap((g) => g.list.map((p) => p.id)))
const missed = allPlatforms.filter((p) => !groupIds.has(p.id))
ok(missed.length === 0, `筛选面板覆盖全部 ${allPlatforms.length} 个平台${missed.length ? `（漏：${missed.join('、')}）` : ''}`)
ok(groupIds.size === allPlatforms.length, '筛选面板没有重复列出同一个平台')

const known = allPlatforms.map((p) => p.id)
const mem2 = new Map<string, string>()
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => mem2.get(k) ?? null,
  setItem: (k: string, v: string) => void mem2.set(k, v),
  removeItem: (k: string) => void mem2.delete(k),
  clear: () => mem2.clear(),
  key: () => null,
  length: 0,
} as Storage

ok(loadHidden(known).size === 0, '没存过时全部显示')
saveHidden(['weibo', 'cards'])
const back = loadHidden(known)
ok(back.size === 2 && back.has('weibo') && back.has('cards'), '隐藏集合能存能读')
saveHidden([])
ok(loadHidden(known).size === 0, '全部显示能存能读')

// 平台改名/下线后本地还留着旧 id：必须丢掉，否则「已隐藏 N」永远对不上列表
saveHidden(['weibo', '已经下线的平台'])
const pruned = loadHidden(known)
ok(pruned.size === 1 && pruned.has('weibo'), '不认识的 id 会被丢掉，不会污染计数')

mem2.set('ad.hiddenPlatforms.v1', '{不是数组}')
ok(loadHidden(known).size === 0, '本地存的是坏 JSON 时降级为全部显示')

// 隐私模式：读不到就当全部显示，写不进去要如实返回 false
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: () => {
    throw new Error('SecurityError')
  },
  setItem: () => {
    throw new Error('QuotaExceededError')
  },
  removeItem: () => {},
  clear: () => {},
  key: () => null,
  length: 0,
} as Storage
ok(loadHidden(known).size === 0, '本地存储不可读时降级为全部显示')
let threw2 = false
let saved2 = true
try {
  saved2 = saveHidden(['weibo'])
} catch {
  threw2 = true
}
ok(!threw2 && saved2 === false, '本地存储不可写时返回 false 而不是抛异常')

/* ---------------- 汇总 ---------------- */

if (crashes + empty + leakA + unbalanced > 0) {
  console.log(`\n✗ 扫描发现 ${crashes + empty + leakA + unbalanced} 处问题`)
  process.exit(1)
}
if (failed > 0) {
  console.log(`\n✗ ${failed} 项失败`)
  process.exit(1)
}
console.log('\n✓ 全部平台渲染通过')
