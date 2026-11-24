/**
 * 白纸预览的对比度回归。
 *
 * .md-preview / .rich-preview / .tail-preview 模拟的是「读者最终看到的浅色文章页」，
 * 深色模式下纸面仍然是白的。纸内所有前景/背景必须按 --paper-* 固定，不能跟着
 * UI 主题翻转 —— 否则会出现「浅色标题压在白纸上」这种近乎不可读的组合。
 *
 * 检查项：
 * - --paper-* 这一组 token 存在
 * - 深色 @media 块没有覆盖任何 --paper-*（纸面在两种主题下是同一套值）
 * - 三个纸面容器都把通用 token 局部映射到了 --paper-*
 * - 纸面文字/背景组合 ≥ 4.5:1
 */

import { readFileSync } from 'node:fs'
import { ok, report } from './harness'

const CSS_PATH = 'src/styles/global.css'
const css = readFileSync(CSS_PATH, 'utf8')
const bare = css.replace(/\/\*[\s\S]*?\*\//g, '')

function blockAt(from: number): string {
  const open = bare.indexOf('{', from)
  if (open < 0) throw new Error('找不到 {')
  let depth = 0
  for (let i = open; i < bare.length; i++) {
    if (bare[i] === '{') depth++
    else if (bare[i] === '}') {
      depth--
      if (depth === 0) return bare.slice(open + 1, i)
    }
  }
  throw new Error('大括号没配平')
}

function parseTokens(body: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const m of body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) map.set(m[1], m[2].trim())
  return map
}

function luminance(hex: string): number {
  const h = hex.trim().replace('#', '')
  if (!/^[0-9a-f]{6}$/i.test(h)) throw new Error(`不是 6 位 hex：${hex}`)
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/* ---------------- token ---------------- */

const rootAt = bare.indexOf(':root')
if (rootAt < 0) throw new Error('找不到 :root')
const light = parseTokens(blockAt(rootAt))

const PAPER_TOKENS = [
  'paper-bg',
  'paper-body',
  'paper-ink',
  'paper-ink-soft',
  'paper-ink-muted',
  'paper-strong',
  'paper-line',
  'paper-line-soft',
  'paper-line-strong',
  'paper-panel-soft',
  'paper-panel-inset',
  'paper-accent',
  'paper-accent-deep',
  'paper-accent-soft',
  'paper-accent-line',
  'paper-code',
  'paper-pre-bg',
  'paper-pre-ink',
]

console.log('白纸预览 token')
const missingTokens = PAPER_TOKENS.filter((name) => !light.has(name))
ok(
  missingTokens.length === 0,
  missingTokens.length === 0
    ? `${PAPER_TOKENS.length} 个 --paper-* 全部存在`
    : `缺少：${missingTokens.map((n) => `--${n}`).join('、')}`,
)

const darkAt = bare.indexOf('@media (prefers-color-scheme: dark)')
if (darkAt < 0) throw new Error('没找到深色主题的 @media 块')
const darkPaper = [...blockAt(darkAt).matchAll(/--(paper-[\w-]+)\s*:/g)].map((m) => m[1])
ok(
  darkPaper.length === 0,
  darkPaper.length === 0
    ? '深色主题未覆盖 --paper-*（纸面统一按浅纸值）'
    : `深色主题不应覆盖纸面色：${darkPaper.join('、')}`,
)

/* ---------------- 三个纸面容器的局部映射 ---------------- */

const paperRule = bare.match(
  /\.md-preview\s*,\s*\.rich-preview\s*,\s*\.tail-preview\s*\{([\s\S]*?)\}/,
)
ok(
  !!paperRule,
  paperRule
    ? '三个纸面容器共用同一条纸面规则'
    : '找不到 .md-preview / .rich-preview / .tail-preview 的共用纸面规则',
)

if (paperRule) {
  const body = paperRule[1]
  const mappings: [string, string][] = [
    ['ink', 'paper-ink'],
    ['ink-soft', 'paper-ink-soft'],
    ['ink-muted', 'paper-ink-muted'],
    ['line', 'paper-line'],
    ['line-soft', 'paper-line-soft'],
    ['line-strong', 'paper-line-strong'],
    ['panel', 'paper-bg'],
    ['panel-soft', 'paper-panel-soft'],
    ['panel-inset', 'paper-panel-inset'],
    ['accent', 'paper-accent'],
    ['accent-deep', 'paper-accent-deep'],
    ['accent-soft', 'paper-accent-soft'],
    ['accent-line', 'paper-accent-line'],
  ]
  const missingMappings = mappings.filter(
    ([app, paper]) => !new RegExp(`--${app}\\s*:\\s*var\\(--${paper}\\)`).test(body),
  )
  ok(
    missingMappings.length === 0,
    missingMappings.length === 0
      ? `${mappings.length} 个通用 token 都映射到了纸面色`
      : `未映射：${missingMappings.map(([app, paper]) => `--${app} → --${paper}`).join('、')}`,
  )
  const hasBg = /background\s*:\s*var\(--paper-bg\)/.test(body)
  const hasColor = /color\s*:\s*var\(--paper-body\)/.test(body)
  ok(hasBg, hasBg ? '纸面背景使用 --paper-bg' : '纸面规则缺少 background: var(--paper-bg)')
  ok(hasColor, hasColor ? '纸面文字使用 --paper-body' : '纸面规则缺少 color: var(--paper-body)')
}

/* ---------------- 对比度 ---------------- */

const pairs: [string, string][] = [
  ['paper-body', 'paper-bg'],
  ['paper-ink', 'paper-bg'],
  ['paper-ink-soft', 'paper-bg'],
  ['paper-ink-muted', 'paper-bg'],
  ['paper-ink-muted', 'paper-panel-soft'],
  ['paper-ink-muted', 'paper-panel-inset'],
  ['paper-strong', 'paper-bg'],
  ['paper-accent', 'paper-bg'],
  ['paper-accent-deep', 'paper-bg'],
  ['paper-accent', 'paper-accent-soft'],
  ['paper-code', 'paper-panel-inset'],
  ['paper-pre-ink', 'paper-pre-bg'],
  ['paper-body', 'paper-panel-soft'],
]

console.log('\n纸面文字对比度')
let worst = Infinity
for (const [fg, bg] of pairs) {
  const a = light.get(fg)
  const b = light.get(bg)
  if (!a || !b) {
    ok(false, `缺少 --${fg} 或 --${bg}`)
    continue
  }
  const r = ratio(a, b)
  worst = Math.min(worst, r)
  ok(r >= 4.5, `--${fg} / --${bg}  ${r.toFixed(2)}:1`)
}
if (Number.isFinite(worst)) {
  console.log(`  最低 ${worst.toFixed(2)}:1；深色主题沿用同一组纸面值`)
}

process.exit(report('白纸预览层'))
