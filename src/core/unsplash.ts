/**
 * Unsplash 封面图
 *
 * 为什么前端直连、不做中转：
 * `api.unsplash.com` 和 `images.unsplash.com` 都返回 `access-control-allow-origin: *`，
 * 浏览器可以直接调，也能 fetch 成 Blob 一键下载。这和本项目「没有服务器、
 * Key 只存在本机」的定位一致 —— 加一层代理反而要求使用者先去部署。
 *
 * 额度是真的紧：demo 应用 **50 次/小时**，每次搜索算 1 次（生产应用 1000 次，
 * 要单独申请）。所以响应头里的 `X-RateLimit-Remaining` 必须显示出来：
 * 用户连点几次「换一批」就到顶了，得让他看见还剩多少，而不是对着一个
 * 莫名其妙的错误发呆。
 *
 * 署名是硬要求，不是礼貌。Unsplash 的 API 条款要求展示摄影师名字并链回图片页，
 * 每次「下载」还要先打一次 `download_location` 上报。少了这些，应用会被撤销 Key。
 * 所以这里的下载是「先上报，再取字节」，顺序不能反。
 */

import { downloadBlob } from '../cards/export'

const API = 'https://api.unsplash.com'
const KEY_STORE = 'dispatch.unsplash.v1'

/** 搜索接口本身很快（200–600ms），12s 已经够宽松；卡住多半是网络断了 */
const TIMEOUT = 12_000

/** 下载体积上限：Unsplash 原图能到 6000px / 20MB，封面用不上那么大 */
const DOWNLOAD_MAX_W = 2400

/* ------------------------------------------------------------------ */
/* Key                                                                 */
/* ------------------------------------------------------------------ */

export function loadUnsplashKey(): string {
  try {
    return localStorage.getItem(KEY_STORE)?.trim() ?? ''
  } catch {
    return ''
  }
}

/** 返回是否真的落盘了。隐私模式下写不进去，UI 必须说出来 */
export function saveUnsplashKey(key: string): boolean {
  try {
    const trimmed = key.trim()
    if (!trimmed) {
      localStorage.removeItem(KEY_STORE)
      return true
    }
    localStorage.setItem(KEY_STORE, trimmed)
    return true
  } catch {
    return false
  }
}

export function clearUnsplashKey(): boolean {
  try {
    localStorage.removeItem(KEY_STORE)
    return true
  } catch {
    return false
  }
}

export function hasUnsplashKey(): boolean {
  return loadUnsplashKey().length > 0
}

/* ------------------------------------------------------------------ */
/* 错误                                                                */
/* ------------------------------------------------------------------ */

export type UnsplashFailKind = 'no-key' | 'auth' | 'rate' | 'network' | 'empty'

/**
 * 分类型是因为四种情况要做的事完全不同：
 * - no-key  → 去设置里填
 * - auth    → key 失效了，换一个
 * - rate    → 等一小时，别重试
 * - network → 检查网络 / 代理
 * 合成一句「搜索失败」等于什么都没说。
 */
export class UnsplashError extends Error {
  readonly kind: UnsplashFailKind

  constructor(kind: UnsplashFailKind, message: string) {
    super(message)
    this.name = 'UnsplashError'
    this.kind = kind
  }
}

/* ------------------------------------------------------------------ */
/* 数据模型                                                            */
/* ------------------------------------------------------------------ */

export interface CoverPhoto {
  id: string
  /** 描述文字：既做 alt，也做复制出来的说明 */
  alt: string
  width: number
  height: number
  /** 网格缩略图（约 400px 宽） */
  thumb: string
  /** 预览图（约 1080px 宽） */
  regular: string
  /** 下载地址：已拼好宽度与压缩参数 */
  download: string
  /** 主色调，图没加载出来时先铺这层，避免白闪 */
  color: string
  author: string
  authorUrl: string
  /** 图片详情页，署名要链到这里 */
  pageUrl: string
  /** 下载上报接口，取字节前必须先打 */
  downloadLocation: string
}

export interface CoverSearchResult {
  photos: CoverPhoto[]
  /** 这个关键词一共有多少张 */
  total: number
  /** 剩余额度；响应头缺失时为 null（不代表 0） */
  remaining: number | null
  /** 还有没有下一页 */
  hasMore: boolean
}

