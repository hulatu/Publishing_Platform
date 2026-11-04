/**
 * 标题候选回归：本地兜底能不能稳定给出 8 条、其中 ≥3 条在 20 字内
 *
 * 为什么要量这个：标题是最容易被「模型不可用」打穿的环节 —— 没填 Key 的时候
 * 用户看到的应该是「8 条里挑一条」，而不是「两条废话」。所以本地拼装这一路
 * 必须自己就站得住，不能指望模型兜。
 *
 * 判定：
 * - 每条 ≤40 字、无营销腔、无重复（硬性，出现即失败）
 * - ≥3 条 ≤20 字（硬性，小红书标题上限）
 * - 条数：8 条为达标，6–7 条记一次 warning（模板文章的小节标题全是「第一个小节」
 *   这类序号时，确实凑不满，硬凑出来的只会更差）
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { POSTS } from './posts-dir'
import { parseArticle } from '../src/core/parse'
import { splitSections } from '../src/core/sections'
import { charCount, findBlacklisted } from '../src/core/cjk'
import { localMetaLab, shortCount } from '../src/ai/meta-lab'
import { LIMITS } from '../src/ai/types'

const files = readdirSync(POSTS).filter((f) => f.endsWith('.md') && !f.startsWith('_'))

let failed = 0
let warn = 0
let total = 0
let fullEight = 0
const counts: number[] = []
const samples: string[] = []

for (const file of files) {
  const src = readFileSync(join(POSTS, file), 'utf8')
  const doc = parseArticle({ source: src, fileName: file })
  const sections = splitSections(doc)
  const set = localMetaLab(doc, null, sections)
  total++

  const problems: string[] = []
  const n = set.titles.length
  counts.push(n)
  if (n === LIMITS.titleCount) fullEight++
  else if (n < 6) problems.push(`只有 ${n} 条标题`)

  const seen = new Set<string>()
  for (const t of set.titles) {
    const c = charCount(t.text)
    if (c > LIMITS.titleMax) problems.push(`「${t.text.slice(0, 14)}…」${c} 字超过 ${LIMITS.titleMax}`)
    if (c < 4) problems.push(`「${t.text}」太短`)
    const k = t.text.replace(/[\s，,。.、：:；;！!？?「」『』"'—\-·]/g, '')
    if (seen.has(k)) problems.push(`重复：${t.text}`)
    seen.add(k)
  }

  const bad = findBlacklisted(set.titles.map((t) => t.text).join(' '))
  if (bad.length) problems.push(`营销腔：${bad.join('、')}`)

  const shorts = shortCount(set)
  if (shorts < LIMITS.titleMinShort) problems.push(`20 字内只有 ${shorts} 条`)

  if (problems.length) {
    failed++
    if (samples.length < 6) samples.push(`${file}：${problems.join('；')}`)
  } else if (n < LIMITS.titleCount) {
    warn++
  }
}

counts.sort((a, b) => a - b)
const avg = counts.reduce((a, b) => a + b, 0) / Math.max(1, counts.length)

console.log(`扫描 ${total} 篇（本地拼装，不调模型）`)
console.log(`  条数：最少 ${counts[0]}，中位 ${counts[Math.floor(counts.length / 2)]}，最多 ${counts[counts.length - 1]}，平均 ${avg.toFixed(1)}`)
console.log(`  凑满 ${LIMITS.titleCount} 条：${fullEight} 篇（${Math.round((fullEight / total) * 100)}%）`)
console.log(`  条数不足但内容合格：${warn} 篇`)

if (samples.length) {
  console.log('  有问题的样本：')
  for (const s of samples) console.log(`    ${s}`)
}

if (failed > 0) {
  console.log(`\n✗ ${failed} 篇不合格`)
  process.exit(1)
}
console.log('\n✓ 标题层全部通过')
