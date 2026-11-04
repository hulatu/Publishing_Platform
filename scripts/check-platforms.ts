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
import { convertPlatforms, type RenderOutput } from '../src/renderers'
import { renderCnBlog, renderBilibili, renderToutiao, renderBaijiahao } from '../src/renderers/cn-blogs'

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