export type CoverOrientation = 'landscape' | 'portrait' | 'squarish'

export interface CoverSearchOptions {
  page?: number
  perPage?: number
  orientation?: CoverOrientation
  signal?: AbortSignal
}

/* ------------------------------------------------------------------ */
/* 响应解析                                                            */
/* ------------------------------------------------------------------ */

/** Unsplash 的响应结构只取用得到的字段，其余忽略 */
interface RawPhoto {
  id?: string
  width?: number
  height?: number
  color?: string
  alt_description?: string | null
  description?: string | null
  urls?: { thumb?: string; small?: string; regular?: string; full?: string; raw?: string }
  links?: { html?: string; download_location?: string }
  user?: { name?: string; links?: { html?: string } }
}

function pickAlt(raw: RawPhoto): string {
  const text = (raw.alt_description || raw.description || '').trim()
  return text || 'Unsplash 图片'
}

/**
 * 下载地址：在 full 上再压一刀。
 *
 * `urls.full` 已经是带 ixid 的 imgix 地址，直接拼 `&w=` 是官方允许的用法。
 * 不压的话，竖构图的照片能到 20MB，用户只是想要一张封面图。
 */
function downloadUrl(raw: RawPhoto): string {
  const base = raw.urls?.full || raw.urls?.regular || ''
  if (!base) return ''
  const sep = base.includes('?') ? '&' : '?'
  return `${base}${sep}w=${DOWNLOAD_MAX_W}&q=85&fm=jpg&fit=max`
}

function toCoverPhoto(raw: RawPhoto): CoverPhoto | null {
  const id = raw.id ?? ''
  /**
   * 缩略图用 `small`（400px 宽）而不是 `thumb`（200px）。
   * 三列网格每格约 230px，2 倍屏要 460px —— 200px 的 thumb 放上去是糊的。
   */
  const thumb = raw.urls?.small ?? raw.urls?.thumb ?? ''
  const regular = raw.urls?.regular ?? ''
  const pageUrl = raw.links?.html ?? ''
  const downloadLocation = raw.links?.download_location ?? ''
  // 缺任何一项都拼不出合规的卡片，宁可不显示
  if (!id || !thumb || !regular || !pageUrl || !downloadLocation) return null

  return {
    id,
    alt: pickAlt(raw),
    width: raw.width ?? 0,
    height: raw.height ?? 0,
    thumb,
    regular,
    download: downloadUrl(raw),
    color: raw.color && /^#[0-9a-f]{3,8}$/i.test(raw.color) ? raw.color : '#8a8a8a',
    author: raw.user?.name?.trim() || 'Unsplash 摄影师',
    authorUrl: raw.user?.links?.html ?? 'https://unsplash.com',
    pageUrl,
    downloadLocation,
  }
}

/* ------------------------------------------------------------------ */
/* 搜索                                                                */
/* ------------------------------------------------------------------ */

function authHeader(key: string): HeadersInit {
  return { Authorization: `Client-ID ${key}` }
}

