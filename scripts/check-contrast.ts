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
 * - 两套主题里，7 个文字色 × 9 个底色共 126 组，全部 ≥ 4.5:1（AA 正文标准）
 * - 实心底上的字（--on-ink / --on-accent / --on-status）≥ 4.5:1
 * - toast 是半透明底，先合成到 --panel 上再算
 * - 预览区的六个块必须共用 --read-w，不许再出现三个宽度
 * - 字号只许走 --fs-* 阶梯（8 档），且相邻两档至少差 1px
 * - 圆角只许走 --radius* 阶梯，外加 1px / 2px 发丝线和 50% 正圆
 * - 同一个选择器不许写两遍（后一份会静默盖掉前一份）
 *
 * 阈值取 4.5 而不是 3：这些 token 没有一个是「24px 以上的大字号」，
 * AA 对大字的 3:1 放宽用不上。
 */

import { readFileSync } from 'node:fs'

const CSS_PATH = 'src/styles/global.css'
const css = readFileSync(CSS_PATH, 'utf8')

/** 去掉注释再扫声明值 —— 注释里提到「字号 12」之类的话不该被当成声明 */
const bare = css.replace(/\/\*[\s\S]*?\*\//g, '')

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
/**
 * 底色清单。除了六个页面/面板底，还有三档「状态柔和底」——
 * 提示条（notice）就是拿它们当背景、把正文色压在上面写的，
 * 而这三档以前没人量过：`--ok-soft` 是这一轮新加的「查完没事」结论条，
 * 加进去之前它只是「看着浅」，加进去之后才有数。
 */
const SURFACES = [
  'bg',
  'sidebar-bg',
  'main-bg',
  'panel',
  'panel-soft',
  'panel-inset',
  'ok-soft',
  'warn-soft',
  'error-soft',
]
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
 * 提示条、折叠清单、源码卡片、富文本预览、Markdown 预览、改写/配图面板，原先分别是
 * 780 / 780 / 780 / 720 / 760 / 820 —— 同一列里三个宽度，往下滚时左右边缘一跳一跳的。
 * 现在统一吃 --read-w，这里守住它。
 */
const READ_COLUMN = [
  '.notice-holder',
  '.details',
  '.source-card',
  '.rich-preview',
  '.md-preview-wrap',
  '.panel-card',
]

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

/* ---------------- 字号阶梯不许再散开 ---------------- */

/**
 * 曾经散着 18 个值：9 / 9.5 / 10 / 10.5 / 11 / 11.5 / 12 / 12.5 / 13 全挤在 4px 里。
 * 半像素的差别看不出层级，只让人看到参差。现在只允许走 --fs-* 阶梯，
 * 唯一的例外是 8px —— 那是折叠箭头 ▶ 的字形尺寸，属于图标不属于字号。
 */
const FS_SCALE: Record<string, number> = {
  'fs-2xs': 10.5,
  'fs-xs': 11.5,
  'fs-sm': 12.5,
  'fs-md': 14,
  'fs-lg': 16,
  'fs-xl': 18,
  'fs-2xl': 20,
  'fs-3xl': 26,
}
const FS_ALLOWED_RAW = new Set(['8px', 'inherit', '0.82em', '0.87em'])

console.log('\n字号阶梯')
for (const [name, px] of Object.entries(FS_SCALE)) {
  const raw = light.get(name)
  must(raw === `${px}px`, `--${name} 应为 ${px}px，实际是 ${raw ?? '（缺失）'}`)
  if (name !== 'fs-2xs') {
    const prev = Object.keys(FS_SCALE)
    const i = prev.indexOf(name)
    const before = FS_SCALE[prev[i - 1]]
    must(px - before >= 1, `--${name}(${px}) 与上一档 ${before} 只差 ${px - before}px，层级读不出来`)
  }
  console.log(`  --${name.padEnd(7)} ${String(px).padStart(5)}px`)
}

const fsValues = [...bare.matchAll(/font-size:\s*([^;]+);/g)].map((m) => m[1].trim())
const strayFs = [...new Set(fsValues.filter((v) => !v.startsWith('var(--fs-') && !FS_ALLOWED_RAW.has(v)))]
must(strayFs.length === 0, `有字号没走 --fs-* 阶梯：${strayFs.join('、')}`)
console.log(`  共 ${fsValues.length} 处 font-size，${strayFs.length === 0 ? '全部在阶梯上' : `越界 ${strayFs.join('、')}`}`)

/* ---------------- 圆角阶梯 ---------------- */

/**
 * 原先有 1/2/3/4/5/6/7/8/10/20/999 十一种写法，光侧栏里就并排放着
 * 3px（角标）、4px（文件类型）、5px（分组标题）、6px（折叠行）、7px（字母块）。
 * 现在只允许 --radius*、胶囊、正圆，以及 1px / 2px 这两个「不是圆角」的发丝线和指示条。
 */
const RADIUS_ALLOWED_RAW = new Set(['1px', '2px', '50%'])

console.log('\n圆角阶梯')
const radiusValues = [...bare.matchAll(/border-radius:\s*([^;]+);/g)].map((m) => m[1].trim())
const strayRadius = [
  ...new Set(radiusValues.filter((v) => !v.startsWith('var(--radius') && !RADIUS_ALLOWED_RAW.has(v))),
]
must(strayRadius.length === 0, `有圆角没走 --radius* 阶梯：${strayRadius.join('、')}`)
for (const name of ['radius-xs', 'radius-sm', 'radius', 'radius-lg', 'radius-xl', 'radius-pill']) {
  must(light.has(name), `缺少圆角 token --${name}`)
}
console.log(
  `  共 ${radiusValues.length} 处 border-radius，${strayRadius.length === 0 ? '全部在阶梯上' : `越界 ${strayRadius.join('、')}`}`,
)

/* ---------------- 同一选择器不许写两遍 ---------------- */

/**
 * .check-row 在文件里出现过两次（gap 8px 一份、gap 7px 一份，隔了 660 行），
 * 后一份整条盖掉前一份 —— 「8px」这个值从来没生效过，而 12px 的 margin-top
 * 对每个调用方都生效。CSS 不会报错，构建也不会警告，只能靠这条断言。
 *
 * 只看顶格写的规则：媒体查询里的覆盖是有意为之，不算重复。
 * 选择器可能折成多行（.md-preview h1, / h2, / h3, / h4 {），
 * 所以要一路攒到带 { 的那一行为止，再把逗号分组排序，避免
 * 「分组写法」和「单条写法」被当成两个不同的选择器。
 */
console.log('\n重复选择器')

const ruleKeys: string[] = []
let pending: string[] | null = null

for (const raw of bare.split('\n')) {
  const ln = raw.trim()
  if (!ln) {
    pending = null
    continue
  }
  // 有缩进 = 在 @media / @supports 里，属于有意覆盖
  if (/^\s/.test(raw)) continue
  if (ln.startsWith('@')) {
    pending = null
    continue
  }
  pending = pending ? [...pending, ln] : [ln]
  if (!ln.endsWith('{')) continue

  const sel = pending.join(' ').replace(/\s*\{$/, '')
  pending = null
  const key = sel
    .split(',')
    .map((s) => s.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .sort()
    .join(', ')
  if (key) ruleKeys.push(key)
}

const counts = new Map<string, number>()
for (const k of ruleKeys) counts.set(k, (counts.get(k) ?? 0) + 1)
const dupes = [...counts].filter(([, n]) => n > 1).map(([k]) => k)

must(dupes.length === 0, `有选择器写了两遍：${dupes.join(' / ')}`)
console.log(`  ${ruleKeys.length} 条顶层规则，${dupes.length === 0 ? '无重复' : `重复 ${dupes.join(' / ')}`}`)

/* ---------------- 收尾 ---------------- */

console.log('')
if (failed > 0) {
  console.log(`对比度检查 ${failed} 项失败：`)
  for (const p of problems.slice(0, 20)) console.log(`  ✗ ${p}`)
  process.exit(1)
}

console.log(`对比度全部通过（阈值 ${MIN}:1，两套主题共 ${TEXTS.length * SURFACES.length * 2} 组）`)
