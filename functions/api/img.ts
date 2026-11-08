/**
 * 图片代理 —— 给「正文图片 → 打包下载」兜底
 *
 * 为什么需要它：打包下载要把每张图 fetch 成 Blob 再塞进 zip，而浏览器
 * 对跨域 fetch 的要求是对方返回 `Access-Control-Allow-Origin`。图床通常
 * 只服务于 `<img>` 标签，不发这个头 —— 于是预览里 16 张图全都正常显示，
 * 点「打包下载」却 16 张全红「跨域」。`<img>` 不受 CORS 限制，`fetch` 受，
 * 这个差异就是坑的来源。
 *
 * 这里由 Pages 同源转发：浏览器 fetch('/api/img?u=...') 是同源请求，不存在
 * 跨域检查；由 Worker 去取图，并在响应上补 CORS 头。
 *
 * ⚠️ 只放行白名单里的主机。开放代理会被拿去刷别人的流量，
 * 也会让这个域名变成任意 URL 的取回跳板。
 * 换图床时把新域名加进 ALLOWED_HOSTS 即可（子域自动放行）。
 */

const ALLOWED_HOSTS = ['hulatu.com', 'img.hulatu.com']

/** 单张上限：图床原图通常几百 KB，20MB 已经远超正常范围 */
const MAX_BYTES = 20 * 1024 * 1024

function isAllowed(target: URL): boolean {
  if (target.protocol !== 'https:') return false
  const host = target.hostname.toLowerCase()
  return ALLOWED_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))
}

export const onRequestGet = async (ctx: { request: Request }): Promise<Response> => {
  const raw = new URL(ctx.request.url).searchParams.get('u')
  if (!raw) return new Response('missing ?u=', { status: 400 })

  let target: URL
  try {
    target = new URL(raw)
  } catch {
    return new Response('bad ?u=', { status: 400 })
  }
  if (!isAllowed(target)) return new Response('host not allowed', { status: 403 })

  // cf 字段是 Cloudflare 专有的，标准 RequestInit 里没有
  //
  // 故意不发 Accept 头：一旦写了 image/avif，Cloudflare 会把图转成 AVIF
  // （实测同一张 37KB 的 jpg 变成 25KB 的 avif），字节格式和原扩展名就对不上，
  // 打包时按 URL 猜出来的 .webp 里装的其实是 avif。省这点带宽不值得。
  const init: RequestInit & { cf?: Record<string, unknown> } = {
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

  return new Response(upstream.body, {
    headers: {
      'content-type': type,
      // 这个头就是整件事的目的：让页面里的 fetch 能读到字节
      'access-control-allow-origin': '*',
      'cache-control': 'public, max-age=86400',
    },
  })
}
