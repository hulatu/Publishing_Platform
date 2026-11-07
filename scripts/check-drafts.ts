/**
 * 草稿箱回归
 *
 * 这个模块只在浏览器里跑，node 没有 localStorage —— 所以先塞一个假的。
 * 用假的不只是图方便：真 localStorage 的 5MB 配额和「满了就抛异常」的行为
 * 必须能在这里复现，否则「写满了怎么办」这条分支永远测不到。
 *
 * 重点测三件在浏览器里出错也不报错的事：
 * 1. **prune 有没有真的淘汰最旧的** —— 淘汰错了用户会发现自己昨天的草稿没了
 * 2. **streaming 有没有被清掉** —— 留着它，一份草稿能占几百 KB，攒几篇就把配额吃光
 * 3. **配额满了会不会连累到「正在编辑的这一篇」** —— 淘汰时必须优先牺牲别的，
 *    绝不能把用户当前正在写的那份删掉
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArticle } from '../src/core/parse'
import { splitSections } from '../src/core/sections'
import {
  MAX_DRAFTS,
  clearDrafts,
  deleteDraft,
  draftValue,
  fingerprintOf,
  formatAgo,
  listDrafts,
  readDraft,
  sameDraft,
  sanitizeForStore,
  writeDraft,
  type DraftSnapshot,
} from '../src/core/drafts'
import {
  emptyDigestState,
  emptyMetaLabState,
  emptyPlatformStates,
  emptyAIState,
  type PlatformAIStates,
} from '../src/ai/types'

let failed = 0
function ok(cond: boolean, msg: string) {
  if (cond) console.log(`  ✓ ${msg}`)
  else {
    failed++
    console.log(`  ✗ ${msg}`)
  }
}

/* ---------------- 假的 localStorage ---------------- */

class FakeStorage {
  map = new Map<string, string>()
  /** 剩余可用字节数；null 表示无限 */
  quota: number | null = null
  failNext = 0

  getItem(k: string) {
    return this.map.get(k) ?? null
  }
  setItem(k: string, v: string) {
    if (this.failNext > 0) {
      this.failNext--
      throw new Error('QuotaExceededError')
    }
    if (this.quota !== null) {
      const others = [...this.map].reduce((n, [kk, vv]) => (kk === k ? n : n + vv.length), 0)
      if (others + v.length > this.quota) throw new Error('QuotaExceededError')
    }
    this.map.set(k, v)
  }
  removeItem(k: string) {
    this.map.delete(k)
  }
  clear() {
    this.map.clear()
  }
  get used() {
    return [...this.map.values()].reduce((n, v) => n + v.length, 0)
  }
}

const storage = new FakeStorage()
;(globalThis as unknown as { localStorage: FakeStorage }).localStorage = storage

/* ---------------- 夹具 ---------------- */

// 不能用 import.meta.dirname：esbuild 打包后它指向 .tmp，脚本是从仓库根跑的
const md = readFileSync(join(process.cwd(), 'scripts/fixtures/fixture-short.md'), 'utf8')
const doc = parseArticle({ source: md, fileName: 'fixture-short.md' })
const sectionCount = splitSections(doc).length

function makeSnap(key: string, opts: Partial<DraftSnapshot> = {}): DraftSnapshot {
  return {
    key,
    title: `标题 ${key}`,
    fileName: 'fixture-short.md',
    source: md,
    fingerprint: fingerprintOf(doc, sectionCount),
    meta: doc.meta,
    tone: 'original',
    themeId: 'paper',
    platform: 'wechat',
    digest: emptyDigestState,
    platformStates: emptyPlatformStates(),
    metaLab: emptyMetaLabState,
    updatedAt: new Date().toISOString(),
    ...opts,
  }
}

/* ---------------- 1. 基本读写 ---------------- */

console.log('读写：')

const a = makeSnap('alpha', { updatedAt: '2026-10-01T10:00:00.000Z' })
ok(writeDraft(a), 'writeDraft 返回 true')
const back = readDraft('alpha')
ok(back !== null, 'readDraft 读得回来')
ok(back?.source === md, '原文完整保留（恢复正文要靠它）')
ok(back?.meta.title === doc.meta.title, 'meta 一起存下来了')
ok(readDraft('nope') === null, '读不存在的 key 返回 null')

