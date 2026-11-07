/**
 * 复盘聚合回归
 *
 * 这块全是算术，出错的方式很具体：多算一个平台、把没填的当成 0、
 * 互动率的分母取错。而且错了不会报错，只会让人得出「小红书不值得发」这种结论。
 *
 * 重点测三件：
 * 1. **阅读为 0 时互动率是 null 而不是 0** —— 两者在界面上显示为「—」和「0.0%」，
 *    结论完全相反（「还没数据」vs「发了没人理」）
 * 2. **没填数字的平台不参与聚合** —— 否则「已发 11 个平台、填了 3 个」会把总阅读算成 3 个
 * 3. **格式化的取舍** —— 一万折成万、极小的比率不能显示成 0.0%
 */

import {
  formatNum,
  formatRate,
  hasStats,
  interactionsOf,
  rateOf,
  summarizeAll,
  summarizeArticle,
} from '../src/core/review'
import { parseNum } from '../src/core/num'
import type { ArticleLedger } from '../src/core/ledger'

let failed = 0
function ok(cond: boolean, msg: string) {
  if (cond) console.log(`  ✓ ${msg}`)
  else {
    failed++
    console.log(`  ✗ ${msg}`)
  }
}

/* ---------------- 1. 单平台算术 ---------------- */

console.log('单平台：')

ok(interactionsOf({ like: 1, comment: 2, fav: 3 }) === 6, '互动 = 点赞 + 评论 + 收藏')
ok(interactionsOf({ read: 100 }) === 0, '只有阅读没有互动时互动为 0')
ok(interactionsOf(undefined) === 0, '没有数据时互动为 0')
ok(interactionsOf({ like: 5 }) === 5, '缺字段按 0 算，不是 NaN')

ok(rateOf({ read: 1000, like: 30 }) === 0.03, '互动率 = 30 / 1000')
ok(rateOf({ read: 0, like: 30 }) === null, '阅读为 0 时返回 null（不是 0，也不是 Infinity）')
ok(rateOf({ like: 30 }) === null, '没填阅读时返回 null')
ok(rateOf({ read: 0 }) === null, '阅读为 0、也没有互动时仍是 null')
ok(rateOf({ read: -5, like: 1 }) === null, '负数阅读按没填处理，不产生负比率')

ok(hasStats({ read: 0 }) === true, '填了 0 也算填过')
ok(hasStats({}) === false, '空对象不算填过')
ok(hasStats(undefined) === false, 'undefined 不算填过')

/* ---------------- 2. 单篇聚合 ---------------- */

console.log('\n单篇：')

const ledger: ArticleLedger = {
  wechat: { at: '2026-10-01T00:00:00Z', stats: { read: 3820, like: 96, comment: 21, fav: 148 } },
  zhihu: { at: '2026-10-01T00:00:00Z', stats: { read: 12600, like: 210, comment: 64 } },
  xiaohongshu: { at: '2026-10-01T00:00:00Z', stats: { read: 8700, like: 640, comment: 88, fav: 410 } },
  douban: { at: '2026-10-01T00:00:00Z' },
  jike: { at: '2026-10-01T00:00:00Z', stats: { read: 0, like: 3 } },
}

const s = summarizeArticle('k', ledger, '一篇文章')
ok(s.title === '一篇文章', '标题用传入的')
ok(s.published === 5, `已发布 ${s.published} 个平台`)
ok(s.filled === 4, `填过数字的 ${s.filled} 个平台（豆瓣没填，jike 填了 0 也算）`)
ok(s.read === 3820 + 12600 + 8700, `总阅读 ${s.read}（不含没填的平台）`)
ok(s.interaction === 265 + 274 + 1138 + 3, `总互动 ${s.interaction}`)
ok(s.top?.platformId === 'zhihu' && s.top.read === 12600, '最高平台取阅读最多的那个')
ok(s.rate !== null && Math.abs(s.rate - s.interaction / s.read) < 1e-12, '全篇互动率按总量算，不是各平台比率求平均')

const noTitle = summarizeArticle('slug-only', ledger)
ok(noTitle.title === 'slug-only', '没有标题时退回 key，不显示空白')