/** 统一超时：AbortSignal.timeout 在 Safari 16 以下没有，手动兜一层 */
async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(new DOMException('timeout', 'TimeoutError')), TIMEOUT)
  try {
    return await fetch(url, { ...init, signal: init.signal ?? ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

function rateFrom(res: Response): number | null {
  const raw = res.headers.get('x-ratelimit-remaining')
  if (raw === null) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

export async function searchCoverPhotos(
  query: string,
  opts: CoverSearchOptions = {},
): Promise<CoverSearchResult> {
  const trimmed = query.trim()
  if (!trimmed) throw new UnsplashError('empty', '先填一个搜索词')

  const key = loadUnsplashKey()
  if (!key) {
    throw new UnsplashError(
      'no-key',
      '还没填 Unsplash Access Key。点右上角「设置」→「Unsplash 封面图」，填一个就能用。',
    )
  }

  const params = new URLSearchParams({
    query: trimmed,
    per_page: String(opts.perPage ?? 3),
    page: String(opts.page ?? 1),
    // 公开工具必须开：这是 Unsplash 的内容过滤，high 会挡掉擦边图
    content_filter: 'high',
  })
  if (opts.orientation) params.set('orientation', opts.orientation)

  let res: Response
  try {
    res = await fetchWithTimeout(`${API}/search/photos?${params.toString()}`, {
      headers: authHeader(key),
      signal: opts.signal,
    })
  } catch (e) {
    // 用户主动取消不算错误，原样抛出去让上层识别
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    throw new UnsplashError(
      'network',
      '连不上 Unsplash。检查网络或代理；如果开了广告拦截，可能把 api.unsplash.com 拦了。',
    )
  }

  if (res.status === 401) {
    throw new UnsplashError('auth', 'Access Key 无效。去设置里核对一下，注意别把 Secret Key 当成 Access Key 填进来。')
  }
  if (res.status === 403) {
    throw new UnsplashError('auth', '这个 Key 没有权限：确认应用还在 Unsplash 后台、没有被暂停。')
  }
  if (res.status === 429) {
    throw new UnsplashError('rate', '额度用完了（demo 应用 50 次/小时）。等下一个整点再试，或者去后台申请生产额度。')
  }
  if (!res.ok) {
    throw new UnsplashError('network', `Unsplash 返回 ${res.status}，稍后再试。`)
  }

  let json: { total?: number; total_pages?: number; results?: RawPhoto[] }
  try {
    json = (await res.json()) as typeof json
  } catch {
    throw new UnsplashError('network', 'Unsplash 返回的内容看不懂，可能被代理改写了。')
  }

  const photos = (json.results ?? []).map(toCoverPhoto).filter((p): p is CoverPhoto => p !== null)
  const page = opts.page ?? 1
  const totalPages = json.total_pages ?? 0

  return {
    photos,
    total: json.total ?? photos.length,
    remaining: rateFrom(res),
    hasMore: page < totalPages,
  }
}

/* ------------------------------------------------------------------ */
/* 下载                                                                */
/* ------------------------------------------------------------------ */

/**
 * 上报一次下载。
 *
 * Unsplash 靠这个接口统计图片被用了多少次，摄影师据此拿分成 —— 这是条款要求。
 * 失败不阻断下载：上报是「应该做」，拿到图是「用户要的」，不能因为统计接口
 * 抖了一下就让用户下载不了。
 */
async function reportDownload(photo: CoverPhoto, key: string): Promise<void> {
  try {
    await fetchWithTimeout(photo.downloadLocation, {
      headers: authHeader(key),
      // 这个接口返回 JSON，不关心内容，只要打到了
      cache: 'no-store',
    })
  } catch {
    // 故意吞掉：见函数注释
  }
}

/**
 * 下载一张封面图。
 *
 * 顺序是「先上报，再取字节」：反过来的话，用户中途取消就不会留下统计，
 * 但那已经用掉了 Unsplash 的带宽 —— 对摄影师不公平。
 */
export async function downloadCoverPhoto(photo: CoverPhoto, fileName: string): Promise<void> {
  const key = loadUnsplashKey()
  if (key) await reportDownload(photo, key)

  let res: Response
  try {
    res = await fetchWithTimeout(photo.download, { mode: 'cors', credentials: 'omit' })
  } catch {
    throw new UnsplashError('network', '图片下载失败（跨域被拦或网络中断）。可以改用「打开图片页」手动保存。')
  }
  if (!res.ok) throw new UnsplashError('network', `图片下载失败：HTTP ${res.status}`)

  const blob = await res.blob()
  if (!blob.type.startsWith('image/')) {
    throw new UnsplashError('network', '下载回来的不是图片，可能被代理拦截了。')
  }
  downloadBlob(blob, fileName)
}

/** 复制到剪贴板的图片地址：用 regular 而不是下载地址，贴到别处不会拉 2400px 的大图 */
export function shareUrlOf(photo: CoverPhoto): string {
  return photo.regular
}

/** 署名文案：Unsplash 要求可点击，这里给纯文本版，链接由 UI 另外挂 */
export function creditOf(photo: CoverPhoto): string {
  return `Photo by ${photo.author} on Unsplash`
}
