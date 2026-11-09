/**
 * 图片代理 —— 两条用途，共用同一份白名单
 *
 * **一、给「打包下载」兜底**（`?u=`）
 *
 * 打包下载要把每张图 fetch 成 Blob 再塞进 zip，而浏览器
 * 对跨域 fetch 的要求是对方返回 `Access-Control-Allow-Origin`。图床通常
 * 只服务于 `<img>` 标签，不发这个头 —— 于是预览里 16 张图全都正常显示，
 * 点「打包下载」却 16 张全红「跨域」。`<img>` 不受 CORS 限制，`fetch` 受，
 * 这个差异就是坑的来源。
 *
 * 这里由 Pages 同源转发：浏览器 fetch('/api/img?u=...') 是同源请求，不存在
 * 跨域检查；由 Worker 去取图，并在响应上补 CORS 头。
 *
 * **二、给「图片体检」探测防盗链**（`?u=&probe=1`）
 *
 * 见下面 PROBE_REFERER 的注释：浏览器改不了 Referer，只有 Worker 能带一个
 * 第三方 Referer 去试。这条路径只回报状态码和响应头，不转发图片本体。
 *
 * ⚠️ 只放行白名单里的主机。开放代理会被拿去刷别人的流量，
 * 也会让这个域名变成任意 URL 的取回跳板。
 * 换图床时把新域名加进 ALLOWED_HOSTS 即可（子域自动放行）。
 */

const ALLOWED_HOSTS = ['hulatu.com', 'img.hulatu.com']

/** 单张上限：图床原图通常几百 KB，20MB 已经远超正常范围 */
const MAX_BYTES = 20 * 1024 * 1024

/**
 * 探测用的第三方 Referer。
 *
 * 为什么要让 Worker 来发：浏览器根本做不到这件事 —— `referrerPolicy` 只有
 * no-referrer / same-origin / origin / strict-origin 几个值，改不成
 * `mp.weixin.qq.com`。而「带第三方 Referer 还能不能取到图」正是判断
 * 防盗链的唯一办法。
 *
 * 取公众号的域名是因为它是最容易裂的那个：微信转存正文图片时会带上来源。
 */
const PROBE_REFERER = 'https://mp.weixin.qq.com/'

function isAllowed(target: URL): boolean {
  if (target.protocol !== 'https:') return false
  const host = target.hostname.toLowerCase()
  return ALLOWED_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))
}

/**
 * 体检探测：同一张图取两次头 —— 一次不带 Referer，一次带第三方 Referer。
 *
 * 为什么要两次：这两次回答的是两个不同的问题。
 * - 不带 Referer：**图还在不在、多大、什么格式**（服务端转存的平台走这条路）
 * - 带第三方 Referer：**别的网站直接引用会不会被拒**（防盗链走这条路）
 *
 * 只取响应头不取 body：探测只关心 status / content-type / content-length，
 * 把几十 MB 的图拉进 Worker 是纯浪费。
 *
 * 单独一条路径而不是塞进图片代理里，是因为返回的东西根本不是图片 ——
 * 让同一个 URL 有时返回 JPEG 有时返回 JSON，缓存和调试都会变得难以预料。
 */
interface HeadResult {
  status: number
  contentType: string | null
  bytes: number | null
}

async function head(target: URL, referer?: string): Promise<HeadResult> {
  const init: RequestInit & { cf?: Record<string, unknown> } = {
    headers: referer ? { Referer: referer } : {},
    // 上游挂起时 10 秒掐断：客户端 15 秒就放弃了，Worker 没必要继续等到平台兜底
    signal: AbortSignal.timeout(10_000),
    // 探测结果不缓存：防盗链是随时会被打开的开关，缓存一天就等于看不见
    cf: { cacheTtl: 0 },
  }

  try {
    const res = await fetch(target.toString(), init)
    // 不读 body：探测只要响应头
    try {
      await res.body?.cancel()
    } catch {
      // 已经流完或者不支持 cancel 都不影响结论
    }
    const type = res.headers.get('content-type')
    const len = Number(res.headers.get('content-length') ?? '0')
    return {
      status: res.status,
      contentType: type && type.startsWith('image/') ? type : null,
      bytes: Number.isFinite(len) && len > 0 ? len : null,
    }
  } catch {
    // 连不上：status 0 表示「没问到」，不是「对方返回了 0」
    return { status: 0, contentType: null, bytes: null }
  }
}

