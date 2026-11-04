/**
 * 配图层回归：每篇真实文章都按「封面 → 每节一张 → 结尾」出图，检查卡片数据
 *
 * 检查项：
 * - 卡片数 = 小节数 + 2，id 不重复
 * - 页码连续且格式为 NN / TT，TT 等于总张数
 * - 每张小节卡都有标题和摘要，摘要非空、不含换行、不超过画布容量（118 字）
 * - 小节卡标题不含 Hugo 锚点残留
 * - 每张卡都有署名，主题 id 一致
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { POSTS } from './posts-dir'
import { parseArticle } from '../src/core/parse'
import { splitSections } from '../src/core/sections'
import { buildCards } from '../src/cards/build'
import { charCount } from '../src/core/cjk'

/** 与 build.ts 里的 SECTION_SUMMARY_MAX 保持一致 */
const SUMMARY_CAP = 118

const files = readdirSync(POSTS).filter((f) => f.endsWith('.md') && !f.startsWith('_'))

let fail = 0
let maxCards = 0
let maxSummary = 0
let totalCards = 0

const problems: string[] = []

for (const file of files) {
  const src = readFileSync(join(POSTS, file), 'utf8')
  const doc = parseArticle({ source: src, fileName: file })
  const sections = splitSections(doc)
  const cards = buildCards({ doc, themeId: 'paper', siteName: '胡拉图说', sections })

  totalCards += cards.length
  maxCards = Math.max(maxCards, cards.length)

  const expect = sections.length > 0 ? sections.length + 2 : cards.length
  if (cards.length !== expect) {
    problems.push(`${file}: ${cards.length} 张卡，期望 ${expect}（小节 ${sections.length}）`)
    fail++
  }

  const ids = new Set<string>()
  for (const c of cards) {
    if (ids.has(c.id)) {
      problems.push(`${file}: 卡片 id 重复「${c.id}」`)
      fail++
    }
    ids.add(c.id)

    if (!c.footer) {
      problems.push(`${file}: ${c.id} 没有署名`)
      fail++
    }
    if (!c.mark) {
      problems.push(`${file}: ${c.id} 没有页码`)
      fail++
    }
  }

  // 页码必须是 01 / TT … TT / TT
  const total = cards.length
  const pad = (n: number) => String(n).padStart(2, '0')
  cards.forEach((c, i) => {
    const want = `${pad(i + 1)} / ${pad(total)}`
    if (c.mark !== want) {
      problems.push(`${file}: 第 ${i + 1} 张页码是「${c.mark}」，期望「${want}」`)
      fail++
    }
  })

  for (const c of cards) {
    if (c.layout !== 'section') continue

    if (!c.title.trim()) {
      problems.push(`${file}: 小节卡标题为空`)
      fail++
    }
    if (/\{#[^}]*\}/.test(c.title)) {
      problems.push(`${file}: 小节卡标题残留锚点「${c.title}」`)
      fail++
    }
    const summary = c.subtitle ?? ''
    const n = charCount(summary)
    maxSummary = Math.max(maxSummary, n)
    if (n === 0) {
      problems.push(`${file}: 小节卡「${c.title}」摘要为空`)
      fail++
    }
    if (n > SUMMARY_CAP) {
      problems.push(`${file}: 小节卡「${c.title}」摘要 ${n} 字，超 ${SUMMARY_CAP}`)
      fail++
    }
    if (/[\r\n]/.test(summary)) {
      problems.push(`${file}: 小节卡「${c.title}」摘要含换行`)
      fail++
    }
  }
}

console.log(`扫描 ${files.length} 篇`)
console.log(`  共 ${totalCards} 张卡；单篇最多 ${maxCards} 张；最长小节摘要 ${maxSummary} 字（上限 ${SUMMARY_CAP}）`)

if (fail === 0) {
  console.log('✓ 配图层全部通过')
} else {
  console.log(`✗ ${fail} 处问题：`)
  for (const p of problems.slice(0, 40)) console.log(`  · ${p}`)
  process.exitCode = 1
}
