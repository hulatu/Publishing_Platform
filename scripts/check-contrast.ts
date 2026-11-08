/**
 * 对比度回归：直接把 src/styles/global.css 里的 token 抠出来算 WCAG 对比度。
 *
 * 为什么要有这个脚本：
 * --ink-muted 曾经是 #8f887f —— 在暖纸底上只有 3.05:1、在 --panel-soft 上 3.19:1，
 * 而它扛着 hint、统计条标签、侧栏平台说明这些 10~11.5px 的小字。肉眼只觉得「有点糊」，
 * 说不出差多少，于是就这么一直糊着。改成 #6f6759 后最差 4.66:1。
 * 这种「没人会主动去量」的退化，只能靠脚本守。
 *
 * 检查项：
 * - 两套主题里，7 个文字色 × 6 个底色共 84 组，全部 ≥ 4.5:1（AA 正文标准）
 * - 实心底上的字（--on-ink / --on-accent / --on-status）≥ 4.5:1
 * - toast 是半透明底，先合成到 --panel 上再算
 * - 预览区的五个块必须共用 --read-w，不许再出现三个宽度
 *
 * 阈值取 4.5 而不是 3：这些 token 没有一个是「24px 以上的大字号」，
 * AA 对大字的 3:1 放宽用不上。
 */

import { readFileSync } from 'node:fs'

const CSS_PATH = 'src/styles/global.css'
const css = readFileSync(CSS_PATH, 'utf8')

/* ---------------- 抠出两套 token ---------------- */

function blockAt(from: number): string {
  const open = css.indexOf('{', from)
  if (open < 0) throw new Error('找不到 {')
  let depth = 0
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}') {
      depth--
      if (depth === 0) return css.slice(open + 1, i)
    }
  }
  throw new Error('大括号没配平')
}

const darkAt = css.indexOf('@media (prefers-color-scheme: dark)')
if (darkAt < 0) throw new Error('没找到深色主题的 @media 块')

const lightRoot = css.indexOf(':root')
const darkRoot = css.indexOf(':root', darkAt)
if (lightRoot < 0 || darkRoot < 0) throw new Error('没找到 :root')

function parseTokens(body: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const m of body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) map.set(m[1], m[2].trim())
  return map
}

const light = parseTokens(blockAt(lightRoot))
const dark = parseTokens(blockAt(darkRoot))

/* ---------------- 颜色与对比度 ---------------- */

type RGBA = [number, number, number, number]

function parseColor(raw: string): RGBA | null {
  const v = raw.trim().toLowerCase()
  const hex = v.match(/^#([0-9a-f]{3,8})$/)
  if (hex) {
    const h = hex[1]
    const expand = (s: string) => parseInt(s.length === 1 ? s + s : s, 16)
    if (h.length === 3 || h.length === 4) return [expand(h[0]), expand(h[1]), expand(h[2]), 1]
    if (h.length === 6 || h.length === 8) {
      return [expand(h.slice(0, 2)), expand(h.slice(2, 4)), expand(h.slice(4, 6)), h.length === 8 ? expand(h.slice(6, 8)) / 255 : 1]
    }
    return null
  }
  const fn = v.match(/^rgba?\(([^)]+)\)$/)
  if (fn) {
    const parts = fn[1].split(/[,/\s]+/).filter(Boolean).map(Number)
    if (parts.length < 3 || parts.some(Number.isNaN)) return null
    return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1]
  }
  return null
}

/** 把半透明的 fg 叠到不透明的 bg 上 */
function over(fg: RGBA, bg: RGBA): RGBA {
  const a = fg[3]
  return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1]
}