async function probe(target: URL): Promise<Response> {
  const [plain, foreign] = await Promise.all([head(target), head(target, PROBE_REFERER)])

  return Response.json(
    {
      status: plain.status,
      contentType: plain.contentType,
      bytes: plain.bytes,
      /**
       * 只有「图确实在」的时候才谈得上防盗链。
       * 一张 404 的图，带什么 Referer 都是取不到 —— 那不是防盗链，
       * 报成防盗链会让人去 Cloudflare 后台找一个根本不存在的问题。
       */
      hotlink: foreign.status === 403 && plain.status === 200,
      foreignStatus: foreign.status,
    },
    {
      headers: {
        'access-control-allow-origin': '*',
        'cache-control': 'no-store',
      },
    },
  )
}

export const onRequestGet = async (ctx: { request: Request }): Promise<Response> => {
  const params = new URL(ctx.request.url).searchParams
  const raw = params.get('u')
  if (!raw) return new Response('missing ?u=', { status: 400 })

  let target: URL
  try {
    target = new URL(raw)
  } catch {
    return new Response('bad ?u=', { status: 400 })
  }
  if (!isAllowed(target)) return new Response('host not allowed', { status: 403 })

  if (params.get('probe') === '1') return probe(target)

  // cf 字段是 Cloudflare 专有的，标准 RequestInit 里没有
  //
  // 故意不发 Accept 头：一旦写了 image/avif，Cloudflare 会把图转成 AVIF
  // （实测同一张 37KB 的 jpg 变成 25KB 的 avif），字节格式和原扩展名就对不上，
  // 打包时按 URL 猜出来的 .webp 里装的其实是 avif。省这点带宽不值得。
  const init: RequestInit & { cf?: Record<string, unknown> } = {
    // 上游挂起时 10 秒掐断（同 head）
    signal: AbortSignal.timeout(10_000),
    cf: { cacheEverything: true, cacheTtl: 86400 },
  }

  let upstream: Response
  try {
    upstream = await fetch(target.toString(), init)
  } catch (e) {
    return new Response(`upstream fetch failed: ${e instanceof Error ? e.message : 'unknown'}`, {
      status: 502,
    })
  }

  if (!upstream.ok) return new Response(`upstream ${upstream.status}`, { status: 502 })

  const type = upstream.headers.get('content-type') ?? ''
  // 只转发图片：万一白名单域名被挂上了别的文件，这里也不能变成通用代理
  if (!type.startsWith('image/')) return new Response('not an image', { status: 415 })

  const len = Number(upstream.headers.get('content-length') ?? '0')
  if (len > MAX_BYTES) return new Response('image too large', { status: 413 })

  // content-length 只能防「老实交代体积」的源站：分块编码不发长度时，
  // 上面的 413 检查等于没做。用 TransformStream 边流边数，超了就掐断 ——
  // 总比把一张 100MB 的图整个流进 Worker、再塞进 zip 里强。
  // 掐断后客户端读流会失败，调用方按「这张图拿不到」处理，不会静默混进坏数据。
  if (!upstream.body) return new Response('upstream empty body', { status: 502 })
  let seen = 0
  const guard = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      seen += chunk.byteLength
      if (seen > MAX_BYTES) {
        controller.error(new Error('image too large'))
        return
      }
      controller.enqueue(chunk)
    },
  })

  return new Response(upstream.body.pipeThrough(guard), {
    headers: {
      'content-type': type,
      // 这个头就是整件事的目的：让页面里的 fetch 能读到字节
      'access-control-allow-origin': '*',
      'cache-control': 'public, max-age=86400',
    },
  })
}
