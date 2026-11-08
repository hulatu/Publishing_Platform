/**
 * 公众号文末组件回归
 *
 * 两条主线：
 * 1. 断言 —— 转义、占位符、全关时不改变产物、标签配平、纯文本通道带文末
 * 2. 扫描 —— 109 篇真实文章套上默认配置后，字数还在 20000 以内吗，
 *    有没有哪篇本来就在临界值上、加了尾部直接超限
 *
 * 第 2 条是重点：文末这三块是「每篇都加」的东西，一旦它把某篇从 19900 顶到 20200，
 * 用户就会在发布那一刻才发现，代价比在这里发现大得多。
 *
 * 注意按**字数**比，不按 HTML 字符数 —— 微信编辑器算的是字数。
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { POSTS } from './posts-dir'
import { parseArticle } from '../src/core/parse'
import { charCount } from '../src/core/cjk'
import { buildTailHtml, defaultTailConfig, applyVars, activeBlocks, type TailConfig } from '../src/core/tail'
import { getWechatTheme, wechatThemes } from '../src/themes/wechat'
import { renderWechat, WECHAT_WORD_LIMIT } from '../src/renderers/wechat'

let failed = 0
function ok(cond: boolean, msg: string) {
  if (cond) console.log(`  ✓ ${msg}`)
  else {
    failed++
    console.log(`  ✗ ${msg}`)
  }
}

const theme = getWechatTheme('paper')
const full: TailConfig = {
  follow: { on: true, title: '关于作者', text: '欢迎关注「{account}」。' },
  history: {
    on: true,
    title: '往期推荐',
    items: [
      { title: '第一篇', url: 'https://example.com/a' },
      { title: '第二篇', url: '' },
    ],
  },
  copyright: { on: true, text: '© {year} {account}' },
}

/* ---------------- 1. 断言 ---------------- */

console.log('文末组件：')

const r1 = buildTailHtml(full, theme, '胡拉图说')
ok(r1.html.includes('胡拉图说'), '{account} 被替换成账号名')
ok(r1.html.includes(String(new Date().getFullYear())), '{year} 被替换成当前年份')
ok(r1.historyCount === 2, `往期推荐统计到 ${r1.historyCount} 条`)
ok(r1.droppedLinks === 1, `带链接的条目统计到 ${r1.droppedLinks} 条`)

const empty = buildTailHtml(full, theme, '')
ok(empty.html.includes('本号'), '账号名为空时退化成「本号」，不会留下半个句子')

// 纯文本通道：公众号复制是 text/html + text/plain 双通道，
// 富文本那条一旦降级成纯文本，少了这份文末就等于「复制丢了后半篇」
ok(r1.text.includes('胡拉图说'), '纯文本通道同样替换了 {account}')
ok(r1.text.includes('第一篇') && r1.text.includes('第二篇'), '纯文本通道包含全部往期条目')
ok(!/[<>]/.test(r1.text), '纯文本通道里没有残留标签')
ok(r1.text.includes('关于作者'), '纯文本通道保留了小标题')

// 转义：用户会在标题里写尖括号和引号
const nasty = buildTailHtml(
  {
    follow: { on: true, title: '<b>x</b>', text: 'a & b < c > d "e"' },
    history: { on: false, title: '', items: [] },
    copyright: { on: false, text: '' },
  },
  theme,
  'x',
)
ok(!nasty.html.includes('<b>x</b>'), '标题里的 HTML 被转义，不会被当标签执行')
ok(nasty.html.includes('&amp;') && nasty.html.includes('&lt;'), '正文里的 & < > 都被转义')

// 全关：产物必须和没配尾部时完全一致
const off: TailConfig = {
  follow: { on: false, title: '', text: '' },
  history: { on: false, title: '', items: [] },
  copyright: { on: false, text: '' },
}
ok(buildTailHtml(off, theme, 'x').html === '', '三块全关时不产出任何字符')
ok(buildTailHtml(off, theme, 'x').text === '', '三块全关时纯文本通道同样不产出字符')
ok(activeBlocks(off) === 0 && activeBlocks(full) === 3, '启用块数统计正确')

// 标签配平
const open = (r1.html.match(/<section/g) ?? []).length
const close = (r1.html.match(/<\/section>/g) ?? []).length
ok(open === close, `<section> 开合配平（${open} / ${close}）`)
ok(!/<style|class=|::before|::after/.test(r1.html), '没有 <style> / class / 伪元素（微信会剥离）')

// 占位符
ok(applyVars('{account}·{year}', 'A') === `A·${new Date().getFullYear()}`, 'applyVars 同时替换两个占位符')

// 主题配色确实跟着主题走
const inks = new Set(wechatThemes.map((t) => buildTailHtml(full, getWechatTheme(t.id), 'x').html.slice(0, 400)))
ok(inks.size > 1, `${wechatThemes.length} 套主题产出 ${inks.size} 种不同配色`)

/* ---------------- 2. 扫描真实文章 ---------------- */

const files = readdirSync(POSTS).filter((f) => f.endsWith('.md') && !f.startsWith('_'))

let overBefore = 0
let overAfter = 0
let nearLimit = 0
const tailChars: number[] = []

for (const file of files) {
  const doc = parseArticle({ source: readFileSync(join(POSTS, file), 'utf8'), fileName: file })

  const before = renderWechat(doc, { wechatThemeId: 'paper', tail: off })
  const after = renderWechat(doc, { wechatThemeId: 'paper', tail: defaultTailConfig, account: '胡拉图说' })

  const b = [...before.primary].length
  const a = [...after.primary].length
  tailChars.push(a - b)

  // 超限按**字数**算（微信编辑器的口径），不按 HTML 字符数
  const bWords = charCount(before.text)
  const aWords = charCount(after.text)
  if (bWords > WECHAT_WORD_LIMIT) overBefore++
  if (aWords > WECHAT_WORD_LIMIT) overAfter++
  if (aWords > WECHAT_WORD_LIMIT * 0.95 && aWords <= WECHAT_WORD_LIMIT) nearLimit++

  // 尾部必须真的拼在最后 —— HTML 和纯文本两条通道都要
  const tail = buildTailHtml(defaultTailConfig, getWechatTheme('paper'), '胡拉图说')
  if (tail.html && !after.primary.endsWith(tail.html)) {
    failed++
    console.log(`  ✗ ${file}：尾部没有拼在 HTML 产物末尾`)
  }
  if (tail.text && !after.text.endsWith(tail.text)) {
    failed++
    console.log(`  ✗ ${file}：尾部没有拼在纯文本产物末尾（降级成纯文本时会丢文末）`)
  }
}

const avgTail = tailChars.reduce((x, y) => x + y, 0) / Math.max(1, tailChars.length)
const maxTail = Math.max(...tailChars)

console.log(`\n扫描 ${files.length} 篇：`)
console.log(`  默认配置增加的 HTML 字符：平均 ${avgTail.toFixed(0)}，最多 ${maxTail}`)
console.log(`  超 20000 字的篇数：不加尾部 ${overBefore} 篇 → 加尾部 ${overAfter} 篇`)
console.log(`  加完落在 19000–20000 字的：${nearLimit} 篇`)

if (overAfter > overBefore) {
  console.log(`\n✗ 有 ${overAfter - overBefore} 篇因为尾部而超限`)
  process.exit(1)
}

if (failed > 0) {
  console.log(`\n✗ ${failed} 项失败`)
  process.exit(1)
}
console.log('\n✓ 文末组件全部通过')