function luminance([r, g, b]: RGBA): number {
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function contrast(a: RGBA, b: RGBA): number {
  const la = luminance(a)
  const lb = luminance(b)
  const hi = Math.max(la, lb)
  const lo = Math.min(la, lb)
  return (hi + 0.05) / (lo + 0.05)
}

/* ---------------- 断言 ---------------- */

const MIN = 4.5
const SURFACES = ['bg', 'sidebar-bg', 'main-bg', 'panel', 'panel-soft', 'panel-inset']
const TEXTS = ['ink', 'ink-soft', 'ink-muted', 'accent', 'ok', 'warn', 'error']

let failed = 0
const problems: string[] = []

function must(cond: boolean, msg: string): void {
  if (!cond) {
    failed++
    problems.push(msg)
  }
}

function token(tokens: Map<string, string>, name: string, where: string): RGBA {
  const raw = tokens.get(name)
  if (!raw) {
    failed++
    problems.push(`${where} 缺少 token --${name}`)
    return [0, 0, 0, 1]
  }
  const c = parseColor(raw)
  if (!c) {
    failed++
    problems.push(`${where} 的 --${name} 不是可解析的颜色：${raw}`)
    return [0, 0, 0, 1]
  }
  return c
}

const themes: [string, Map<string, string>][] = [
  ['浅色', light],
  ['深色', dark],
]

for (const [label, tokens] of themes) {
  console.log(`\n${label}：文字色 × 底色`)
  const surfaces = SURFACES.map((s) => [s, token(tokens, s, label)] as const)

  // 表头
  console.log('  ' + ''.padEnd(11) + SURFACES.map((s) => s.padStart(13)).join(''))

  for (const t of TEXTS) {
    const fg = token(tokens, t, label)
    const cells = surfaces.map(([s, bg]) => {
      const ratio = contrast(over(fg, bg), bg)
      must(ratio >= MIN, `${label} --${t} 在 --${s} 上只有 ${ratio.toFixed(2)}:1（要 ≥ ${MIN}）`)
      return ratio.toFixed(2).padStart(13)
    })
    console.log(`  --${t}`.padEnd(13) + cells.join(''))
  }

  // 实心底上的字
  console.log(`${label}：实心底上的字`)
  const solidPairs: [string, string, string][] = [
    ['on-ink', 'ink', '--ink 底'],
    ['on-accent', 'accent', '--accent 底'],
    ['on-status', 'ok', '--ok 底'],
    ['on-status', 'warn', '--warn 底'],
    ['on-status', 'error', '--error 底'],
  ]
  for (const [fgName, bgName, note] of solidPairs) {
    const fg = token(tokens, fgName, label)
    const bg = token(tokens, bgName, label)
    const ratio = contrast(over(fg, bg), bg)
    must(ratio >= MIN, `${label} --${fgName} 在 --${bgName} 上只有 ${ratio.toFixed(2)}:1（${note}）`)
    console.log(`  --${fgName} / --${bgName}  ${ratio.toFixed(2)}:1`)
  }

  // toast 是半透明底，合成到 --panel 上再算
  const toastBg = token(tokens, 'toast-bg', label)
  const panel = token(tokens, 'panel', label)
  const toastFg = token(tokens, 'toast-fg', label)
  const composed = over(toastBg, panel)
  const toastRatio = contrast(over(toastFg, composed), composed)
  must(toastRatio >= MIN, `${label} --toast-fg 在 --toast-bg 上只有 ${toastRatio.toFixed(2)}:1`)
  console.log(`  --toast-fg / --toast-bg（合成到 --panel）  ${toastRatio.toFixed(2)}:1`)
}

/* ---------------- 预览列必须只有一个宽度 ---------------- */

/**
 * 提示条、折叠清单、源码卡片、富文本预览、Markdown 预览，原先分别是
 * 780 / 780 / 780 / 720 / 760 —— 同一列里三个宽度，往下滚时左右边缘一跳一跳的。
 * 现在统一吃 --read-w，这里守住它。
 */
const READ_COLUMN = ['.notice-holder', '.details', '.source-card', '.rich-preview', '.md-preview-wrap']

console.log('\n预览列宽度')
for (const selector of READ_COLUMN) {
  const at = css.indexOf(`\n${selector} {`)
  must(at >= 0, `找不到规则 ${selector}`)
  if (at < 0) continue
  const body = blockAt(at)
  const ok = /max-width:\s*var\(--read-w\)/.test(body)
  must(ok, `${selector} 没用 var(--read-w)，预览列宽度又会分叉`)
  const hard = body.match(/max-width:\s*(\d+)px/)
  if (hard) problems.push(`${selector} 里还写着硬编码宽度 ${hard[1]}px`)
  console.log(`  ${selector.padEnd(18)} ${ok ? 'var(--read-w)' : '✗ 不是 var(--read-w)'}`)
}

/* ---------------- 收尾 ---------------- */

console.log('')
if (failed > 0) {
  console.log(`对比度检查 ${failed} 项失败：`)
  for (const p of problems.slice(0, 20)) console.log(`  ✗ ${p}`)
  process.exit(1)
}

console.log(`对比度全部通过（阈值 ${MIN}:1，两套主题共 ${TEXTS.length * SURFACES.length * 2} 组）`)
