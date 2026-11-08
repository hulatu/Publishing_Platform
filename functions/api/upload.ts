/**
 * 图床上传 —— Cloudflare R2
 *
 * 这是四种图床里唯一需要「部署后才有」的一种：本地 `vite dev` 没有 Pages
 * Functions，调用会 404。所以前端把 404 单独翻译成「这个功能要部署后才可用」，
 * 而不是笼统地报「上传失败」。
 *
 * 安全上做了四件事，缺一不可：
 * 1. **token 校验**。这是个公开域名，不设防的上传接口第二天就会被人当免费图床。
 *    设了 `UPLOAD_TOKEN` 就必须带 `Authorization: Bearer <token>`；没设则拒绝
 *    一切上传（宁可不可用，也不能裸奔）。
 * 2. **只收图片**。按 MIME 白名单，不按扩展名 —— 扩展名是用户说了算的。
 * 3. **限体积**。单张 10MB，超过就 413。
 * 4. **重写文件名**。用户给的名字只保留「可读部分」，前面加随机串 ——
 *    两个人都传 `1.jpg` 时，后传的不能把先传的覆盖掉。
 *
 * 读回：配了 `UPLOAD_PUBLIC_BASE`（比如 https://img.hulatu.com）就直接返回那个
 * 域名下的地址，走 R2 的 CDN；没配则退化成 `/api/upload?key=...` 由这个 Function
 * 转发 —— 能用，但每张图都要过一次 Worker，只适合试用。
 */

/** 只用到 put/get，不需要引入 @cloudflare/workers-types */
interface R2Like {
  put: (
    key: string,
    value: ArrayBuffer,
    opts?: { httpMetadata?: { contentType?: string; cacheControl?: string } },
  ) => Promise<unknown>
  get: (key: string) => Promise<{ body: ReadableStream; httpMetadata?: { contentType?: string } } | null>
}

interface Env {
  IMAGES?: R2Like
  /** 公开访问前缀，如 https://img.hulatu.com；末尾斜杠可有可无 */
  UPLOAD_PUBLIC_BASE?: string
  /** 上传口令。不设则禁止上传 */
  UPLOAD_TOKEN?: string
}

const MAX_BYTES = 10 * 1024 * 1024

/** 按 MIME 白名单，不按扩展名：扩展名是客户端说了算的，靠不住 */
const ALLOWED: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

function fail(message: string, status: number): Response {
  return json({ error: message }, status)
}

/** 用户给的文件名只留可读部分：去掉路径、控制字符、会破坏 URL 的符号 */
function safeName(raw: string, ext: string): string {
  const base = raw
    .replace(/^.*[/\\]/, '')
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return `${base || 'image'}.${ext}`
}

/** 随机前缀：8 位十六进制，够避免重名，又不会把地址撑得太长 */
function randomTag(): string {
  const buf = new Uint8Array(4)
  crypto.getRandomValues(buf)
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export const onRequestPost = async (ctx: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = ctx

  if (!env.IMAGES) {
    return fail('R2 没绑定。在 Cloudflare 后台给 Pages 项目加一个名为 IMAGES 的 R2 绑定。', 501)
  }

  const token = env.UPLOAD_TOKEN?.trim()
  if (!token) {
    return fail('没有设置 UPLOAD_TOKEN。为了不让这个接口变成公开图床，未设置时禁止上传。', 503)
  }
  const auth = request.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${token}`) {
    return fail('上传口令不对。在设置面板里填「上传口令」，要和环境变量 UPLOAD_TOKEN 一致。', 401)
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return fail('请求不是 multipart/form-data。', 400)
  }

  const file = form.get('file')
  if (!(file instanceof File)) return fail('缺少 file 字段。', 400)

  const ext = ALLOWED[file.type.toLowerCase()]
  if (!ext) return fail(`不收 ${file.type || '未知类型'}。只接受 jpg / png / gif / webp / avif / svg。`, 415)
  if (file.size > MAX_BYTES) return fail(`图片 ${(file.size / 1024 / 1024).toFixed(1)}MB，超过 10MB 上限。`, 413)

  const now = new Date()
  const dir = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`
  const key = `${dir}/${randomTag()}-${safeName(file.name, ext)}`

  try {
    await env.IMAGES.put(key, await file.arrayBuffer(), {
      httpMetadata: {
        contentType: file.type,
        // 文件名带随机串，内容永不改变 —— 可以长缓存
        cacheControl: 'public, max-age=31536000, immutable',
      },
    })
  } catch (e) {
    return fail(`写入 R2 失败：${e instanceof Error ? e.message : 'unknown'}`, 502)
  }

  const base = env.UPLOAD_PUBLIC_BASE?.trim().replace(/\/+$/, '')
  const url = base ? `${base}/${key}` : `/api/upload?key=${encodeURIComponent(key)}`
  return json({ url, key })
}

/** 没配公开域名时的读回通道。配了域名就别走这里，性能差一截 */
export const onRequestGet = async (ctx: { request: Request; env: Env }): Promise<Response> => {
  const key = new URL(ctx.request.url).searchParams.get('key')
  if (!key) return fail('缺少 ?key=', 400)
  if (!ctx.env.IMAGES) return fail('R2 没绑定', 501)

  const obj = await ctx.env.IMAGES.get(key)
  if (!obj) return fail('没有这张图', 404)

  return new Response(obj.body, {
    headers: {
      'content-type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
      'cache-control': 'public, max-age=31536000, immutable',
    },
  })
}
