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
import { cardFileName, cardNo } from '../src/cards/export'
import { CARD_FORMATS } from '../src/cards/types'
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

/* ------------------------------------------------------------------ */
/* 导出文件名：编号必须在、必须补零、必须唯一                              */
/* ------------------------------------------------------------------ */
/*
 * 文件名是用户挑图的唯一线索：卡片上的页码（01 / 08）只印在图里，
 * 在下载文件夹里看不见。编号一旦缺了或者没补零，多选上传就会乱序
 * （`10` 排到 `2` 前面），而这种错只有到平台上才发现。
 */
const NAME_MAX = 48
let nameSamples: string[] = []

for (const file of files) {
  const src = readFileSync(join(POSTS, file), 'utf8')
  const doc = parseArticle({ source: src, fileName: file })
  const cards = buildCards({ doc, themeId: 'paper', siteName: '胡拉图说', sections: splitSections(doc) })
  const names = cards.map((c, i) => cardFileName(c, i, doc.meta.title))

  names.forEach((n, i) => {
    const want = cardNo(i + 1)
    // 编号必须在最前面：文件名被截断时末尾会先没，编号不能跟着丢
    if (!n.startsWith(`${want}-`)) {
      problems.push(`${file}: 第 ${i + 1} 张的文件名「${n}」不是以编号 ${want}- 开头`)
      fail++
    }
    if (n.length > NAME_MAX) {
      problems.push(`${file}: 文件名 ${n.length} 字超过 ${NAME_MAX}「${n}」`)
      fail++
    }
    if (/[\\/:*?"<>|]/.test(n)) {
      problems.push(`${file}: 文件名含非法字符「${n}」`)
      fail++
    }
  })

  // 按名称排序后必须还是卡片顺序 —— 补零的全部意义就在这一条
  const sorted = [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  if (sorted.join('\n') !== names.join('\n')) {
    const at = names.findIndex((n, i) => n !== sorted[i])
    problems.push(`${file}: 按名称排序后顺序变了，第 ${at + 1} 张成了「${sorted[at]}」`)
    fail++
  }

  // 重名会让 zip 里后一张覆盖前一张
  if (new Set(names).size !== names.length) {
    problems.push(`${file}: 文件名有重复`)
    fail++
  }

  // 编号只补到两位，100 张以上会退化成 100 < 11 的字典序错误。
  // 一套图最多十几张（小红书上限 18 张），这里只是把边界钉住
  if (names.length > 99) {
    problems.push(`${file}: ${names.length} 张卡，超过两位编号的容量（99）`)
    fail++
  }

  if (!nameSamples.length) nameSamples = names.slice(0, 4)
}

console.log(`扫描 ${files.length} 篇`)
console.log(`  共 ${totalCards} 张卡；单篇最多 ${maxCards} 张；最长小节摘要 ${maxSummary} 字（上限 ${SUMMARY_CAP}）`)

/* ------------------------------------------------------------------ */
/* 导出尺寸：CARD_FORMATS 自己必须自洽                                   */
/* ------------------------------------------------------------------ */
/*
 * 导出成品像素 = w×2 / h×2，全靠这张表。表里写错一个数，导出的比例就是错的，
 * 而且界面上照样显示「已导出 1080×1440」—— 之前 3:4 被导成 4:3 就是这一类：
 * 尺寸没从这张表算，而是让 html-to-image 去量了被撑宽的父节点。
 * 这里把「id 写 3:4 → w/h 必须真是 0.75」「hint 里的像素必须等于 w×2/h×2」钉住。
 */
const FORMAT_RATIO: Record<string, number> = { '3:4': 3 / 4, '1:1': 1, '16:9': 16 / 9 }

for (const f of CARD_FORMATS) {
  const want = FORMAT_RATIO[f.id]
  if (want === undefined) {
    problems.push(`尺寸 ${f.id}: 没有登记期望比例`)
    fail++
    continue
  }
  if (Math.abs(f.w / f.h - want) > 0.002) {
    problems.push(`尺寸 ${f.id}: ${f.w}×${f.h} 的比例是 ${(f.w / f.h).toFixed(3)}，应为 ${want.toFixed(3)}`)
    fail++
  }
  // hint 里写的成品像素必须和 w×2 / h×2 一致，否则用户看到的说明是假的
  const nums = (f.hint.match(/\d+/g) ?? []).map(Number)
  if (nums.length >= 2 && (nums[0] !== f.w * 2 || nums[1] !== f.h * 2)) {
    problems.push(`尺寸 ${f.id}: 说明写 ${nums[0]}×${nums[1]}，实际导出 ${f.w * 2}×${f.h * 2}`)
    fail++
  }
}
if (fail === 0) console.log(`  ${CARD_FORMATS.length} 个导出尺寸：比例与说明文字都对得上`)

if (nameSamples.length) {
  console.log('  文件名示例：')
  for (const n of nameSamples) console.log(`    ${n}.png`)
}

if (fail === 0) {
  console.log('✓ 配图层全部通过')
} else {
  console.log(`✗ ${fail} 处问题：`)
  for (const p of problems.slice(0, 40)) console.log(`  · ${p}`)
  process.exitCode = 1
}
