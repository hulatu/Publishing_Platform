/**
 * 合规检查回归：把词表跑一遍全部真实文章，看误报率
 *
 * 词表类功能的死法是「太吵」——每篇都报十几条，用户第二次就不看了。
 * 这个脚本用作者自己的 109 篇文章当负样本：这些文章本来都发出去过，
 * 命中率应该低到「偶尔提醒一次」的量级。
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { POSTS } from './posts-dir'
import { parseArticle } from '../src/core/parse'
import { blocksToText } from '../src/core/ir'
import { checkText, stripHtml, scopeOf } from '../src/core/compliance'
import { getConvertPlatform } from '../src/renderers'

const files = readdirSync(POSTS).filter((f) => f.endsWith('.md') && !f.startsWith('_'))

let articlesWithHits = 0
let totalHits = 0
const byRule = new Map<string, { count: number; samples: string[] }>()
const worst: { file: string; n: number }[] = []

for (const file of files) {
  const src = readFileSync(join(POSTS, file), 'utf8')
  const doc = parseArticle({ source: src, fileName: file })

  // 用公众号产物检查（覆盖面最广：正文 + 标题 + 引用都在里面）
  const p = getConvertPlatform('wechat')
  const html = p ? p.render(doc, { wechatThemeId: 'paper' }).primary : ''
  const text = html ? stripHtml(html) : blocksToText(doc.blocks)

  const hits = checkText(text, scopeOf('wechat'))
  totalHits += hits.length
  if (hits.length > 0) {
    articlesWithHits++
    worst.push({ file, n: hits.length })
  }

  for (const h of hits) {
    const cur = byRule.get(h.ruleId) ?? { count: 0, samples: [] }
    cur.count++
    if (cur.samples.length < 3) cur.samples.push(`${h.match} → ${h.context.slice(0, 40)}`)
    byRule.set(h.ruleId, cur)
  }
}

worst.sort((a, b) => b.n - a.n)

console.log(`扫描 ${files.length} 篇（公众号产物）`)
console.log(`  有命中的文章 ${articlesWithHits} 篇（${((articlesWithHits / files.length) * 100).toFixed(0)}%），共 ${totalHits} 处`)

if (byRule.size > 0) {
  console.log('  按规则：')
  for (const [id, v] of [...byRule.entries()].sort((a, b) => b[1].count - a[1].count)) {
    console.log(`    ${id.padEnd(14)} ${String(v.count).padStart(3)} 处   例：${v.samples[0]}`)
  }
}

if (worst.length > 0) {
  console.log('  命中最多的文章：')
  for (const w of worst.slice(0, 5)) console.log(`    ${w.n} 处  ${w.file}`)
}

// 阈值：单篇平均超过 2 处就说明太吵，需要收紧词表
const avg = totalHits / files.length
if (avg > 2) {
  console.log(`✗ 平均每篇 ${avg.toFixed(1)} 处，太吵，收紧词表`)
  process.exitCode = 1
} else {
  console.log(`✓ 平均每篇 ${avg.toFixed(2)} 处，可接受`)
}
