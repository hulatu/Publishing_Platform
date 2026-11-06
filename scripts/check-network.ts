/**
 * 网络层回归：超时、重试分类、并发、时间格式
 *
 * 这几条错了页面不会报错，只会「转圈很久」或者「明明能重试却直接失败」，
 * 光靠点几下很难发现，所以用假 provider 把每个分支都走一遍。
 */

import type { AIProvider, CompleteResult } from '../src/ai/provider'
import { AITimeoutError, completeWithRetry, describeAIError, isRetryableAIError } from '../src/ai/provider'
import { mapLimit } from '../src/core/async'
import { formatElapsed } from '../src/core/time'

let failed = 0
function ok(cond: boolean, label: string) {
  if (cond) console.log(`  ✓ ${label}`)
  else {
    console.log(`  ✗ ${label}`)
    failed++
  }
}

/* ------------------------------------------------------------------ */
/* 1. 错误分类                                                          */
/* ------------------------------------------------------------------ */

console.log('\n错误分类：')

const withStatus = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status })

ok(isRetryableAIError(new AITimeoutError('first-byte', 45000)), '超时 → 可重试')
ok(isRetryableAIError(withStatus(429)), '429 限流 → 可重试')
ok(isRetryableAIError(withStatus(500)), '500 → 可重试')
ok(isRetryableAIError(withStatus(503)), '503 → 可重试')
ok(!isRetryableAIError(withStatus(401)), '401 Key 错 → 不重试')
ok(!isRetryableAIError(withStatus(402)), '402 余额不足 → 不重试')
ok(!isRetryableAIError(withStatus(404)), '404 模型不存在 → 不重试')
ok(!isRetryableAIError(withStatus(400)), '400 请求错误 → 不重试')
ok(isRetryableAIError(new TypeError('Failed to fetch')), 'fetch 失败 → 可重试')
ok(isRetryableAIError(new TypeError('Load failed')), 'Safari 的 Load failed → 可重试')
ok(!isRetryableAIError(new Error('模型输出不是 JSON')), '业务错误 → 不重试')

/* ------------------------------------------------------------------ */
/* 2. 超时的错误文案                                                     */
/* ------------------------------------------------------------------ */

console.log('\n超时文案：')

const firstByte = describeAIError(new AITimeoutError('first-byte', 45000))
const idle = describeAIError(new AITimeoutError('idle', 30000))
ok(firstByte.includes('45 秒'), '首字节超时说出具体秒数')
ok(firstByte.includes('代理') || firstByte.includes('网关'), '首字节超时提示「可能被缓冲」')
ok(idle.includes('30 秒'), '空闲超时说出具体秒数')
ok(idle.includes('已收到的内容还在'), '空闲超时告诉用户已生成的内容没丢')

/* ------------------------------------------------------------------ */
/* 3. completeWithRetry                                                */
/* ------------------------------------------------------------------ */

function fakeProvider(behaviour: (call: number) => Promise<CompleteResult>): AIProvider & { calls: number } {
  const p = {
    calls: 0,
    id: 'byok' as const,
    label: 'fake',
    available: () => true,
    complete() {
      p.calls++
      return behaviour(p.calls)
    },
  }
  return p as unknown as AIProvider & { calls: number }
}