/* ---------------- 2. 排序 ---------------- */

console.log('\n排序：')

writeDraft(makeSnap('beta', { updatedAt: '2026-10-03T10:00:00.000Z' }))
writeDraft(makeSnap('gamma', { updatedAt: '2026-10-02T10:00:00.000Z' }))
const order = listDrafts().map((d) => d.key)
ok(order[0] === 'beta' && order[1] === 'gamma' && order[2] === 'alpha', `按更新时间倒序（${order.join(' > ')}）`)

/* ---------------- 3. 淘汰 ---------------- */

console.log('\n淘汰：')

storage.clear()
for (let i = 0; i < MAX_DRAFTS + 6; i++) {
  const day = String((i % 28) + 1).padStart(2, '0')
  writeDraft(makeSnap(`k${i}`, { updatedAt: `2026-09-${day}T0${i % 10}:00:00.000Z` }))
}
const kept = listDrafts()
ok(kept.length === MAX_DRAFTS, `写了 ${MAX_DRAFTS + 6} 篇，只剩 ${kept.length} 篇`)
ok(!kept.some((d) => d.key === 'k0'), '最旧的一篇被淘汰')
ok(kept.some((d) => d.key === `k${MAX_DRAFTS + 5}`), '最新的一篇还在')

/* ---------------- 4. 写满时不误伤当前这篇 ---------------- */

console.log('\n配额：')

storage.clear()
// 配额设成大约只够放 3 篇（一篇快照的 JSON 长度按实测取，别硬编码字节数）
const oneSize = JSON.stringify(makeSnap('probe')).length
storage.quota = Math.floor(oneSize * 3.5)
let wrote = 0
for (let i = 0; i < 8; i++) {
  const snap = makeSnap(`q${i}`, { updatedAt: `2026-08-0${i + 1}T00:00:00.000Z` })
  if (writeDraft(snap)) wrote++
}
const afterQuota = listDrafts()
ok(wrote === 8, `配额吃紧时仍然每次都写成功（${wrote}/8）`)
ok(afterQuota.length > 0 && afterQuota.length < 8, `自动淘汰到 ${afterQuota.length} 篇`)
ok(afterQuota[0]?.key === 'q7', '最后写的那篇一定在（优先牺牲旧的）')

// 单篇就超配额：不能死循环，也不能把库写坏
storage.quota = 10
const huge = makeSnap('huge', { source: 'x'.repeat(5000) })
ok(writeDraft(huge) === false, '单篇超配额时返回 false，不抛异常')
storage.quota = null

/* ---------------- 5. 删除 ---------------- */

console.log('\n删除：')

storage.clear()
writeDraft(makeSnap('x1', { updatedAt: '2026-10-01T00:00:00.000Z' }))
writeDraft(makeSnap('x2', { updatedAt: '2026-10-02T00:00:00.000Z' }))
const afterDel = deleteDraft('x1')
ok(afterDel.drafts.length === 1 && afterDel.drafts[0].key === 'x2', 'deleteDraft 只删指定那篇')
ok(afterDel.persisted === true, 'deleteDraft 报告写盘成功')
ok(clearDrafts() === true, 'clearDrafts 返回 true')
ok(listDrafts().length === 0, 'clearDrafts 清空')

/* ---------------- 6. sanitize：流式文本与运行态 ---------------- */

console.log('\n存盘前清理：')

const running: PlatformAIStates = emptyPlatformStates()
running.xiaohongshu = { ...emptyAIState, status: 'running', streaming: 'a'.repeat(4000) }
running.weibo = {
  ...emptyAIState,
  status: 'running',
  streaming: 'b'.repeat(4000),
  result: { weibo: { text: '已经出结果了', topics: [] } },
}

const snap = sanitizeForStore({
  key: 'stream',
  doc,
  source: md,
  fileName: 'f.md',
  tone: 'light',
  themeId: 'ink',
  platform: 'weibo',
  digest: { ...emptyDigestState, status: 'running', streaming: 'c'.repeat(9000) },
  platformStates: running,
  metaLab: emptyMetaLabState,
  sectionCount,
})

