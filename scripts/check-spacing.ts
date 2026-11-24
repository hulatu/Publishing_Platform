/**
 * 间距阶梯回归：UI 的 margin / padding / gap 只许走 --space-*。
 *
 * 为什么要有这个脚本：
 * 这套样式原先散着 1 / 2 / 3 / 5 / 6 / 7 / 9 / 10 / 11 / 13 / 14 / 15 / 17 / 18 /
 * 22 / 26 / 30 / 34 … 十几个值。相邻两档只差 1px 时，肉眼看不出层级，只看到
 * 「参差」：同一个工具栏里按钮 7px、chip 4px、输入框 9px，谁也说不清谁更重要。
 * 现在统一到 --space-N = N × 4px（另留 --space-0 = 2px 细微档），这条脚本守住它。
 *
 * 检查项：
 * - --space-N 的取值必须等于 N × 4px（--space-0 为 2px），防止 token 本身写歪
 * - --pad-pane / --pad-read 必须引用间距阶梯，不再写成裸像素
 * - 所有 var(--space-*) 引用都必须有定义
 * - CSS 里的 margin / padding / gap 不许出现阶梯外的裸 px
 *   （1px / 2px 例外：发丝线和边框补偿，见 global.css 的 token 注释）
 * - TSX 里不许再写 inline 的 margin / padding / gap（应改用 .mt-* / .mb-* 或组件类）
 *
 * 只扫 px：文章正文的 em 间距（1.4em / 1.6em…）是排版节奏，不属于 UI 间距。
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { ok, report } from './harness'

const CSS_PATH = 'src/styles/global.css'
const css = readFileSync(CSS_PATH, 'utf8')
const bare = css.replace(/\/\*[\s\S]*?\*\//g, '')

const SPACING_PROPS = new Set([
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'gap',
  'row-gap',
  'column-gap',
])

/** 允许保留的裸像素：1px 发丝线，2px 边框宽度补偿 */
const RAW_ALLOWED = new Set(['1px', '2px'])

/* ---------------- token 本身 ---------------- */

console.log('间距阶梯')

const spaceTokens = new Map<string, string>()
for (const m of css.matchAll(/--(space-[\w-]+)\s*:\s*([^;]+);/g)) {
  spaceTokens.set(m[1], m[2].trim())
}

ok(spaceTokens.size >= 9, `至少要定义 --space-0 ~ --space-8，实际 ${spaceTokens.size} 个`)
for (const [name, value] of spaceTokens) {
  const idx = Number(name.slice('space-'.length))
  if (!Number.isFinite(idx)) {
    ok(false, `--${name} 不是 --space-N 形式`)
    continue
  }
  const expected = idx === 0 ? 2 : idx * 4
  ok(value === `${expected}px`, `--${name} 应为 ${expected}px，实际是 ${value}`)
}

ok(
  /--pad-pane:\s*var\(--space-4\)/.test(css),
  '--pad-pane 应引用 var(--space-4)（16px），而不是裸像素',
)
ok(
  /--pad-read:\s*var\(--space-7\)/.test(css),
  '--pad-read 应引用 var(--space-7)（28px），而不是裸像素',
)

const refs = new Set([...css.matchAll(/var\(--(space-[\w-]+)\)/g)].map((m) => m[1]))
const missing = [...refs].filter((name) => !spaceTokens.has(name))
ok(missing.length === 0, missing.length === 0 ? '所有 --space-* 引用都有定义' : `引用了不存在的 token：${missing.join('、')}`)

/* ---------------- CSS 声明 ---------------- */

const violation: string[] = []
let declarationCount = 0
let rawAllowedCount = 0

for (const m of bare.matchAll(/(?<![\w-])([a-z][a-z-]*)\s*:\s*([^;{}]+?)\s*;/g)) {
  const prop = m[1]
  if (!SPACING_PROPS.has(prop)) continue
  declarationCount++
  const value = m[2].trim()
  for (const px of value.matchAll(/-?\d+(?:\.\d+)?px/g)) {
    if (RAW_ALLOWED.has(px[0])) {
      rawAllowedCount++
      continue
    }
    violation.push(`${prop}: ${value}（${px[0]}）`)
  }
}

ok(
  violation.length === 0,
  violation.length === 0
    ? '所有间距声明都在 --space-* 阶梯上'
    : `有 ${violation.length} 处不在阶梯上：${violation.slice(0, 8).join('；')}`,
)
console.log(
  `  共 ${declarationCount} 处 margin / padding / gap，` +
    `${rawAllowedCount} 个 1px/2px 发丝线或边框补偿，其余全部走 token`,
)

/* ---------------- TSX inline 间距 ---------------- */

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(path))
    else if (entry.name.endsWith('.tsx')) out.push(path)
  }
  return out
}

const files = ['src/App.tsx', ...walk('src/components')]
const inlineHits: string[] = []
const INLINE_RE =
  /\b(margin(?:Top|Right|Bottom|Left)?|padding(?:Top|Right|Bottom|Left)?|gap|rowGap|columnGap)\s*:\s*(?:'([^']*)'|"([^"]*)"|(-?\d+(?:\.\d+)?))/g

for (const file of files) {
  const text = readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
  for (const m of text.matchAll(INLINE_RE)) {
    const value = (m[2] ?? m[3] ?? m[4] ?? '').trim()
    if (value === '0') continue
    if (value && !value.includes('px') && !/^\d/.test(value)) continue
    inlineHits.push(`${file}: ${m[1]}: ${value || '（数值）'}`)
  }
}

ok(
  inlineHits.length === 0,
  inlineHits.length === 0
    ? 'TSX 里没有 inline margin / padding / gap'
    : `TSX 还有 ${inlineHits.length} 处 inline 间距：${inlineHits.slice(0, 5).join('；')}`,
)

process.exit(report('间距层'))
