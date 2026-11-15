/**
 * 回归脚本的公共断言助手
 *
 * 原来这 9 个脚本各抄一份 ok()，语义还不完全一致：有的收 `(cond, msg)`，
 * 有的收 `(msg)`；失败计数器一个叫 `failed`、一个叫 `failures`；
 * 收尾有的打印「× 项失败」，有的直接 process.exit。
 * 新增一个检查时，要么再抄一遍，要么先读三个文件确认该照哪个写。
 *
 * 现在统一到这里。每个脚本是独立进程（scripts/run-checks.ts 负责调度），
 * 所以模块级的计数器天然是「每次运行一份」，不会串。
 */

let passed = 0
let failed = 0

/** 条件断言。返回 cond，方便 `if (!ok(...)) continue` */
export function ok(cond: boolean, message: string): boolean {
  if (cond) {
    passed++
    console.log(`  ✓ ${message}`)
  } else {
    failed++
    console.log(`  ✗ ${message}`)
  }
  return cond
}

/** 断言已经成立、只是想把结果打出来（例如循环里逐条确认过的项） */
export function pass(message: string): void {
  passed++
  console.log(`  ✓ ${message}`)
}

/** 直接记一次失败（不写条件时用，比如 catch 分支） */
export function fail(message: string): void {
  failed++
  console.log(`  ✗ ${message}`)
}

/** 手动把已经统计过的失败数并进来（有些脚本自己算 crash/leak 计数） */
export function addFailures(n: number): void {
  failed += n
}

export function failureCount(): number {
  return failed
}

/**
 * 收尾：全过打一句「✓ X全部通过」；有失败打「✗ X：N 项失败」。
 * 返回退出码，调用方 `process.exit(report('台账层'))` 即可。
 */
export function report(label: string): number {
  if (failed > 0) {
    console.log(`\n✗ ${label}：${failed} 项失败`)
    return 1
  }
  console.log(`\n✓ ${label}全部通过`)
  return 0
}
