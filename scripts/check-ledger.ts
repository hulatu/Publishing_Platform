/** 台账 key 锁定验证：改标题后记录不能丢 */
import {
  articleKeyOf,
  clearArticle,
  markPublished,
  readAllLedgers,
  readLedger,
  setStats,
  setUrl,
  unmark,
} from '../src/core/ledger'

const mem = new Map<string, string>()
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  length: 0,
} as Storage

let failed = 0
function ok(cond: boolean, msg: string) {
  if (cond) console.log(`  ✓ ${msg}`)
  else {
    failed++
    console.log(`  ✗ ${msg}`)
  }
}

const docA = { meta: { slug: 'gym', title: '卖掉了我在宿舍的健身器材' } } as never
const key = articleKeyOf(docA)
ok(key === 'gym', `有 slug 时用 slug 做 key（${key}）`)

// 导入 → 标记已发 → 填链接
markPublished(key, 'wechat')
setUrl(key, 'wechat', 'https://mp.weixin.qq.com/s/abc')
let led = readLedger(key)
ok(!!led.wechat?.at, '标记已发写入时间')
ok(led.wechat?.url === 'https://mp.weixin.qq.com/s/abc', '链接写进去了')

// 用户在编辑器里改了标题 —— key 是导入时锁的，不该变
const renamed = { meta: { slug: 'gym', title: '卖健身器材这件事我想了很久' } } as never
ok(articleKeyOf(renamed) === key, '改标题后 key 不变（slug 在）')

// 重新标记不能冲掉已填的链接
markPublished(key, 'wechat')
ok(readLedger(key).wechat?.url === 'https://mp.weixin.qq.com/s/abc', '重新标记保留原链接')

// 取消标记
unmark(key, 'wechat')
ok(!readLedger(key).wechat, '取消标记删掉记录')

// 没有 slug 时退化成标题
const docB = { meta: { title: '2025 年度总结' } } as never
ok(articleKeyOf(docB) === '2025 年度总结', '没 slug 时用标题')

// 清空单篇
markPublished(key, 'xhs')
clearArticle(key)
ok(Object.keys(readLedger(key)).length === 0, '清空这篇后读不到任何记录')

// 两篇文章互不干扰
markPublished('a', 'wechat')
markPublished('b', 'xhs')
ok(Object.keys(readLedger('a')).join() === 'wechat', 'A 篇只看到自己的记录')
ok(Object.keys(readLedger('b')).join() === 'xhs', 'B 篇只看到自己的记录')

/* ---------------- 数据字段的共存 ---------------- */
// 链接和数据是分开填的（往往先发布、后补数据，或者反过来），
// 任何一个写入路径顺手把另一个抹掉，用户都只会觉得「我填的东西没了」

markPublished('stats', 'wechat')
setUrl('stats', 'wechat', 'https://mp.weixin.qq.com/s/x')
setStats('stats', 'wechat', { read: 1200 })
setStats('stats', 'wechat', { like: 30 })

let rec = readLedger('stats').wechat
ok(rec?.url === 'https://mp.weixin.qq.com/s/x', '填数据不影响已填的链接')
ok(rec?.stats?.read === 1200 && rec?.stats?.like === 30, '分两次填的数字都留住了')

setUrl('stats', 'wechat', 'https://mp.weixin.qq.com/s/y')
ok(readLedger('stats').wechat?.stats?.read === 1200, '改链接不抹掉数据')

markPublished('stats', 'wechat')
rec = readLedger('stats').wechat
ok(rec?.url === 'https://mp.weixin.qq.com/s/y' && rec?.stats?.like === 30, '重新标记同时保住链接与数据')

// 清空某一项：传 undefined 应该把它删掉，而不是留个 0
setStats('stats', 'wechat', { read: undefined })
rec = readLedger('stats').wechat
ok(rec?.stats?.read === undefined, '清空阅读这一项')
ok(rec?.stats?.like === 30, '清空一项不影响其它项')

// 全清空后不留空对象，否则「有没有填过」的判断会变复杂
setStats('stats', 'wechat', { like: undefined })
ok(readLedger('stats').wechat?.stats === undefined, '四项全空时整块删掉，不留 {}')

ok(Object.keys(readAllLedgers()).length >= 2, `readAllLedgers 能拿到全部 ${Object.keys(readAllLedgers()).length} 篇`)

console.log(failed === 0 ? '\n✓ 台账层全部通过' : `\n✗ ${failed} 项失败`)
process.exit(failed === 0 ? 0 : 1)
