/**
 * 公众号直发 · 客户端回归
 *
 * 这块代码在浏览器里几乎不可能手工验证 —— 要验证「IP 不在白名单」得真的有一台
 * 配错白名单的服务器。所以把 fetch 换成假的，把每个分支都走一遍。
 *
 * 重点不是「请求发出去了」，而是**出错时用户看到什么**：
 * 同样是一个失败，翻译成「errcode 40164」和翻译成「把中转服务器的出口 IP 加到
 * 公众号白名单」是两件完全不同的事。
 */

import {
  WECHAT_LIMITS,
  blockedBy,
  explainFailure,
  normalizeRelayUrl,
  pingRelay,
  preflight,
  readRelayConfig,
  relayConfigured,
  sendDraft,
  writeRelayConfig,
  type DraftPayload,
  type RelayConfig,
} from '../src/cloud/wechat-relay'

let failed = 0
function ok(cond: boolean, msg: string) {
  if (cond) console.log(`  ✓ ${msg}`)
  else {
    failed++
    console.log(`  ✗ ${msg}`)
  }
}

/* ---------------- 假的 localStorage 与 fetch ---------------- */

const mem = new Map<string, string>()
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  length: 0,
} as Storage

interface FakeResponse {
  status?: number
  json?: unknown
  throwJson?: boolean
  networkError?: boolean
}

let lastRequest: { url: string; init: RequestInit } | null = null
let queue: FakeResponse[] = []

function installFetch() {
  ;(globalThis as unknown as { fetch: unknown }).fetch = async (url: string, init: RequestInit) => {
    lastRequest = { url, init }
    const r = queue.shift() ?? { status: 500 }
    if (r.networkError) throw new TypeError('Failed to fetch')
    return {
      status: r.status ?? 200,
      json: async () => {
        if (r.throwJson) throw new SyntaxError('Unexpected token <')
        return r.json
      },
    }
  }
}
installFetch()

const CFG: RelayConfig = { url: 'https://relay.example.com/', token: '  secret-token  ' }

const goodPayload: DraftPayload = {
  title: '一篇文章',
  content: '<section style="color:#333">正文</section>',
  digest: '摘要',
  coverUrl: 'https://example.com/cover.jpg',
}

/* ---------------- 1. 配置 ---------------- */

console.log('配置：')

ok(normalizeRelayUrl('https://a.com///') === 'https://a.com', '去掉末尾斜杠')
ok(normalizeRelayUrl('  https://a.com  ') === 'https://a.com', '去掉首尾空格')
ok(relayConfigured({ url: 'https://a.com', token: 'x' }) === true, '地址 + 口令齐了才算配置好')
ok(relayConfigured({ url: 'https://a.com', token: '  ' }) === false, '口令是空白不算')
ok(relayConfigured({ url: 'a.com', token: 'x' }) === false, '地址没协议不算（会被当成相对路径）')
ok(relayConfigured({ url: 'ftp://a.com', token: 'x' }) === false, '非 http(s) 不算')

writeRelayConfig({ url: 'https://a.com', token: 't' })
ok(readRelayConfig().url === 'https://a.com', '配置能读回来')
ok(readRelayConfig().token === 't', '口令能读回来')

mem.set('ad.wechat-relay.v1', '{ 坏掉的 JSON')
ok(readRelayConfig().url === '', '存储坏了不抛异常，退化成空配置')

/* ---------------- 2. 发送前自检 ---------------- */

console.log('\n自检：')

const clean = preflight(goodPayload, CFG)
ok(clean.length === 0, `齐活的请求没有任何问题（${clean.length} 条）`)
ok(blockedBy(clean) === false, '也不阻塞')