const empty = summarizeArticle('e', { wechat: { at: '2026-10-01T00:00:00Z' } })
ok(empty.filled === 0 && empty.read === 0 && empty.rate === null, '一个都没填时阅读 0、比率为 null')
ok(empty.top === null, '没有数据时最高平台为 null')

/* ---------------- 3. 跨篇汇总 ---------------- */

console.log('\n跨篇：')

const store: Record<string, ArticleLedger> = {
  a: { wechat: { at: 'x', stats: { read: 1000, like: 10 } } },
  b: { zhihu: { at: 'x', stats: { read: 5000, like: 100 } } },
  c: { douban: { at: 'x' } },
  d: {},
}

const all = summarizeAll(store, (k) => ({ a: '甲', b: '乙' })[k as 'a' | 'b'])
ok(all.length === 2, `只保留填过数据的 ${all.length} 篇（c 只标记、d 是空的都排除）`)
ok(all[0].key === 'b' && all[1].key === 'a', '按阅读倒序')
ok(all[0].title === '乙' && all[1].title === '甲', '标题从 titleOf 取')
ok(summarizeAll(store)[0].title === 'b', '没有 titleOf 时退回 key')

// 同阅读时按互动数排，保证顺序稳定
const tie = summarizeAll({
  x: { p: { at: 'x', stats: { read: 100, like: 1 } } },
  y: { p: { at: 'x', stats: { read: 100, like: 9 } } },
})
ok(tie[0].key === 'y', '阅读相同时互动多的排前面')

ok(summarizeAll({}).length === 0, '空台账返回空数组')

/* ---------------- 4. 数字输入 ---------------- */

console.log('\n数字输入：')

ok(parseNum('1234') === 1234, '纯数字原样')
ok(parseNum('1,234') === 1234, '千分位逗号吃掉')
ok(parseNum('1 234') === 1234, '空格吃掉')
ok(parseNum('1.2万') === 12000, '「1.2万」= 12000（以前会被剔成 12）')
ok(parseNum('1.2 万') === 12000, '带空格的「1.2 万」也对')
ok(parseNum('3.5k') === 3500, '「3.5k」= 3500')
ok(parseNum('1.2亿') === 120000000, '「1.2亿」= 1.2 亿')
ok(parseNum('1234.5') === 1235, '小数四舍五入（以前会变成 12345）')
ok(parseNum('1,234.5') === 1235, '千分位 + 小数')
ok(parseNum('1.') === 1, '「1.」是输入中间态，按 1 算')
ok(parseNum('') === undefined, '空串 → undefined（清空这一项）')
ok(parseNum('   ') === undefined, '只有空格也是空')
ok(parseNum('—') === undefined, '破折号不当成 0')
ok(parseNum('abc') === undefined, '纯字母不猜')
ok(parseNum('-5') === undefined, '负数不认（这些量没有负数）')

/* ---------------- 5. 格式化 ---------------- */

console.log('\n格式化：')

ok(formatNum(0) === '0', '0 显示 0')
ok(formatNum(999) === '999', '999 不加分隔符')
ok(formatNum(1234) === '1,234', '四位数带千分位')
ok(formatNum(9999) === '9,999', '9999 还没到万')
ok(formatNum(10000) === '1 万', '一万整不带小数点')
ok(formatNum(12345) === '1.2 万', '12345 → 1.2 万')
ok(formatNum(1250000) === '125 万', '百万级不保留小数')
ok(formatNum(undefined) === '—', 'undefined 显示破折号')
ok(formatNum(NaN) === '—', 'NaN 显示破折号')

ok(formatRate(0.0312) === '3.1%', '3.12% 保留一位')
ok(formatRate(0) === '0.0%', '真的是 0 就显示 0.0%')
ok(formatRate(null) === '—', 'null 显示破折号，不显示 0.0%')
ok(formatRate(0.0004) === '<0.1%', '0.04% 显示 <0.1%，不四舍五入成 0.0%')
ok(formatRate(1) === '100.0%', '100% 正常显示')

/* ---------------- 汇总 ---------------- */

if (failed > 0) {
  console.log(`\n✗ ${failed} 项失败`)
  process.exit(1)
}
console.log('\n✓ 复盘聚合全部通过')
