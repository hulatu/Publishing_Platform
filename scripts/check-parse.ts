/**
 * 解析与渲染自检脚本（开发用）
 *
 * 用法：
 *   node_modules/.bin/esbuild scripts/check-parse.ts --bundle --platform=node \
 *     --format=esm --outfile=/tmp/check-parse.mjs && node /tmp/check-parse.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { POSTS } from './posts-dir'
import { parseArticle } from '../src/core/parse'
import { renderWechat, WECHAT_CONTENT_LIMIT } from '../src/renderers/wechat'
import { renderSspai } from '../src/renderers/sspai'
import { renderZhihu } from '../src/renderers/zhihu'
import { renderDouban } from '../src/renderers/douban'
import { collectImages, collectLinks, inlineText } from '../src/core/ir'
import type { Block, Inline } from '../src/core/ir'
import { splitThread, weightedLength, countEmoji } from '../src/core/cjk'

interface Case {
  file: string
  bytes: number
}

function listPosts(): Case[] {
  return readdirSync(POSTS)
    .filter((f) => f.endsWith('.md') && f !== '_index.md')
    .map((f) => ({ file: f, bytes: statSync(join(POSTS, f)).size }))
    .sort((a, b) => b.bytes - a.bytes)
}

const all = listPosts()
const longest = all[0]
const shortest = all[all.length - 1]

// 再挑几篇有代表性的：含图片最多、含代码、含脚注
function findWith(pred: (src: string) => boolean): Case | undefined {
  return all.find((c) => {
    try {
      return pred(readFileSync(join(POSTS, c.file), 'utf8'))
    } catch {
      return false
    }
  })
}

const withFootnote = findWith((s) => s.includes('[^1]'))
const withCode = findWith((s) => s.includes('```'))
const withTable = findWith((s) => /^\|.*\|$/m.test(s))
const withIframe = findWith((s) => s.includes('<iframe'))

const cases = [longest, shortest, withFootnote, withCode, withTable, withIframe].filter(
  (c): c is Case => Boolean(c),
)

const seen = new Set<string>()
let failures = 0

function fail(msg: string) {
  failures++
  console.log(`  ✗ ${msg}`)
}

function ok(msg: string) {
  console.log(`  ✓ ${msg}`)
}

console.log(`\n共 ${all.length} 篇；抽样 ${cases.length} 篇\n${'='.repeat(70)}`)

for (const c of cases) {
  if (seen.has(c.file)) continue
  seen.add(c.file)

  const src = readFileSync(join(POSTS, c.file), 'utf8')
  console.log(`\n▸ ${c.file}  (${c.bytes} bytes)`)

  const doc = parseArticle({ source: src, fileName: c.file })

  console.log(`  title: ${doc.meta.title}`)
  console.log(`  分类: ${doc.meta.categories.join('/') || '(无)'}   标签: ${doc.meta.tags.join('/') || '(无)'}`)
  console.log(`  summary: ${doc.meta.summary.slice(0, 40)}`)

  const kinds: Record<string, number> = {}
  for (const b of doc.blocks) kinds[b.t] = (kinds[b.t] ?? 0) + 1
  console.log(`  blocks(${doc.blocks.length}): ${JSON.stringify(kinds)}`)

  // 断言：标题存在
  if (!doc.meta.title) fail('title 为空')
  // 断言：block 非空
  if (doc.blocks.length === 0) fail('解析后 blocks 为空')

  // 断言：加粗与行内代码没有丢失（对比源文件的 ** 数量）
  const srcStrong = (src.match(/\*\*/g) ?? []).length / 2
  let irStrong = 0
  let irCode = 0
  const scanInline = (nodes: Inline[]) => {
    for (const n of nodes) {
      if (n.t === 'strong') irStrong++
      if (n.t === 'code') irCode++
      if (n.t === 'strong' || n.t === 'em' || n.t === 'del' || n.t === 'link') scanInline(n.c)
    }
  }
  const walkBlocks = (bs: Block[]) => {
    for (const b of bs) {
      if (b.t === 'p' || b.t === 'heading') scanInline(b.inline)
      else if (b.t === 'quote') walkBlocks(b.children)
      else if (b.t === 'list') for (const it of b.items) walkBlocks(it)
      else if (b.t === 'fn') walkBlocks(b.children)
    }
  }
  walkBlocks(doc.blocks)
  console.log(`  加粗: 源文件约 ${Math.round(srcStrong)} 处 → IR ${irStrong} 处；行内代码 ${irCode} 处`)
  if (srcStrong > 0 && irStrong === 0) fail('加粗全部丢失')

  // 图片 / 外链
  const images = collectImages(doc.blocks)
  const links = collectLinks(doc.blocks)
  console.log(`  图片 ${images.length} 张，外链 ${links.length} 个`)

  // ---- 公众号 ----
  const wx = renderWechat(doc, { wechatThemeId: 'paper' })
  const wxChars = wx.html!.length
  console.log(
    `  [公众号] HTML ${wxChars} 字符 (${Math.round((wxChars / WECHAT_CONTENT_LIMIT) * 100)}% of 20000)`,
  )
  if (wx.html!.includes('<pre')) fail('公众号输出含 <pre>（微信移动端会截断代码）')
  if (/<pre[\s>]/.test(wx.html!)) fail('公众号输出含 <pre>')
  if (wx.html!.includes('data-src')) fail('公众号输出含 data-src（会被当懒加载占位）')
  if (/\sclass=/.test(wx.html!)) fail('公众号输出含 class')
  if (/\sid=/.test(wx.html!)) fail('公众号输出含 id')
  if (wx.html!.includes('<style')) fail('公众号输出含 <style>')
  if (wx.html!.includes('<a ')) fail('公众号输出含 <a>（未认证号外链会失效）')
  if (!wx.html!.includes('参考链接') && links.length > 0) fail('有外链但没生成参考链接区')
  if (wxChars > WECHAT_CONTENT_LIMIT) {
    console.log(`  ⚠ 超过 20000 字符上限 ${wxChars - WECHAT_CONTENT_LIMIT} 字符，需按 H2 拆篇`)
  } else {
    ok('公众号 HTML 约束全部通过')
  }

  // ---- 少数派 / 知乎 / 豆瓣 ----
  const sspai = renderSspai(doc, { wechatThemeId: 'paper' })
  if (!sspai.primary.trim()) fail('少数派 Markdown 为空')
  const zhihu = renderZhihu(doc, { wechatThemeId: 'paper' })
  if (!zhihu.primary.trim()) fail('知乎 Markdown 为空')
  const douban = renderDouban(doc, { wechatThemeId: 'paper' })
  if (!douban.html!.trim()) fail('豆瓣 HTML 为空')

  // Hugo 的标题锚点（`## 标题 {#anchor}`）是渲染期指令，Goldmark 会吃掉，
  // markdown-it 不会 —— 一旦漏进产物，标题里就会明晃晃多出一串 {#first-section}
  for (const [label, text] of [
    ['公众号', wx.html!],
    ['少数派', sspai.primary],
    ['知乎', zhihu.primary],
    ['豆瓣', douban.html!],
  ] as const) {
    if (/\{#[^}]*\}/.test(text)) fail(`${label} 输出残留 Hugo 锚点 {#…}`)
  }

  // Markdown 往返：把输出的 md 再解析一次，块数应基本一致
  const round = parseArticle({ source: sspai.primary, fileName: c.file })
  const delta = Math.abs(round.blocks.length - doc.blocks.length)
  console.log(`  [往返] 原 ${doc.blocks.length} 块 → 再解析 ${round.blocks.length} 块 (差 ${delta})`)
  if (delta > Math.max(3, Math.round(doc.blocks.length * 0.1))) {
    fail(`Markdown 往返块数偏差过大：${doc.blocks.length} → ${round.blocks.length}`)
  }

  // ---- Twitter thread ----
  const body = doc.blocks
    .filter((b) => b.t === 'p')
    .slice(0, 8)
    .map((b) => (b.t === 'p' ? inlineText(b.inline) : ''))
    .join('\n\n')
  if (body.length > 50) {
    const thread = splitThread(body)
    const over = thread.tweets.filter((t) => weightedLength(t) > 280)
    console.log(`  [推特] 切出 ${thread.tweets.length} 条，最长 ${Math.max(...thread.tweets.map(weightedLength))} 加权字符`)
    if (over.length > 0) fail(`${over.length} 条超过 280 加权字符`)
  }

  console.log(`  emoji 数: ${countEmoji(body)}`)

  if (doc.warnings.length) {
    console.log('  warnings:')
    for (const w of doc.warnings) console.log(`    · ${w}`)
  }
}

console.log(`\n${'='.repeat(70)}`)
console.log(failures === 0 ? `全部检查通过（${seen.size} 篇）` : `发现 ${failures} 处问题`)

/* ---------------- 全量扫描：公众号字符数分布 ---------------- */
console.log(`\n${'='.repeat(70)}\n全量扫描 ${all.length} 篇：公众号 HTML 字符数分布\n`)

const buckets = { ok: 0, warn: 0, over: 0 }
const overList: { file: string; chars: number }[] = []
const stats: { file: string; chars: number; blocks: number }[] = []

for (const c of all) {
  const src = readFileSync(join(POSTS, c.file), 'utf8')
  const doc = parseArticle({ source: src, fileName: c.file })
  const wx = renderWechat(doc, { wechatThemeId: 'paper' })
  const n = wx.html!.length
  stats.push({ file: c.file, chars: n, blocks: doc.blocks.length })
  if (n > WECHAT_CONTENT_LIMIT) {
    buckets.over++
    overList.push({ file: c.file, chars: n })
  } else if (n > WECHAT_CONTENT_LIMIT * 0.85) buckets.warn++
  else buckets.ok++
}

stats.sort((a, b) => b.chars - a.chars)
console.log(`安全 (<17000)  : ${buckets.ok} 篇`)
console.log(`接近 (17000-20000): ${buckets.warn} 篇`)
console.log(`超限 (>20000)  : ${buckets.over} 篇`)

console.log('\n字符数 Top 10：')
for (const s of stats.slice(0, 10)) {
  const flag = s.chars > WECHAT_CONTENT_LIMIT ? '  ⚠ 超限' : ''
  console.log(`  ${String(s.chars).padStart(6)}  ${s.file}${flag}`)
}

if (overList.length > 0) {
  console.log('\n需要按 H2 拆篇的文章：')
  for (const o of overList) console.log(`  ${o.chars}  ${o.file}`)
}

/* ---------------- 全量扫描：Hugo 锚点不得漏进产物 ---------------- */
let anchorPosts = 0
let anchorLeaks = 0
for (const c of all) {
  const src = readFileSync(join(POSTS, c.file), 'utf8')
  if (!/^#{1,6}\s.*\{#[^}]*\}/m.test(src)) continue
  anchorPosts++
  const doc = parseArticle({ source: src, fileName: c.file })
  const wx = renderWechat(doc, { wechatThemeId: 'paper' })
  if (/\{#[^}]*\}/.test(wx.html!)) {
    anchorLeaks++
    fail(`${c.file}：公众号输出残留 Hugo 锚点`)
  }
}
console.log(`\n带 Hugo 锚点的文章 ${anchorPosts} 篇，泄漏 ${anchorLeaks} 篇`)

process.exit(failures === 0 ? 0 : 1)
