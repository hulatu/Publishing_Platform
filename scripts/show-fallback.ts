/** 打印本地兜底的真实产物，用于判断「没配 AI 时」用户看到什么 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArticle } from '../src/core/parse'
import { splitSections } from '../src/core/sections'
import { buildAllFromDigest, localDigest } from '../src/ai/fallback'
import { charCount, weightedLength } from '../src/core/cjk'
import { POSTS } from './posts-dir'

const file = process.argv[2] ?? '三类财富杠杆.md'

const src = readFileSync(join(POSTS, file), 'utf8')
const doc = parseArticle({ source: src, fileName: file })
const sections = splitSections(doc)
const digest = localDigest(sections)
const out = buildAllFromDigest(digest, doc)

console.log(`\n${'='.repeat(72)}\n文章：${doc.meta.title}（切 ${sections.length} 节）\n${'='.repeat(72)}`)

console.log(`\n【逐节摘要】全篇一句话：${digest.oneLiner}`)
for (const s of digest.sections) {
  console.log(`\n${String(s.index).padStart(2, '0')} ${s.heading}  (${charCount(s.summary)} 字)`)
  console.log(`   ${s.summary}`)
}

if (out.xhs) {
  console.log(`\n${'-'.repeat(72)}\n【小红书】标题 (${charCount(out.xhs.title)}/20 字)`)
  console.log(out.xhs.title)
  console.log(`\n【小红书】正文 (${charCount(out.xhs.body)}/1000 字)`)
  console.log(out.xhs.body)
  console.log(`\n【小红书】话题`)
  console.log(out.xhs.tags.map((t) => `#${t}`).join(' '))
}

if (out.twitter) {
  console.log(`\n【推特】${out.twitter.thread.length} 条`)
  out.twitter.thread.forEach((t, i) => {
    console.log(`\n--- ${i + 1}/${out.twitter!.thread.length} (${weightedLength(t)}/280 加权) ---`)
    console.log(t)
  })
}

if (out.jike) {
  console.log(`\n【即刻】(${charCount(out.jike.body)}/500 字)`)
  console.log(out.jike.body)
}

if (out.weibo) {
  console.log(`\n【微博】(${charCount(out.weibo.text)}/140 字)`)
  console.log(out.weibo.text, out.weibo.topics.map((t) => `#${t}#`).join(' '))
}