ok(
  preflight(goodPayload, { url: '', token: '' }).some((i) => i.level === 'block' && i.text.includes('中转服务')),
  '没配中转 → 阻塞',
)
ok(
  preflight({ ...goodPayload, title: '' }, CFG).some((i) => i.text.includes('标题是空的')),
  '空标题 → 阻塞',
)
ok(
  preflight({ ...goodPayload, title: 'a'.repeat(WECHAT_LIMITS.titleMax + 1) }, CFG).some((i) =>
    i.text.includes('超过微信'),
  ),
  `标题超 ${WECHAT_LIMITS.titleMax} 字 → 阻塞`,
)
ok(
  preflight({ ...goodPayload, title: 'a'.repeat(WECHAT_LIMITS.titleMax) }, CFG).every((i) => !i.text.includes('超过微信')),
  `正好 ${WECHAT_LIMITS.titleMax} 字不算超`,
)
ok(
  preflight({ ...goodPayload, content: '   ' }, CFG).some((i) => i.text.includes('正文是空的')),
  '空正文 → 阻塞',
)

const tooLong = preflight({ ...goodPayload, content: '字'.repeat(WECHAT_LIMITS.contentMax + 5) }, CFG)
ok(tooLong.some((i) => i.level === 'block' && i.text.includes('字符')), '正文超 20000 字符 → 阻塞')
ok(tooLong.some((i) => i.text.includes('超 5')), '告诉用户超了多少字符')

// 1MB 是按字节算的：汉字 3 字节，所以 6000 字左右就会撞上限
const heavy = preflight({ ...goodPayload, content: '字'.repeat(400_000) }, CFG)
ok(heavy.some((i) => i.text.includes('MB')), '正文超 1MB → 阻塞（按字节算）')

ok(
  preflight({ ...goodPayload, digest: '摘'.repeat(WECHAT_LIMITS.digestMax + 1) }, CFG).some(
    (i) => i.level === 'warn' && i.text.includes('截断'),
  ),
  '摘要超 120 字只是警告（微信会截断，不是错误）',
)
ok(
  preflight({ ...goodPayload, coverUrl: '' }, CFG).some((i) => i.level === 'warn' && i.text.includes('封面')),
  '没填封面 → 警告（服务端可能配了默认封面）',
)
ok(
  blockedBy(preflight({ ...goodPayload, coverUrl: '' }, CFG)) === false,
  '封面缺失不阻塞 —— 服务端可能配了默认封面',
)

/* ---------------- 3. errcode 翻译 ---------------- */

console.log('\n错误翻译：')

const e40164 = explainFailure({ upstream: { errcode: 40164, errmsg: 'invalid ip' } })
ok(e40164.code === 'IP_NOT_ALLOWED', 'errcode 40164 → IP 不在白名单')
ok(e40164.hint.includes('白名单'), '给了「去加白名单」的指引')
ok(e40164.detail?.includes('40164'), '原始 errcode 保留在 detail 里')

ok(explainFailure({ upstream: { errcode: 40001 } }).code === 'TOKEN_EXPIRED', '40001 → token 失效')
ok(explainFailure({ upstream: { errcode: 40013 } }).code === 'INVALID_CREDENTIALS', '40013 → AppID 无效')
ok(explainFailure({ upstream: { errcode: 45110 } }).code === 'CONTENT_TOO_LONG', '45110 → 内容超长')
ok(explainFailure({ upstream: { errcode: 53503 } }).code === 'DRAFT_LIMIT', '53503 → 草稿箱满')
ok(explainFailure({ upstream: { errcode: 48001 } }).code === 'UPSTREAM_ERROR', '48001 → 未授权（落到通用错误）')

const unknown = explainFailure({ upstream: { errcode: 99999, errmsg: '???' } })
ok(unknown.code === 'UPSTREAM_ERROR', '不认识的 errcode 不崩，落到通用错误')
ok(unknown.hint.length > 0, '通用错误也给一句指引')

ok(explainFailure({ code: 'THUMB_REQUIRED' }).code === 'THUMB_REQUIRED', '自定义 code 原样识别')
ok(explainFailure({ code: '瞎写的' }).code === 'UPSTREAM_ERROR', '不认识的 code 落到通用错误')
ok(explainFailure({}).title === '微信返回了错误', '什么都没有时给兜底文案')

/* ---------------- 4. 发送 ---------------- */

