/**
 * 往返自检脚本（开发用）
 *
 * 用法：
 *   node_modules/.bin/esbuild scripts/check-roundtrip.ts --bundle --platform=node \
 *     --format=esm --outfile=.tmp/check-roundtrip.mjs && node .tmp/check-roundtrip.mjs
 *
 * 「往返」指的是 md → IR → md → IR。第二轮的 IR 必须和第一轮等价 ——
 * 不等价就说明解析器或 Markdown 出口有一边把结构/内容搞丢了。
 * 少数派和知乎正是走 Markdown 出口，错了用户在平台上才看得见。
 *
 * 断言三件事：
 * 1. 脚注：引用用作者的 label（`[^1]`）而不是内部序号；没人引用的定义不许丢
 * 2. 行首块级标记（`#` `-` `>` `1.`）必须转义，否则普通文字会被读成标题/列表
 * 3. 全量文章跑一遍往返，结构和文字都得一致
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { POSTS } from './posts-dir'
import { parseArticle, renderPreviewHtml } from '../src/core/parse'
import { toMarkdown } from '../src/core/markdown-out'
import { blocksToText } from '../src/core/ir'
import { renderWechat } from '../src/renderers/wechat'
import type { Block } from '../src/core/ir'

let failures = 0

function fail(msg: string) {
  failures++
  console.log(`  ✗ ${msg}`)
}

function ok(msg: string) {
  console.log(`  ✓ ${msg}`)
}

function check(cond: boolean, msg: string) {
  if (cond) ok(msg)
  else fail(msg)
}

function doc(body: string) {
  return parseArticle({ source: `---\ntitle: 往返测试\n---\n\n${body}\n`, fileName: 'rt.md' })
}

/** 结构指纹：块类型序列，列表/引用/脚注展开一层 */
function shape(blocks: Block[], out: string[] = [], depth = 0): string[] {
  for (const b of blocks) {
    out.push('  '.repeat(depth) + b.t + (b.t === 'heading' ? `:${b.level}` : ''))
    if (b.t === 'list') for (const item of b.items) shape(item, out, depth + 1)
    else if (b.t === 'quote' || b.t === 'fn') shape(b.children, out, depth + 1)
  }
  return out
}

/** 只留汉字：标点、空白、URL 的差异不算内容差异 */
const HAN = /[\u4e00-\u9fa5]/g
const onlyHan = (s: string) => (s.match(HAN) ?? []).join('')

const fnLabels = (blocks: Block[]) =>
  blocks.filter((b) => b.t === 'fn').map((b) => (b as Extract<Block, { t: 'fn' }>).label)

const fnRefs = (blocks: Block[]): string[] => {
  const out: string[] = []
  const scan = (bs: Block[]) => {
    for (const b of bs) {
      if (b.t === 'p' || b.t === 'heading') {
        for (const n of b.inline) if (n.t === 'fnref') out.push(n.label ?? `#${n.id}`)
      } else if (b.t === 'list') b.items.forEach(scan)
      else if (b.t === 'quote' || b.t === 'fn') scan(b.children)
    }
  }
  scan(blocks)
  return out
}

/** 跑一次往返，返回两轮 IR */
function roundtrip(body: string) {
  const d1 = doc(body)
  const md = toMarkdown(d1.blocks).body
  const d2 = doc(md)
  return { d1, d2, md }
}

/* ------------------------------------------------------------------ */
console.log('1. 脚注：引用和定义必须用同一套编号')

{
  const { d1, md } = roundtrip('正文一句[^1]，再来一句[^2]。\n\n[^1]: 定义甲\n[^2]: 定义乙\n')
  check(fnRefs(d1.blocks).join(',') === '1,2', '引用保留作者写的 label（1、2），不是内部序号（0、1）')
  check(fnLabels(d1.blocks).join(',') === '1,2', '定义保留作者写的 label')
  check(md.includes('[^1]') && md.includes('[^1]: 定义甲'), '导出的引用与定义都用 [^1]')
  check(!md.includes('[^0]'), '导出里不出现内部序号 [^0]')

  // 编号非连续 / 非数字的写法同样要成立
  const named = roundtrip('正文[^note]。\n\n[^note]: 说明\n')
  check(named.md.includes('[^note]') && named.md.includes('[^note]: 说明'), '文字型 label（[^note]）也能对上')
  check(fnLabels(named.d1.blocks).length === 1, '文字型 label 的定义没丢')
}

/* ------------------------------------------------------------------ */
console.log('\n2. 脚注：没人引用的定义不许静默消失')

