/**
 * 主题层回归：把每一套主题都真渲染一遍，检查公众号的硬约束。
 *
 * 检查项：
 * - 每套主题都能渲染，不抛异常
 * - 标签里没有 class / id / data-src，也没有 <pre> / <style>
 *   （只看标签内部：正文代码块里出现 `id="x"` 这种字样是正常的，不能算）
 * - 相比基准主题（paper），任何主题的 HTML 字符数涨幅不超过 20%
 *   —— 涨太多说明样式没上提到外层 <section>，长文会被撑爆 20000 上限
 *   编号主题（headingIndex）按标题数给固定豁免：它给每个 H2 多一个编号节点，
 *   这段开销和「样式有没有上提」无关。短文章标题密度高，5 个标题就能把比值
 *   顶过 20%（fixture-html.md 实测 22.3%），不豁免会误报。
 * - 编号主题真的注入了 01/02，非编号主题没有
 * - 12 套主题在同一篇文章上的输出两两不同（防止复制粘贴时漏改）
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { POSTS } from './posts-dir'
import { parseArticle } from '../src/core/parse'
import { renderHtml } from '../src/core/html-inline'
import type { Block } from '../src/core/ir'
import { wechatThemes } from '../src/themes/wechat'

const files = readdirSync(POSTS).filter((f) => f.endsWith('.md') && !f.startsWith('_'))
const docs = files.map((f) => ({
  file: f,
  doc: parseArticle({ source: readFileSync(join(POSTS, f), 'utf8'), fileName: f }),
}))

console.log(`扫描 ${docs.length} 篇 × ${wechatThemes.length} 套主题`)

const problems: string[] = []
const BASELINE = 'paper'
const MAX_GROWTH = 1.2
/**
 * 编号主题每个 H2 多出来的字符数（实测 116，取 130 留余量）。
 * 这个数字不随主题样式变化，纯粹是「01 / 02」那个节点本身的成本，
 * 所以判定「样式开销」时要从增量里扣掉。
 */
const PER_HEADING_ALLOWANCE = 130
let maxLen = 0
let maxWhere = ''

function htmlOf(themeId: string, blocks: Parameters<typeof renderHtml>[0]): string {
  const theme = wechatThemes.find((t) => t.id === themeId)
  if (!theme) throw new Error(`没有主题 ${themeId}`)
  return renderHtml(blocks, { theme, linkMode: 'refs', target: 'wechat' }).html
}

for (const { file, doc } of docs) {
  const base = htmlOf(BASELINE, doc.blocks).length
  const h2Count = doc.blocks.filter((b) => b.t === 'heading' && b.level === 2).length

  for (const theme of wechatThemes) {
    let html: string
    try {
      html = htmlOf(theme.id, doc.blocks)
    } catch (err) {
      problems.push(`${theme.id} / ${file}: 渲染抛异常 ${(err as Error).message}`)
      continue
    }

    // 属性类检查只看标签内部，避免正文里出现的字样误报
    const tags = html.match(/<[^>]+>/g) ?? []
    for (const tag of tags) {
      if (/\sclass=/.test(tag)) problems.push(`${theme.id} / ${file}: 标签含 class`)
      if (/\sid=/.test(tag)) problems.push(`${theme.id} / ${file}: 标签含 id`)
      if (/\sdata-src=/.test(tag)) problems.push(`${theme.id} / ${file}: 标签含 data-src`)
      // style="..." 的值里若有裸双引号，属性会被提前闭合，后面所有声明全部失效。
      // 合法标签在 style 的收尾引号后只能跟空格或 >，这里据此判断。
      if (/style="[^"]*"[^\s>]/.test(tag)) {
        problems.push(`${theme.id} / ${file}: style 属性被引号截断`)
      }
    }
    if (/<pre[\s>]/.test(html)) problems.push(`${theme.id} / ${file}: 输出含 <pre>`)
    if (/<style[\s>]/.test(html)) problems.push(`${theme.id} / ${file}: 输出含 <style>`)

    // 编号主题的编号节点不算「样式开销」，按标题数扣掉再比
    if (base > 0) {
      const allowance = theme.headingIndex ? h2Count * PER_HEADING_ALLOWANCE : 0
      const growth = html.length - base - allowance
      if (growth > base * (MAX_GROWTH - 1)) {
        const pct = Math.round((growth / base) * 100)
        const note = allowance > 0 ? `，已扣除 ${allowance} 字符编号开销` : ''
        problems.push(
          `${theme.id} / ${file}: 比基准多 ${pct}% 字符（${base} → ${html.length}${note}）`,
        )
      }
    }

    if (html.length > maxLen) {
      maxLen = html.length
      maxWhere = `${theme.id} / ${file}`
    }
  }
}

// 编号主题：H2 必须真的带上 01、02
// 用合成样本而不是真实文章：真实文章的小标题常常自己就带「一、」，
// 会被去重逻辑跳过，不适合做断言。
const numbered = wechatThemes.find((t) => t.headingIndex)

function heading(text: string): Block {
  return { t: 'heading', level: 2, raw: text, inline: [{ t: 'text', v: text }] }
}

const PLAIN_HEADS: Block[] = [heading('Why rewrite'), heading('Split in two')]
const CN_HEADS: Block[] = [heading('一、为什么重写'), heading('二、拆成两段')]

if (!numbered) {
  problems.push('没有找到编号主题（headingIndex 未生效）')
} else {
  const html = htmlOf(numbered.id, PLAIN_HEADS)
  if (!/>01</.test(html) || !/>02</.test(html)) {
    problems.push(`编号主题 ${numbered.id} 没有注入 01/02`)
  }

  // 标题自带编号时不能叠加成「02二、」
  const cn = htmlOf(numbered.id, CN_HEADS)
  if (/>01</.test(cn) || />02</.test(cn)) {
    problems.push(`编号主题 ${numbered.id} 对已带编号的标题重复编号`)
  }

  for (const t of wechatThemes.filter((x) => !x.headingIndex)) {
    if (/>01</.test(htmlOf(t.id, PLAIN_HEADS))) {
      problems.push(`非编号主题 ${t.id} 出现了 01 编号`)
    }
  }
}

// 主题之间必须真的不一样
if (docs.length > 0) {
  const target = docs.reduce((a, b) => (b.doc.blocks.length > a.doc.blocks.length ? b : a))
  const seen = new Map<string, string>()
  for (const theme of wechatThemes) {
    const html = htmlOf(theme.id, target.doc.blocks)
    const dup = seen.get(html)
    if (dup) problems.push(`主题 ${theme.id} 与 ${dup} 输出完全相同`)
    else seen.set(html, theme.id)
  }
}

console.log(`最长输出 ${maxLen} 字符（${maxWhere}）`)

if (problems.length > 0) {
  console.log(`\n发现 ${problems.length} 处问题：`)
  for (const p of problems.slice(0, 30)) console.log(`  ✗ ${p}`)
  process.exit(1)
}

console.log('✓ 主题层全部通过')