console.log('\n发送：')

// 成功（我们自己定义的形状）
queue = [{ json: { ok: true, mediaId: 'MID_1', url: 'https://mp.weixin.qq.com/x' } }]
let r = await sendDraft(CFG, goodPayload)
ok(r.ok === true, '成功分支')
ok(r.ok && r.mediaId === 'MID_1', 'mediaId 取到')
ok(r.ok && r.url === 'https://mp.weixin.qq.com/x', '草稿箱链接取到')
ok(lastRequest?.url === 'https://relay.example.com/wechat/draft', `请求打到 /wechat/draft（${lastRequest?.url}）`)
ok(
  (lastRequest?.init.headers as Record<string, string>).Authorization === 'Bearer secret-token',
  '口令去掉首尾空格后放进 Authorization',
)
ok(
  JSON.parse(String(lastRequest?.init.body)).title === '一篇文章',
  'body 是 JSON 且带上了标题',
)

// 成功（微信原样转发的形状）
queue = [{ json: { errcode: 0, media_id: 'MID_2' } }]
r = await sendDraft(CFG, goodPayload)
ok(r.ok === true && r.mediaId === 'MID_2', '微信原样转发的 media_id 也认')

// 微信 errcode 失败
queue = [{ status: 400, json: { ok: false, code: 'UPSTREAM_ERROR', message: 'x', upstream: { errcode: 40164 } } }]
r = await sendDraft(CFG, goodPayload)
ok(r.ok === false && r.code === 'IP_NOT_ALLOWED', '失败时按 upstream.errcode 翻译')

// 顶层 errcode（没有 upstream 包一层）
queue = [{ status: 400, json: { errcode: 45009, errmsg: 'api freq out of limit' } }]
r = await sendDraft(CFG, goodPayload)
ok(r.ok === false && r.code === 'RATE_LIMITED', '顶层 errcode 也能翻译')

// 401
queue = [{ status: 401, json: {} }]
r = await sendDraft(CFG, goodPayload)
ok(r.ok === false && r.code === 'UNAUTHORIZED', '401 → 口令不对')

// 返回 HTML（地址填成了网页）
queue = [{ status: 200, throwJson: true }]
r = await sendDraft(CFG, goodPayload)
ok(r.ok === false && r.code === 'BAD_RESPONSE', '响应不是 JSON → BAD_RESPONSE')

// 网络错误
queue = [{ networkError: true }]
r = await sendDraft(CFG, goodPayload)
ok(r.ok === false && r.code === 'NETWORK', '网络错误 → NETWORK')

// 没配置就发
r = await sendDraft({ url: '', token: '' }, goodPayload)
ok(r.ok === false && r.code === 'NOT_CONFIGURED', '没配置时本地就拦住了，不发请求')

/* ---------------- 5. 测试连接 ---------------- */

console.log('\n测试连接：')

queue = [{ json: { ok: true, appIdMasked: 'wx12****cdef', hasDefaultCover: true } }]
const p1 = await pingRelay(CFG)
ok(p1.ok === true && p1.appIdMasked === 'wx12****cdef', '健康检查读得到 AppID')
ok(p1.ok === true && p1.hasDefaultCover === true, '读得到是否配了默认封面')
ok(lastRequest?.url === 'https://relay.example.com/health', '请求打到 /health')

queue = [{ status: 401, json: {} }]
const p2 = await pingRelay(CFG)
ok(p2.ok === false && p2.code === 'UNAUTHORIZED', '健康检查也会报口令错')

queue = [{ networkError: true }]
const p3 = await pingRelay(CFG)
ok(p3.ok === false && p3.code === 'NETWORK', '健康检查网络错误')

const p4 = await pingRelay({ url: '', token: '' })
ok(p4.ok === false && p4.code === 'NOT_CONFIGURED', '没配置时不发请求')

/* ---------------- 汇总 ---------------- */

if (failed > 0) {
  console.log(`\n✗ ${failed} 项失败`)
  process.exit(1)
}
console.log('\n✓ 直发客户端全部通过')
