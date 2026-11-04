/**
 * 摘要层回归：不调用大模型，检查 splitSections + localDigest 在全部文章上的表现
 *
 * 检查项：
 * - 每篇都能切出 1–12 节（上限约束）
 * - 每节标题不含 Hugo 锚点残留 {#...}
 * - 本地摘要非空、不超 130 字、不含换行
 * - oneLiner 不超 60 字、不含换行
 * - 小红书兜底正文带「· 」要点行，推特条数 3–8
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { POSTS } from './posts-dir'
import { parseArticle } from '../src/core/parse'
import { splitSections } from '../src/core/sections'
import { buildAllFromDigest, localDigest } from '../src/ai/fallback'
import { charCount, weightedLength } from '../src/core/cjk'
import { LIMITS } from '../src/ai/types'

const files = readdirSync(POSTS).filter((f) => f.endsWith('.md') && !f.startsWith('_'))

let fail = 0
let maxSections = 0
let maxDigest = 0
let emptyDigests = 0

const problems: string[] = []

for (const file of files) {
  const src = readFileSync(join(POSTS, file), 'utf8')
  const doc = parseArticle({ source: src, fileName: file })
  const sections = splitSections(doc)

  if (sections.length === 0) {
    problems.push(`${file}: 切出 0 节`)
    fail++
    continue
  }
  if (sections.length > 12) {
    problems.push(`${file}: 切出 ${sections.length} 节，超过 12 上限`)
    fail++
  }
  maxSections = Math.max(maxSections, sections.length)

  for (const s of sections) {
    if (/\{#[^}]*\}/.test(s.heading)) {
      problems.push(`${file}: 标题残留锚点「${s.heading}」`)
      fail++
    }
  }

  const digest = localDigest(sections)
  if (!digest.oneLiner) {
    problems.push(`${file}: oneLiner 为空`)
    fail++
  }
  if (charCount(digest.oneLiner) > LIMITS.oneLinerMax) {
    problems.push(`${file}: oneLiner ${charCount(digest.oneLiner)} 字，超 ${LIMITS.oneLinerMax}`)
    fail++
  }
  if (/[\r\n]/.test(digest.oneLiner)) {
    problems.push(`${file}: oneLiner 含换行`)
    fail++
  }

  for (const s of digest.sections) {
    const c = charCount(s.summary)
    maxDigest = Math.max(maxDigest, c)
    if (!s.summary) {
      emptyDigests++
      problems.push(`${file}: 第 ${s.index} 节摘要为空`)
      fail++
    }
    if (c > LIMITS.digestMax) {
      problems.push(`${file}: 第 ${s.index} 节摘要 ${c} 字，超 ${LIMITS.digestMax}`)
      fail++
    }
    if (/[\r\n]/.test(s.summary)) {
      problems.push(`${file}: 第 ${s.index} 节摘要含换行`)
      fail++
    }
  }

  const out = buildAllFromDigest(digest, doc)
  if (out.xhs && !/^\s*·\s/m.test(out.xhs.body)) {
    problems.push(`${file}: 小红书兜底正文没有要点行`)
    fail++
  }
  if (out.xhs && charCount(out.xhs.body) > LIMITS.xhsBody) {
    problems.push(`${file}: 小红书兜底正文 ${charCount(out.xhs.body)} 字，超 ${LIMITS.xhsBody}`)
    fail++
  }
  if (out.twitter) {
    if (out.twitter.thread.length < 3 || out.twitter.thread.length > 8) {
      problems.push(`${file}: 推特兜底 ${out.twitter.thread.length} 条，不在 3–8 区间`)
      fail++
    }
    out.twitter.thread.forEach((t, i) => {
      if (weightedLength(t) > LIMITS.twitterWeighted) {
        problems.push(`${file}: 推特第 ${i + 1} 条 ${weightedLength(t)} 加权，超 ${LIMITS.twitterWeighted}`)
        fail++
      }
    })
  }
}

console.log(`扫描 ${files.length} 篇`)
console.log(`  最多切出 ${maxSections} 节；最长单节摘要 ${maxDigest} 字（上限 ${LIMITS.digestMax}）`)
console.log(`  空摘要 ${emptyDigests} 处`)

if (fail === 0) {
  console.log('✓ 摘要层全部通过')
} else {
  console.log(`✗ ${fail} 处问题：`)
  for (const p of problems.slice(0, 40)) console.log(`  · ${p}`)
  process.exitCode = 1
}