{
  const cases: [string, string][] = [
    ['只有定义、没有引用', '正文一句。\n\n[^1]: 定义一\n'],
    ['定义在 References 标题之后', '正文一句。\n\n## References\n\n[^1]: 定义一\n'],
    ['定义前隔了一条分隔线', '正文一句。\n\n---\n\n[^1]: 定义一\n'],
    ['引用的写法不成立（在代码块里）', '```\n正文[^1]\n```\n\n[^1]: 定义一\n'],
  ]
  for (const [name, body] of cases) {
    const { d1, d2 } = roundtrip(body)
    const kept = fnLabels(d1.blocks).length === 1 && blocksToText(d1.blocks).includes('定义一')
    check(kept, `${name}：定义被保留（以前整块丢失）`)
    check(shape(d1.blocks).join('|') === shape(d2.blocks).join('|'), `${name}：往返结构不变`)
    check(
      d1.warnings.some((w) => w.includes('脚注定义没有对应的引用')),
      `${name}：给出「有定义没引用」的提示`,
    )
  }

  // 部分引用：只提示真正落单的那条
  const partial = roundtrip('正文[^a]。\n\n[^a]: 甲\n[^b]: 乙\n')
  check(fnLabels(partial.d1.blocks).join(',') === 'a,b', '引用一条、落单一条：两条定义都在')
  check(
    partial.d1.warnings.some((w) => w.includes('[^b]') && !w.includes('[^a]')),
    '只提示落单的 [^b]，不误报已引用的 [^a]',
  )
}

/* ------------------------------------------------------------------ */
console.log('\n3. 行首块级标记要转义')

{
  // 一篇讲 Markdown 语法的文章：列表项内容本身就是「# + 空格 + 文字」
  const src = [
    '- `#` 可以表示几级标题',
    '- `-` 可以表示无序列表',
    '- `>` 可以表示引用',
    '- `1.` 可以表示有序列表',
  ].join('\n')
  const { d1, d2, md } = roundtrip(src)
  check(md.includes('- `#` 可以表示几级标题'), '列表项里的 `#` 原样导出，没变成标题')
  check(
    shape(d1.blocks).join('|') === shape(d2.blocks).join('|'),
    '往返结构不变（列表还是列表，没被读成标题/引用）',
  )

  // 段落里以块级标记开头的文字。源文件里作者用 `\#` 转义过，所以 IR 里是纯文字；
  // 导出时必须重新转义，否则第二轮解析就把它读成标题了。
  const markers: [string, string][] = [
    ['\\# 不是标题', '# 不是标题'],
    ['\\- 不是列表', '- 不是列表'],
    ['\\> 不是引用', '> 不是引用'],
    ['1\\. 不是有序列表', '1. 不是有序列表'],
  ]
  for (const [src, text] of markers) {
    const { d1, d2, md } = roundtrip(`${src}\n`)
    const isText = d1.blocks.length === 1 && d1.blocks[0].t === 'p'
    check(isText, `源「${src}」解析成段落（是纯文字，不是块级结构）`)
    check(
      shape(d1.blocks).join('|') === shape(d2.blocks).join('|'),
      `「${text}」导出后仍是段落，没被读成标题/列表/引用`,
    )
    check(!/^[#>+-]|^\d+[.)]/.test(md), `导出行首带转义：${JSON.stringify(md)}`)
  }

  // 段落的第二行以块级标记开头（硬换行之后）
  const brk = roundtrip('第一行  \n\\# 不是标题\n')
  check(
    shape(brk.d1.blocks).join('|') === shape(brk.d2.blocks).join('|'),
    '硬换行后的 `#` 不被当成标题',
  )
}

/* ------------------------------------------------------------------ */
console.log('\n4. 全量文章往返')

{
  const files = readdirSync(POSTS)
    .filter((f) => f.endsWith('.md') && f !== '_index.md')
    .sort()

  const diffs: string[] = []
  for (const file of files) {
    const src = readFileSync(join(POSTS, file), 'utf8')
    const d1 = parseArticle({ source: src, fileName: file })
    const md = toMarkdown(d1.blocks).body
    const d2 = parseArticle({ source: `---\ntitle: t\n---\n\n${md}\n`, fileName: file })

    const textSame = onlyHan(blocksToText(d1.blocks)) === onlyHan(blocksToText(d2.blocks))
    const shapeSame = shape(d1.blocks).join('|') === shape(d2.blocks).join('|')
    if (!textSame || !shapeSame) diffs.push(`${file}（${textSame ? '结构' : '文字'}不一致）`)
  }

  check(files.length > 0, `读到 ${files.length} 篇文章`)
  check(diffs.length === 0, diffs.length === 0 ? '全部往返一致' : `${diffs.length} 篇不一致：${diffs.slice(0, 5).join('；')}`)
}

/* ------------------------------------------------------------------ */
console.log('\n5. 补回定义后，各出口仍然能正常渲染')

{
  // 脚注块是我们在 core 阶段塞回 token 流的，顺手确认三个出口都没被这步搞坏
  const orphanSrc = '正文一句[^a]，再一句。\n\n[^a]: 被引用的定义\n[^b]: 落单的定义\n'
  const preview = renderPreviewHtml(orphanSrc)
  check(preview.includes('被引用的定义'), '预览里渲染出被引用的定义')
  check(preview.includes('落单的定义'), '预览里也渲染出落单的定义（以前预览里同样消失）')

  const d = doc(orphanSrc)
  const wx = renderWechat(d, { wechatThemeId: 'paper' }).html ?? ''
  check(/\[1\][^<]*被引用的定义/.test(wx), '公众号 HTML 里脚注编号与内容对得上')
  check(!wx.includes('落单的定义'), '公众号只列被引用过的脚注（落单的进不了注释区）')
  check(!wx.includes('[^'), '公众号 HTML 里没有残留的 [^a] 字面量')
}

/* ------------------------------------------------------------------ */
console.log(failures === 0 ? '\n往返层全部通过' : `\n${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)