ok(snap.digest.streaming === '', '摘要的流式文本被清空')
ok(snap.platformStates.xiaohongshu.streaming === '', '平台流式文本被清空')
ok(snap.platformStates.xiaohongshu.status === 'idle', '跑了一半没结果的 → idle')
ok(snap.platformStates.weibo.status === 'done', '跑了一半但有结果的 → done')
ok(snap.platformStates.weibo.result !== null, '已经出来的结果保住了')
ok(JSON.stringify(snap).length < md.length + 2000, '清理后的快照不会被流式文本撑大')
ok(snap.fingerprint === fingerprintOf(doc, sectionCount), '指纹按当前正文算')

/* ---------------- 7. 指纹 ---------------- */

console.log('\n指纹：')

const fp1 = fingerprintOf(doc, 3)
const fp2 = fingerprintOf(doc, 4)
const longer = parseArticle({ source: `${md}\n\n再补一段正文，字数变了。\n`, fileName: 'f.md' })
const fp3 = fingerprintOf(longer, 3)
ok(fp1 !== fp2, '小节数变了，指纹就变')
ok(fp1 !== fp3, '字数变了，指纹也变')
ok(fingerprintOf(doc, 3) === fp1, '同样的正文与节数，指纹稳定')

/* ---------------- 8. 值不值得留 ---------------- */

console.log('\n价值判断：')

const bare = makeSnap('bare')
const bareValue = draftValue(bare)
ok(bareValue.worth === false, '只有正文和 meta 的草稿不算「有内容」')
ok(bareValue.marks.length === 0, '也就没有标记')

const rich = makeSnap('rich', {
  digest: {
    ...emptyDigestState,
    status: 'done',
    digest: { sections: [{ index: 1, heading: 'x', summary: 'y' }], oneLiner: 'z' },
  },
  metaLab: {
    ...emptyMetaLabState,
    status: 'done',
    result: { titles: [{ text: 't', style: 'statement' }], tags: [] },
  },
})
const richValue = draftValue(rich)
ok(richValue.worth === true, '有 AI 产物的草稿值得留')
ok(richValue.marks.some((m) => m.includes('摘要 1 节')), '标出摘要节数')
ok(richValue.marks.some((m) => m.includes('标题 1 条')), '标出标题条数')

const states = emptyPlatformStates()
states.jike = { ...emptyAIState, result: { jike: { body: 'x' } } }
ok(draftValue(makeSnap('p', { platformStates: states })).marks.some((m) => m.includes('1 个平台')), '标出平台文案数')

/* ---------------- 9. 内容相同判定 ---------------- */

console.log('\n内容相同判定：')

const base = makeSnap('same', { updatedAt: '2026-10-01T10:00:00.000Z' })
ok(sameDraft(null, base) === false, '没有上一版时不算相同')
ok(
  sameDraft(base, makeSnap('same', { updatedAt: '2026-10-09T23:59:00.000Z' })) === true,
  '只有 updatedAt 不同 → 视为相同（打开草稿不该刷新修改时间）',
)
ok(sameDraft(base, makeSnap('same', { tone: 'lively' })) === false, '语气变了 → 要写盘')
ok(sameDraft(base, makeSnap('other')) === false, '换了文章 → 要写盘')
ok(
  sameDraft(base, makeSnap('same', { digest: { ...emptyDigestState, status: 'done' } })) === false,
  '摘要状态变了 → 要写盘',
)

/* ---------------- 10. 相对时间 ---------------- */

console.log('\n时间显示：')

const now = Date.now()
const ago = (ms: number) => new Date(now - ms).toISOString()
ok(formatAgo(ago(10_000)) === '刚刚', '10 秒前 → 刚刚')
ok(formatAgo(ago(5 * 60_000)) === '5 分钟前', '5 分钟前')
ok(formatAgo(ago(3 * 3600_000)) === '3 小时前', '3 小时前')
ok(formatAgo(ago(30 * 3600_000)).startsWith('昨天'), '30 小时前 → 昨天')
ok(formatAgo(ago(3 * 86400_000)) === '3 天前', '3 天前')
ok(/^\d{2}-\d{2}$/.test(formatAgo(ago(20 * 86400_000))), '20 天前 → 月-日')
ok(formatAgo('不是时间') === '', '坏时间返回空串，不显示 NaN')

/* ---------------- 汇总 ---------------- */

if (failed > 0) {
  console.log(`\n✗ ${failed} 项失败`)
  process.exit(1)
}
console.log('\n✓ 草稿箱全部通过')
