/**
 * 图床自检
 *
 * 这一路最容易错的不是「调不通 API」——那有报错提示。真正危险的是三件
 * **静默出错**的事：
 *
 * 1. **配错图**。md 里写 `1.jpg`，目录里有两张 `1.jpg`，随手挑一张传上去，
 *    全程无报错，作者直到发出去才发现封面变成了别人的图。
 * 2. **改坏正文**。`images/a.jpg` 这种串可能出现在代码块、说明文字里，
 *    全局替换会把文章改坏，而渲染出来往往还是「看起来正常」。
 * 3. **外链被误伤**。作者本来就在用图床，路径长得像本地路径，一传就多了一份副本。
 *
 * 所以这里把 localStorage 和 fetch 都换成假的，直接验逻辑本身：
 * 分类、归一化、三档匹配、只在图片语法内改写、四种适配器各自发出的请求。
 */

import {
  HostError,
  classifySrc,
  emptyHostConfig,
  fileNameFor,
  getByPath,
  hostReady,
  loadHostConfig,
  missingHint,
  normalizeSrc,
  saveHostConfig,
  testHost,
  uploadImage,
  type HostConfig,
} from '../src/core/image-host'
import { collectAssets, isImageFile, isMarkdownFile, matchAsset, rewriteImageSrc, type AssetFile } from '../src/core/local-assets'

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
const same = (actual: string, expect: string, label: string) => {
  if (actual === expect) ok(label)
  else fail(`${label}\n      期望 ${JSON.stringify(expect)}\n      实际 ${JSON.stringify(actual)}`)
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

const png = (name = 'a.png', body = 'x') => new File([body], name, { type: 'image/png' })

const asset = (path: string, file = png(path.split('/').pop() ?? 'a.png')): AssetFile => ({ path, file })

/* ---------------- 地址分类 ---------------- */

console.log('\n地址分类（决定「动不动它」）：')
eq(classifySrc('https://cdn.x.com/a.jpg'), 'remote', 'https 是外链')
eq(classifySrc('HTTP://cdn.x.com/a.jpg'), 'remote', '大写 HTTP 也认')
eq(classifySrc('//cdn.x.com/a.jpg'), 'remote', '协议相对地址也是外链')
eq(classifySrc('data:image/png;base64,AAAA'), 'data', 'data URI 单独一类')
eq(classifySrc('./images/a.jpg'), 'local', './ 开头是本地')
eq(classifySrc('/images/a.jpg'), 'local', '站点根路径也要上传（到公众号是死链）')
eq(classifySrc('images/a.jpg'), 'local', '裸相对路径是本地')
eq(classifySrc('  images/a.jpg  '), 'local', '两侧空白不影响判断')
eq(classifySrc(''), 'local', '空串归到本地（后面会匹配失败）')

/* ---------------- 归一化 ---------------- */

console.log('\n路径归一化（用来和磁盘文件比对）：')
eq(normalizeSrc('./images/a.jpg'), 'images/a.jpg', '去掉 ./')
eq(normalizeSrc('/images/a.jpg'), 'images/a.jpg', '去掉前导 /')
eq(normalizeSrc('images/a.jpg?v=2#top'), 'images/a.jpg', 'query 和 hash 都丢掉')
eq(normalizeSrc('  images/a.jpg  '), 'images/a.jpg', 'trim')
eq(normalizeSrc('a.jpg'), 'a.jpg', '单文件名原样')

/* ---------------- 三档匹配 ---------------- */

console.log('\n图片匹配（严 → 宽）：')

const pool: AssetFile[] = [
  asset('images/a.jpg'),
  asset('post-1/images/b.png'),
  asset('deep/nested/c.gif'),
  asset('x/dup.jpg'),
  asset('y/dup.jpg'),
]

eq(matchAsset('images/a.jpg', pool)?.path, 'images/a.jpg', '第 1 档：完整路径相等')
eq(matchAsset('images/b.png', pool)?.path, 'post-1/images/b.png', '第 2 档：拖了整个博客目录，路径带前缀')
eq(matchAsset('images/c.gif', pool)?.path, 'deep/nested/c.gif', '第 3 档：只靠文件名唯一匹配')
eq(matchAsset('dup.jpg', pool), null, '撞名时不猜，返回 null（传错图是静默的）')
eq(matchAsset('images/none.jpg', pool), null, '找不到就是 null')
eq(matchAsset('', pool), null, '空路径直接 null')

// 完整路径相等要优先于结尾匹配：两个都命中时不能挑错
const both: AssetFile[] = [asset('images/a.jpg', png('a.jpg', 'RIGHT')), asset('post/images/a.jpg', png('a.jpg', 'WRONG'))]
eq(matchAsset('images/a.jpg', both)?.path, 'images/a.jpg', '精确命中和结尾命中并存时选精确的')

/* ---------------- 只在图片语法内改写 ---------------- */

console.log('\n正文改写（只动图片语法，不碰正文文字）：')

const map1 = new Map([['./images/a.jpg', 'https://cdn.x.com/a.jpg']])
same(
  rewriteImageSrc('![封面](./images/a.jpg "标题")', map1),
  '![封面](https://cdn.x.com/a.jpg "标题")',
  '保留 Markdown 图片的标题',
)
same(
  rewriteImageSrc('![封面](./images/a.jpg)', map1),
  '![封面](https://cdn.x.com/a.jpg)',
  '没有标题也能换',
)
same(
  rewriteImageSrc('<img src="./images/a.jpg" alt="x">', map1),
  '<img src="https://cdn.x.com/a.jpg" alt="x">',
  'HTML img 也能换',
)
same(
  rewriteImageSrc('正文里提到 ./images/a.jpg 这个路径，还有 ![图](./images/a.jpg)', map1),
  '正文里提到 ./images/a.jpg 这个路径，还有 ![图](https://cdn.x.com/a.jpg)',
  '正文里的同名文字不动',
)
same(
  rewriteImageSrc('![a](images/a.jpg.bak)', new Map([['images/a.jpg', 'https://cdn.x.com/a.jpg']])),
  '![a](images/a.jpg.bak)',
  '不改以它开头的别的文件（a.jpg.bak）',
)
same(
  rewriteImageSrc('![a](./images/a.jpg)', new Map([['./images/a.jpg', './images/a.jpg']])),
  '![a](./images/a.jpg)',
  '旧地址等于新地址时跳过',
)
const md = '![a](./images/a.jpg)'
same(rewriteImageSrc(md, new Map()), md, '空映射原样返回')

/* ---------------- 文件名 ---------------- */

console.log('\n文件名：')
eq(fileNameFor(png('a b.png')), 'a-b.png', '空格换成连字符')
eq(fileNameFor(png('photo')), 'photo.png', '没有扩展名时按 MIME 补')
eq(fileNameFor(png('raw'), ), 'raw.png', 'MIME 是 png 就补 png')
eq(fileNameFor(new File(['x'], 'blob', { type: '' })), 'blob.jpg', '类型未知时兜底 jpg')
eq(fileNameFor(png('图 1.PNG')), '图-1.PNG', '中文名和原扩展名都保留')

/* ---------------- 点路径 ---------------- */

console.log('\n响应取值（自定义图床用）：')
eq(getByPath({ data: { url: 'x' } }, 'data.url'), 'x', '两层点路径')
eq(getByPath({ data: { url: 'x' } }, 'data.nope'), undefined, '路径不存在')
eq(getByPath({ data: { url: 'x' } }, 'data.url.deeper'), undefined, '往字符串里继续取是 undefined')
eq(getByPath({ a: 1 }, 'a'), 1, '一层')
eq(getByPath(null, 'a'), undefined, 'null 不炸')

/* ---------------- 配置校验 ---------------- */

console.log('\n配置校验：')
eq(emptyHostConfig.kind, 'imgbb', '默认 imgbb（零部署，填个 Key 就能用）')

const cfgOf = (patch: Partial<HostConfig>): HostConfig => ({ ...emptyHostConfig, ...patch })

eq(hostReady(cfgOf({ kind: 'imgbb' })), false, 'imgbb 没 Key 时不算配好')
eq(missingHint(cfgOf({ kind: 'imgbb' })), '填 imgbb 的 API Key', 'imgbb 缺 Key 说清楚')
eq(hostReady(cfgOf({ kind: 'imgbb', imgbbKey: ' k ' })), true, 'imgbb 有 Key 就配好了')

eq(hostReady(cfgOf({ kind: 'github', ghToken: 't', ghRepo: 'foo' })), false, '仓库写成 foo 不算配好')
if (missingHint(cfgOf({ kind: 'github', ghToken: 't', ghRepo: 'foo' })).includes('owner/repo')) {
  ok('仓库格式错了要直说 owner/repo')
} else fail('仓库格式错了没提示')
eq(hostReady(cfgOf({ kind: 'github', ghToken: 't', ghRepo: 'o/r' })), true, 'token + owner/repo 就配好了')

eq(hostReady(cfgOf({ kind: 'r2', r2Base: '/api/upload' })), false, 'R2 没口令不算配好')
eq(hostReady(cfgOf({ kind: 'r2', r2Token: 't' })), true, 'R2 有地址有口令就配好了')

eq(hostReady(cfgOf({ kind: 'custom' })), false, '自定义没填地址不算配好')
eq(
  hostReady(cfgOf({ kind: 'custom', customUrl: 'https://h/api', customJsonPath: '  ' })),
  false,
  '自定义把取值路径清空了也不算配好',
)
eq(hostReady(cfgOf({ kind: 'custom', customUrl: 'https://h/api', customJsonPath: 'data.url' })), true, '自定义填齐就配好了')

/* ---------------- 假的 fetch ---------------- */

interface Captured {
  url: string
  init?: RequestInit
}

let captured: Captured[] = []

const setFetch = (impl: (url: string, init?: RequestInit) => Response | Promise<Response>) => {
  captured = []
  ;(globalThis as unknown as { fetch: typeof fetch }).fetch = ((input: unknown, init?: RequestInit) => {
    captured.push({ url: String(input), init })
    return Promise.resolve(impl(String(input), init))
  }) as typeof fetch
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const runKind = async (expect: string, label: string, file: File, cfg: HostConfig) => {
  try {
    await uploadImage(file, cfg)
    fail(`${label}：没有抛错`)
  } catch (e) {
    if (e instanceof HostError && e.kind === expect) ok(`${label} → ${expect}`)
    else fail(`${label}：期望 kind=${expect}，实际 ${e instanceof Error ? e.message : String(e)}`)
  }
}

/* ---------------- R2 ---------------- */

console.log('\nR2 适配器：')
const cfgR2 = cfgOf({ kind: 'r2', r2Base: '/api/upload', r2Token: 'tok' })

setFetch(() => json({ url: 'https://img.x.com/a.png' }))
const r2 = await uploadImage(png('a.png'), cfgR2)
eq(captured[0]?.url, '/api/upload', '发到配置的上传地址')
eq((captured[0]?.init?.headers as Record<string, string>).Authorization, 'Bearer tok', '带上口令')
eq(r2.url, 'https://img.x.com/a.png', '从响应的 url 取地址')
eq((captured[0]?.init?.body as FormData).get('file') !== null, true, '字段名是 file')

setFetch(() => new Response('', { status: 401 }))
await runKind('auth', 'HTTP 401', png(), cfgR2)
setFetch(() => new Response('', { status: 404 }))
await runKind('no-config', 'HTTP 404（本地 dev 没有 /api/upload）', png(), cfgR2)
setFetch(() => new Response('', { status: 501 }))
await runKind('no-config', 'HTTP 501（没绑 R2）', png(), cfgR2)
setFetch(() => new Response('', { status: 503 }))
await runKind('no-config', 'HTTP 503（服务端没设 UPLOAD_TOKEN）', png(), cfgR2)
setFetch(() => json({ ok: true }))
await runKind('bad-response', '返回里没有 url', png(), cfgR2)

/* ---------------- imgbb ---------------- */

console.log('\nimgbb 适配器：')
const cfgImgbb = cfgOf({ kind: 'imgbb', imgbbKey: 'KEY123' })

setFetch(() => json({ success: true, data: { url: 'https://i.ibb.co/raw.png', display_url: 'https://i.ibb.co/display.png' } }))
const ib = await uploadImage(png('a.png'), cfgImgbb)
if (captured[0]?.url.includes('api.imgbb.com') && captured[0]?.url.includes('key=KEY123')) {
  ok('Key 拼在 query 上')
} else fail(`imgbb 请求地址不对：${captured[0]?.url}`)
eq((captured[0]?.init?.body as FormData).get('image') !== null, true, '字段名必须是 image')
eq((captured[0]?.init?.body as FormData).get('file'), null, '不能叫 file（imgbb 会当成没传文件）')
eq(ib.url, 'https://i.ibb.co/display.png', '优先用 display_url')

setFetch(() => json({ success: false, error: { message: 'Invalid API key' } }, 400))
await runKind('auth', 'success:false + Key 报错', png(), cfgImgbb)
setFetch(() => new Response('', { status: 429 }))
await runKind('quota', 'HTTP 429（空响应体）', png(), cfgImgbb)
setFetch(() => new Response('<html>rate limited</html>', { status: 429 }))
await runKind('quota', 'HTTP 429（返回 HTML 而不是 JSON）', png(), cfgImgbb)
setFetch(() => new Response('<html>bad gateway</html>', { status: 502 }))
await runKind('bad-response', 'HTTP 502（网关错误）', png(), cfgImgbb)

/* ---------------- GitHub ---------------- */

console.log('\nGitHub 适配器：')
const cfgGh = cfgOf({ kind: 'github', ghToken: 'ghp_x', ghRepo: 'o/r', ghBranch: 'main', ghDir: 'images', ghCdn: 'jsdelivr' })

setFetch(() => json({ content: {} }, 201))
const gh = await uploadImage(png('a.png', 'hello'), cfgGh)
eq(captured[0]?.url, 'https://api.github.com/repos/o/r/contents/images/a.png', 'PUT 到 contents 接口')
eq(captured[0]?.init?.method, 'PUT', '方法是 PUT')
const body = JSON.parse(String(captured[0]?.init?.body)) as { content: string; branch: string }
eq(body.content, 'aGVsbG8=', '内容是文件字节的 base64')
eq(body.branch, 'main', '带分支')
eq(gh.url, 'https://cdn.jsdelivr.net/gh/o/r@main/images/a.png', '拼 jsDelivr 地址（不解析响应体）')

setFetch(() => json({}, 201))
const ghRaw = await uploadImage(png('a.png', 'hello'), { ...cfgGh, ghCdn: 'raw' })
eq(ghRaw.url, 'https://raw.githubusercontent.com/o/r/main/images/a.png', 'raw 模式拼源站地址')

setFetch(() => json({}, 201))
await uploadImage(png('图.png', 'x'), cfgGh)
if (captured[0]?.url.includes('%E5%9B%BE.png')) ok('文件名按段编码，中文不乱码')
else fail(`中文文件名没编码：${captured[0]?.url}`)
if (captured[0]?.url.includes('/contents/images/')) ok('路径里的斜杠不被编码')
else fail('斜杠被编码了，GitHub 会 404')

setFetch(() => new Response('', { status: 422 }))
await runKind('conflict', 'HTTP 422（仓库里已有同名文件）', png(), cfgGh)
setFetch(() => new Response('', { status: 401 }))
await runKind('auth', 'HTTP 401（token 失效）', png(), cfgGh)

/* ---------------- 自定义 ---------------- */

console.log('\n自定义适配器：')
const cfgCustom = cfgOf({
  kind: 'custom',
  customUrl: 'https://img.example.com/api/upload',
  customToken: 'tok',
  customField: 'photo',
  customJsonPath: 'result.data.url',
})

setFetch(() => json({ result: { data: { url: 'https://img.example.com/p/a.png' } } }))
const cu = await uploadImage(png('a.png'), cfgCustom)
eq(captured[0]?.url, 'https://img.example.com/api/upload', '发到配置的地址')
eq((captured[0]?.init?.headers as Record<string, string>).Authorization, 'Bearer tok', '带上口令')
eq((captured[0]?.init?.body as FormData).get('photo') !== null, true, '用配置的字段名')
eq(cu.url, 'https://img.example.com/p/a.png', '按点路径取值')

setFetch(() => json({ result: {} }))
await runKind('bad-response', '响应里没有那个路径', png(), cfgCustom)
setFetch(() => new Response('<html>502 Bad Gateway</html>', { status: 200 }))
await runKind('bad-response', '返回 HTML 而不是 JSON', png(), cfgCustom)

// 没填口令时不该发空 Authorization 头
setFetch(() => json({ result: { data: { url: 'x' } } }))
await uploadImage(png('a.png'), { ...cfgCustom, customToken: '  ' })
eq((captured[0]?.init?.headers as Record<string, string>).Authorization, undefined, '没口令就不发 Authorization')

/* ---------------- 统一入口 ---------------- */

console.log('\n统一入口：')

setFetch(() => json({ url: 'x' }))
await runKind('no-config', '没配好时直接拒绝（不发请求）', png(), cfgOf({ kind: 'imgbb' }))
eq(captured.length, 0, '没配好时一个请求都不发')

;(globalThis as unknown as { fetch: typeof fetch }).fetch = (() => {
  throw new TypeError('Failed to fetch')
}) as unknown as typeof fetch
await runKind('network', 'fetch 抛异常（CORS / 断网）', png(), cfgR2)

/* ---------------- 连通性测试 ---------------- */

console.log('\n测试上传：')
setFetch(() => json({ result: { data: { url: 'https://img.example.com/probe.png' } } }))
const probeUrl = await testHost(cfgCustom)
const probeForm = captured[0]?.init?.body as FormData
eq(probeUrl, 'https://img.example.com/probe.png', '返回测试图地址')
eq(probeForm.get('photo') instanceof File, true, '真的发了一张图，不是发 OPTIONS')
eq((probeForm.get('photo') as File).type, 'image/png', '测试图是 PNG')
const probeSize = (probeForm.get('photo') as File).size
if (probeSize > 0 && probeSize < 100) ok(`测试图确实很小（${probeSize} 字节），不占图床额度`)
else fail(`测试图大小不对：${probeSize} 字节`)

/* ---------------- 配置存取 ---------------- */

console.log('\n配置存取：')
store.clear()
eq(loadHostConfig().kind, 'imgbb', '没存过时用默认值')
saveHostConfig({ ...emptyHostConfig, kind: 'github', ghRepo: 'o/r' })
eq(loadHostConfig().ghRepo, 'o/r', '存进去能读回来')
eq(loadHostConfig().ghDir, 'images', '只存了部分字段时其余用默认值补齐')
store.set('dispatch.imagehost.v1', '{ 坏 JSON')
eq(loadHostConfig().kind, 'imgbb', '坏数据不炸，退回默认值')

/* ---------------- 文件判定 ---------------- */

console.log('\n文件判定：')
eq(isImageFile(png('a.png')), true, 'MIME 是图片就认')
eq(isImageFile(new File(['x'], 'a.png', { type: '' })), true, 'MIME 空时看扩展名')
eq(isImageFile(new File(['x'], 'a.md', { type: 'text/markdown' })), false, 'md 不算图片')
eq(isMarkdownFile(new File(['x'], 'a.md')), true, '.md 是正文')
eq(isMarkdownFile(new File(['x'], 'a.markdown')), true, '.markdown 也认')
eq(isMarkdownFile(png()), false, '图片不是正文')

const collected = collectAssets([png('a.png'), new File(['x'], 'a.md'), new File(['x'], 'b.JPG', { type: '' })])
eq(collected.length, 2, '只收图片，md 丢掉')
eq(collected.map((c) => c.path), ['a.png', 'b.JPG'], '路径就是文件名（单独选文件时）')

/* ---------------- 收尾 ---------------- */

console.log('')
if (failed === 0) {
  console.log('图床全部通过')
} else {
  console.log(`图床有 ${failed} 项失败`)
  process.exit(1)
}
