/**
 * 封面图（Unsplash）自检
 *
 * 这一路最容易错的地方不是 API 调用，而是两件「看起来对、用起来错」的事：
 *
 * 1. **搜索词的推导顺序**。tag 比标题更适合搜图 —— 标题里常有「为什么」「怎么」
 *    这类无法拍摄的词。顺序错了，用户每次打开面板都要手改。
 * 2. **错误分类**。401 / 403 / 429 / 网络中断要做的事完全不同：
 *    换 Key、查后台、等一小时、查代理。合成一句「搜索失败」等于什么都没说。
 *
 * 所以这里把 localStorage 和 fetch 都替换掉，直接验这两个逻辑。
 */

import { cleanCoverQuery, emptyHint, guessCoverQuery, localQueryCandidates, looksChinese } from '../src/core/cover-query'
import { UnsplashError, loadUnsplashKey, saveUnsplashKey, searchCoverPhotos } from '../src/core/unsplash'
import type { Doc } from '../src/core/ir'

let failed = 0
const ok = (msg: string) => console.log(`  ✓ ${msg}`)
const fail = (msg: string) => {
  failed++
  console.log(`  ✘ ${msg}`)
}
const eq = (actual: unknown, expect: unknown, label: string) => {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expect)
  if (a === b) ok(label)
  else fail(`${label}：期望 ${b}，实际 ${a}`)
}

/* ---------------- 假的浏览器环境 ---------------- */

const store = new Map<string, string>()
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
} as Storage

const doc = (title: string, tags: string[], categories: string[] = []): Doc =>
  ({
    meta: { title, tags, categories, summary: '', description: '', extra: {} },
    blocks: [],
    rawMd: '',
    warnings: [],
  }) as Doc

/* ---------------- 搜索词清洗 ---------------- */

console.log('\n搜索词清洗：')
eq(cleanCoverQuery('#开学'), '开学', '去掉开头的 #')
eq(cleanCoverQuery('「研究生」'), '研究生', '去掉「」')
eq(cleanCoverQuery('《小狗钱钱》'), '小狗钱钱', '去掉书名号')
eq(cleanCoverQuery('  a   b  '), 'a b', '压缩连续空格')
eq(cleanCoverQuery('a\nb'), 'a b', '换行变空格（query 里带换行会被代理判 400）')
eq(cleanCoverQuery('x'.repeat(200)).length, 60, '超长截断到 60')
eq(cleanCoverQuery('   '), '', '纯空白变空串')

/* ---------------- 推导顺序 ---------------- */

console.log('\n搜索词推导：')
eq(guessCoverQuery(doc('为什么年轻人开始跑步', ['跑步', '运动'])), '跑步', 'tag 优先于标题')
eq(guessCoverQuery(doc('为什么年轻人开始跑步', [], ['生活'])), '生活', '没有 tag 时用分类')
eq(guessCoverQuery(doc('为什么年轻人开始跑步', [])), '为什么年轻人开始跑步', '都没有才退到标题')
eq(guessCoverQuery(doc('#开学第一课', ['#开学'])), '开学', 'tag 里的 # 也会被清掉')

console.log('\n候选词：')
eq(localQueryCandidates(doc('标题', ['a', 'b', 'c', 'd']), 3), ['a', 'b', 'c'], '最多 3 个')
eq(localQueryCandidates(doc('标题', ['a', 'a', 'b']), 3), ['a', 'b', '标题'], '去重后再补标题')
eq(localQueryCandidates(doc('标题', []), 3), ['标题'], '没有 tag 只有标题')

/* ---------------- 中文判定与空结果提示 ---------------- */

console.log('\n提示文案：')
eq(looksChinese('开学'), true, '中文被识别')
eq(looksChinese('laptop desk'), false, '英文不算中文')
if (emptyHint('开学').includes('英文索引')) ok('中文词提示「图库是英文索引」')
else fail('中文词没给出英文索引的提示')
if (emptyHint('a b c d e f').includes('词太多')) ok('超长词提示精简')
else fail('超长词没提示精简')
if (emptyHint('zzzz').includes('更具体的实物词')) ok('无结果时给具体建议')
else fail('无结果时没给建议')