async function retryTests() {
  console.log('\n自动重试：')

  // 一次成功
  {
    const p = fakeProvider(async () => ({ text: 'ok', truncated: false }))
    const r = await completeWithRetry(p, { system: 's', user: 'u' })
    ok(r.text === 'ok' && p.calls === 1, '一次成功就不重试')
  }

  // 抖两次再成功（真实等待 1.2s + 2.4s）
  {
    let retries = 0
    const p = fakeProvider(async (n) => {
      if (n < 3) throw new TypeError('Failed to fetch')
      return { text: 'third time lucky', truncated: false }
    })
    const r = await completeWithRetry(p, { system: 's', user: 'u' }, () => retries++)
    ok(r.text === 'third time lucky', '抖动两次后成功')
    ok(p.calls === 3, `一共调了 3 次（实际 ${p.calls}）`)
    ok(retries === 2, `onRetry 触发 2 次（实际 ${retries}）`)
  }

  // 401 不重试
  {
    const p = fakeProvider(async () => {
      throw withStatus(401)
    })
    let threw = false
    try {
      await completeWithRetry(p, { system: 's', user: 'u' })
    } catch {
      threw = true
    }
    ok(threw && p.calls === 1, `401 只调 1 次（实际 ${p.calls}）`)
  }

  // 用户取消不重试
  {
    const ctrl = new AbortController()
    const p = fakeProvider(async () => {
      ctrl.abort()
      throw new DOMException('aborted', 'AbortError')
    })
    let threw = false
    try {
      await completeWithRetry(p, { system: 's', user: 'u', signal: ctrl.signal })
    } catch {
      threw = true
    }
    ok(threw && p.calls === 1, `用户取消后不再发请求（实际 ${p.calls} 次）`)
  }

  // 一直失败：3 次后放弃
  {
    const p = fakeProvider(async () => {
      throw withStatus(503)
    })
    let threw = false
    try {
      await completeWithRetry(p, { system: 's', user: 'u' })
    } catch {
      threw = true
    }
    ok(threw && p.calls === 3, `可重试错误最多试 3 次（实际 ${p.calls}）`)
  }

  // 挂住的请求被外部取消：必须能打断，且不能重试
  {
    const ctrl = new AbortController()
    const p = fakeProvider(
      () =>
        new Promise<CompleteResult>((_, reject) => {
          ctrl.signal.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            { once: true },
          )
        }),
    )
    setTimeout(() => ctrl.abort(), 30)
    let threw = false
    try {
      await completeWithRetry(p, { system: 's', user: 'u', signal: ctrl.signal })
    } catch {
      threw = true
    }
    ok(threw && p.calls === 1, `外部取消能打断挂起的请求，且不重试（实际 ${p.calls} 次）`)
  }
}

/* ------------------------------------------------------------------ */
/* 4. mapLimit                                                         */
/* ------------------------------------------------------------------ */

async function limitTests() {
  console.log('\n并发控制：')

  // 结果顺序
  {
    const delays = [80, 10, 10, 10]
    const out = await mapLimit([0, 1, 2, 3], 4, async (n) => {
      await new Promise((r) => setTimeout(r, delays[n]))
      return n * 10
    })
    ok(out.join() === '0,10,20,30', '结果按原顺序返回，不是按完成顺序')
  }

  // 并发上限
  {
    let active = 0
    let peak = 0
    const items = Array.from({ length: 10 }, (_, i) => i)
    await mapLimit(items, 3, async (n) => {
      active++
      peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 15))
      active--
      return n
    })
    ok(peak === 3, `并发峰值正好是 3（实际 ${peak}）`)
  }

  // 空数组
  {
    const out = await mapLimit([], 3, async () => 1)
    ok(out.length === 0, '空数组返回空，不开 worker')
  }

  // limit 大于长度
  {
    let peak = 0
    let active = 0
    await mapLimit([1, 2], 10, async () => {
      active++
      peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 10))
      active--
      return 0
    })
    ok(peak === 2, `只有 2 个任务时不会开 10 个 worker（实际 ${peak}）`)
  }

  // 单个任务抛异常 → 整体 reject，不静默
  {
    let threw = false
    try {
      await mapLimit([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error('boom')
        return n
      })
    } catch {
      threw = true
    }
    ok(threw, '任务抛异常会向上冒，不被吞掉')
  }
}

/* ------------------------------------------------------------------ */
/* 5. 时间格式                                                          */
/* ------------------------------------------------------------------ */

function timeTests() {
  console.log('\n时间格式：')

  ok(formatElapsed(0) === '0s', '0 → 0s')
  ok(formatElapsed(900) === '1s', '0.9s 进位成 1s')
  ok(formatElapsed(12500) === '13s', '12.5s → 13s')
  ok(formatElapsed(59000) === '59s', '59s 还用秒')
  ok(formatElapsed(60000) === '1:00', '满一分钟切成分:秒')
  ok(formatElapsed(83000) === '1:23', '83s → 1:23')
  ok(formatElapsed(-5) === '0s', '负数不显示成 -1s')
}

/* ------------------------------------------------------------------ */

await retryTests()
await limitTests()
timeTests()

console.log(failed === 0 ? '\n✓ 网络层全部通过' : `\n✗ ${failed} 项失败`)
process.exit(failed === 0 ? 0 : 1)
