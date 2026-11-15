/**
 * 回归检查的统一入口
 *
 * 原来是 19 条 npm script，每条都把同一行 esbuild 抄一遍：
 *
 *   "check:parse": "esbuild scripts/check-parse.ts --bundle --platform=node --format=esm
 *                   --outfile=.tmp/check-parse.mjs --log-level=warning && node .tmp/check-parse.mjs"
 *
 * 加一个检查要改两处（自己的 script + 串进 `check` 的链），删一个也要改两处；
 * 而且 `&&` 链在第一个失败处就停 —— 一次只看得到一个错。
 *
 * 现在：检查清单就是下面的 CHECKS 数组。命令行参数按名字过滤：
 *
 *   npm run check              # 全跑
 *   npm run check -- cards     # 只跑名字里带 cards 的
 *   npm run check -- img       # 只跑 imgaudit / imgexport / imgproxy
 *
 * 每个检查仍然是独立的子进程：这些脚本大量使用 process.exit，塞进同一个进程
 * 会互相干扰；隔离之后一个脚本崩了也不会带走其他结果。跑完统一报总账 ——
 * 有 3 个检查坏了，就一次看到 3 个名字。
 */

import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

/** 新增检查只要往这里加一行 */
const CHECKS = [
  'parse',
  'roundtrip',
  'captions',
  'digest',
  'themes',
  'cards',
  'cardstore',
  'ledger',
  'compliance',
  'titles',
  'tail',
  'platforms',
  'drafts',
  'review',
  'network',
  'imgproxy',
  'imgaudit',
  'imgexport',
  'cover',
  'contrast',
] as const

/**
 * 打包产物目录。
 *
 * 只清这个子目录，不动 `.tmp/` 本身：那里还躺着开发时截的图（home.png / mobile.png），
 * 而且这个 runner 自己就是被打包到 `.tmp/run-checks.mjs` 再执行的 —— 删掉整个
 * `.tmp` 等于在跑的时候把自己的文件删了。
 */
const OUT_DIR = '.tmp/checks'

async function main(): Promise<void> {
  const filters = process.argv.slice(2).filter((arg) => !arg.startsWith('-'))
  const selected =
    filters.length === 0 ? [...CHECKS] : CHECKS.filter((name) => filters.some((f) => name.includes(f)))

  if (selected.length === 0) {
    console.error(`没有匹配的检查：${filters.join('、')}`)
    console.error(`可用：${CHECKS.join('、')}`)
    process.exit(1)
  }

  rmSync(OUT_DIR, { recursive: true, force: true })
  mkdirSync(OUT_DIR, { recursive: true })

  // 先一次性全部打包：避免「跑了一半才发现某个脚本编译不过」
  await build({
    entryPoints: selected.map((name) => `scripts/check-${name}.ts`),
    outdir: OUT_DIR,
    outExtension: { '.js': '.mjs' },
    bundle: true,
    platform: 'node',
    format: 'esm',
    logLevel: 'warning',
  })

  const failed: string[] = []
  for (const name of selected) {
    console.log(`\n──────── ${name} ────────`)
    const run = spawnSync(process.execPath, [join(OUT_DIR, `check-${name}.mjs`)], {
      stdio: 'inherit',
    })
    if (run.status !== 0) failed.push(name)
  }

  const passed = selected.length - failed.length
  console.log(`\n════════ ${passed}/${selected.length} 通过 ════════`)
  if (failed.length > 0) {
    console.error(`失败：${failed.join('、')}`)
    process.exit(1)
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