/* ---------------- Key 存取 ---------------- */

console.log('\nKey 存取：')
eq(loadUnsplashKey(), '', '初始为空')
saveUnsplashKey('  abc123  ')
eq(loadUnsplashKey(), 'abc123', '存进去自动 trim')
saveUnsplashKey('')
eq(loadUnsplashKey(), '', '存空串等于清空')

/* ---------------- 错误分类 ---------------- */

console.log('\n错误分类：')

const realFetch = globalThis.fetch
const mockFetch = (impl: (url: string) => Promise<Response> | Response) => {
  ;(globalThis as unknown as { fetch: typeof fetch }).fetch = ((url: string) =>
    Promise.resolve(impl(String(url)))) as typeof fetch
}

const run = async (expectKind: string, label: string) => {
  try {
    await searchCoverPhotos('laptop', { perPage: 3 })
    fail(`${label}：没有抛错`)
  } catch (e) {
    if (e instanceof UnsplashError && e.kind === expectKind) ok(`${label} → ${expectKind}`)
    else fail(`${label}：期望 kind=${expectKind}，实际 ${e instanceof Error ? e.message : String(e)}`)
  }
}

// 没 key
store.clear()
await run('no-key', '没填 Key')

// 401
saveUnsplashKey('bad-key')
mockFetch(() => new Response('unauthorized', { status: 401 }))
await run('auth', 'HTTP 401')

// 403
mockFetch(() => new Response('forbidden', { status: 403 }))
await run('auth', 'HTTP 403')

// 429
mockFetch(() => new Response('rate limited', { status: 429 }))
await run('rate', 'HTTP 429')

// 网络断了：fetch 直接抛
;(globalThis as unknown as { fetch: typeof fetch }).fetch = (() => {
  throw new TypeError('Failed to fetch')
}) as unknown as typeof fetch
await run('network', 'fetch 抛异常')

/* ---------------- 正常解析 ---------------- */

console.log('\n响应解析：')
saveUnsplashKey('good-key')
mockFetch(
  () =>
    new Response(
      JSON.stringify({
        total: 42,
        total_pages: 14,
        results: [
          {
            id: 'abc',
            width: 4000,
            height: 2667,
            color: '#8c6b4a',
            alt_description: 'a laptop on a desk',
            urls: {
              thumb: 'https://images.unsplash.com/thumb',
              small: 'https://images.unsplash.com/small',
              regular: 'https://images.unsplash.com/regular',
              full: 'https://images.unsplash.com/full',
            },
            links: { html: 'https://unsplash.com/photos/abc', download_location: 'https://api.unsplash.com/photos/abc/download' },
            user: { name: 'Jane', links: { html: 'https://unsplash.com/@jane' } },
          },
          // 缺 download_location 的应该被丢掉：没有它就无法合规地触发下载统计
          { id: 'bad', urls: { small: 'x', regular: 'y' }, links: { html: 'z' } },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json', 'x-ratelimit-remaining': '47' } },
    ),
)

const result = await searchCoverPhotos('laptop', { perPage: 3 })
eq(result.photos.length, 1, '缺 download_location 的条目被过滤掉')
eq(result.total, 42, 'total 透传')
eq(result.remaining, 47, '额度从响应头读出')
eq(result.hasMore, true, '还有下一页')
eq(result.photos[0]?.thumb, 'https://images.unsplash.com/small', '缩略图优先用 small（400px，thumb 只有 200px 会糊）')
if (result.photos[0]?.download.includes('w=2400')) ok('下载地址压到 2400 宽')
else fail(`下载地址没压宽度：${result.photos[0]?.download}`)
if (result.photos[0]?.download.includes('&q=85')) ok('下载地址带质量参数')
else fail('下载地址没带质量参数')

/* ---------------- 收尾 ---------------- */

;(globalThis as unknown as { fetch: typeof fetch }).fetch = realFetch

console.log('')
if (failed === 0) {
  console.log('封面图全部通过')
} else {
  console.log(`封面图有 ${failed} 项失败`)
  process.exit(1)
}
