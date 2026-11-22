/**
 * 构建体积预算
 *
 * 必须在 `npm run build` 之后跑。它不参与 `npm run check:fixtures`，
 * 因为那组检查不需要 dist，CI 里放在构建步骤之后单独执行。
 *
 * 预算按 gzip 算（Cloudflare 输出 Brotli，gzip 是更保守的近似）：
 * - 首屏：入口 + React + CSS ≤ 180 KB
 * - 任一懒加载 chunk ≤ 60 KB
 * - dist/assets 下 JS+CSS 总量 ≤ 512 KB
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { gzipSync } from 'node:zlib'

const DIST = 'dist'
const ASSETS = join(DIST, 'assets')
const KB = 1024
const BUDGET = {
  initial: 180 * KB,
  chunk: 60 * KB,
  total: 512 * KB,
}

function gzipSize(file: string): number {
  return gzipSync(readFileSync(file), { level: 9 }).length
}

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    const stat = statSync(path)
    if (stat.isDirectory()) out.push(...walk(path))
    else out.push(path)
  }
  return out
}

let html: string
try {
  html = readFileSync(join(DIST, 'index.html'), 'utf8')
} catch {
  console.error('找不到 dist/index.html：先运行 npm run build，再跑 npm run check:bundle')
  process.exit(1)
}

/** index.html 里的 script / modulepreload / stylesheet 就是首屏要下载的资源 */
const initial = [...html.matchAll(/(?:src|href)="(?:\.\/|\/)?(assets\/[^"]+\.(?:js|css))"/g)].map(
  (m) => join(DIST, m[1]),
)

const files = walk(ASSETS).filter((f) => /\.(js|css)$/.test(f))
const sizes = new Map(files.map((file) => [file, gzipSize(file)]))

const initialSize = initial.reduce((sum, file) => sum + (sizes.get(file) ?? 0), 0)
const totalSize = [...sizes.values()].reduce((sum, n) => sum + n, 0)
const lazy = files
  .filter((file) => !initial.includes(file))
  .map((file) => ({ file, size: sizes.get(file) ?? 0 }))
  .sort((a, b) => b.size - a.size)

console.log('首屏资源')
for (const file of initial) {
  console.log(`  ${relative(DIST, file).padEnd(42)} ${((sizes.get(file) ?? 0) / KB).toFixed(1).padStart(6)} KB gzip`)
}
console.log(`  合计 ${(initialSize / KB).toFixed(1)} KB gzip（预算 ${BUDGET.initial / KB} KB）`)

console.log('\n最大的懒加载 chunk')
for (const item of lazy.slice(0, 8)) {
  console.log(`  ${relative(DIST, item.file).padEnd(42)} ${(item.size / KB).toFixed(1).padStart(6)} KB gzip`)
}

const failures: string[] = []
if (initialSize > BUDGET.initial) {
  failures.push(`首屏 ${(initialSize / KB).toFixed(1)} KB > ${BUDGET.initial / KB} KB`)
}
for (const item of lazy) {
  if (item.size > BUDGET.chunk) {
    failures.push(`${relative(DIST, item.file)} ${(item.size / KB).toFixed(1)} KB > ${BUDGET.chunk / KB} KB`)
  }
}
if (totalSize > BUDGET.total) {
  failures.push(`JS+CSS 总量 ${(totalSize / KB).toFixed(1)} KB > ${BUDGET.total / KB} KB`)
}

console.log(`\nJS+CSS 总量 ${(totalSize / KB).toFixed(1)} KB gzip（预算 ${BUDGET.total / KB} KB）`)

if (failures.length > 0) {
  console.error('\n体积预算失败：')
  for (const failure of failures) console.error(`  ✗ ${failure}`)
  process.exit(1)
}

console.log('✓ 体积预算通过')
