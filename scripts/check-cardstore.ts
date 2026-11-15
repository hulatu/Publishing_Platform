/**
 * 卡片快照回归
 *
 * 这个模块只在浏览器里跑，node 没有 localStorage —— 和草稿箱一样塞一个假的，
 * 并且把配额行为也复现出来：存储写不进去时必须返回 false 让 UI 提醒，
 * 而不是静默假装保存成功。
 *
 * 重点钉四件事：
 * 1. **正文指纹变了就作废旧快照** —— 否则增删小节后，旧的小节卡会套到新正文上；
 * 2. **dirty 跟着快照走** —— 用户改过的卡，过几天回来也不能被新摘要冲掉；
 * 3. **手改坏的存储不许进渲染器** —— 未知版式直接当作没有快照；
 * 4. **配额满时淘汰旧的，别把当前这篇丢出去**。
 */

import { ok, report } from './harness'
import {
  MAX_ENTRIES,
  hashDoc,
  pruneSnapshots,
  readCardSnapshot,
  saveCardSnapshot,
  type CardSnapshot,
} from '../src/cards/store'
import type { CardSpec } from '../src/cards/types'

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
}

const storage = new FakeStorage()
;(globalThis as unknown as { localStorage: FakeStorage }).localStorage = storage

/* ---------------- 夹具 ---------------- */

const HASH = hashDoc('# 标题\n\n正文一段。\n\n## 小节\n\n小节正文。')

function card(id: string, over: Partial<CardSpec> = {}): CardSpec {
  return {
    id,
    layout: 'cover',
    title: `卡片 ${id}`,
    subtitle: '副文字',
    themeId: 'paper',
    ...over,
  }
}

function snap(over: Partial<CardSnapshot> = {}): Omit<CardSnapshot, 'at'> {
  return {
    hash: HASH,
    dirty: true,
    selectedId: 'cover',
    cards: [card('cover')],
    ...over,
  }
}

/* ---------------- 1. 正文指纹 ---------------- */

console.log('正文指纹：')

ok(hashDoc('') === hashDoc(''), '空正文的指纹稳定')
ok(hashDoc('同一段正文') === hashDoc('同一段正文'), '同样的正文得到同样的指纹')
ok(hashDoc('a') !== hashDoc('b'), '不同正文得到不同指纹')
ok(hashDoc('a').endsWith('-1'), '指纹带上正文长度，短文本也不容易撞')
ok(hashDoc('标题 v1') !== hashDoc('标题 v2'), '改一个字就判定为另一版')

/* ---------------- 2. 存取 ---------------- */

console.log('\n存取：')

ok(saveCardSnapshot('article-a', snap()), 'saveCardSnapshot 返回 true')
const back = readCardSnapshot('article-a', HASH)
ok(back !== null, '按同一个 key + 指纹读得回来')
ok(back?.cards.length === 1 && back.cards[0].title === '卡片 cover', '卡片内容完整')
ok(back?.dirty === true, 'dirty 一起存下来了（改过的卡不许被新摘要冲掉）')
ok(back?.selectedId === 'cover', '记住上次选中的那张')
ok(readCardSnapshot('article-a', hashDoc('另一版正文')) === null, '指纹对不上就不返回快照')
ok(readCardSnapshot('nope', HASH) === null, '不存在的文章返回 null')

// 正文结构变了（指纹变）→ 旧快照作废，回退到重新生成
saveCardSnapshot('article-b', snap({ cards: [card('s1', { layout: 'section' })] }))
ok(readCardSnapshot('article-b', hashDoc('新版正文')) === null, '增删小节后旧快照自动作废')

/* ---------------- 3. 防御 ---------------- */

console.log('\n防御：')

storage.setItem('ad.cards.v1', '{"broken":')
ok(readCardSnapshot('broken', HASH) === null, '存储内容坏掉时当作没有快照')
storage.setItem(
  'ad.cards.v1',
  JSON.stringify({ x: { at: 1, hash: HASH, dirty: false, selectedId: 'a', cards: [{ id: 'a', layout: '乱写', title: 'x', themeId: 'paper' }] } }),
)
ok(readCardSnapshot('x', HASH) === null, '未知版式的卡片不进渲染器')
ok(saveCardSnapshot('empty', snap({ cards: [] })) === false, '空卡片不写入')
ok(saveCardSnapshot('', snap()) === false, '没有 articleKey 不写入')

/* ---------------- 4. 淘汰与配额 ---------------- */

console.log('\n淘汰：')

const many: Record<string, CardSnapshot> = {}
for (let i = 0; i < MAX_ENTRIES + 5; i++) {
  many[`a${i}`] = { at: i, hash: HASH, dirty: false, selectedId: 'cover', cards: [card('cover')] }
}
const kept = pruneSnapshots(many)
ok(Object.keys(kept).length === MAX_ENTRIES, `最多留 ${MAX_ENTRIES} 篇`)
ok(!('a0' in kept) && 'a16' in kept, '淘汰最旧的，留下最新的')

storage.clear()
storage.quota = 2000
for (let i = 0; i < MAX_ENTRIES; i++) {
  saveCardSnapshot(`fill-${i}`, snap({ dirty: false }))
}
const okWhenFull = saveCardSnapshot('newest', snap())
ok(okWhenFull === true, '配额紧张时淘汰旧的一半，也要把最新这篇写进去')
ok(readCardSnapshot('newest', HASH) !== null, '最新写入的那篇读得回来')

storage.quota = 50
const tooSmall = saveCardSnapshot('tiny', snap())
ok(tooSmall === false, '实在写不进去时返回 false（UI 才能提醒用户）')

const code = report('卡片快照层')
process.exit(code)
