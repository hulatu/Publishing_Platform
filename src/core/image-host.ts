/**
 * 图床：把 md 里的本地图片传上去，换成能外链的地址
 *
 * 三条原则，决定了下面所有实现：
 *
 * 1. **外链一律不动**。以 `http(s)://` 或 `//` 开头的地址已经在网上，这就是
 *    使用者说的「本来就在图床上，就用原有链接」。判断成本最低，也最不会误伤 ——
 *    硬要去认「这是不是我们认识的图床」只会把自建图床判成陌生站点。
 *
 * 2. **适配器可插拔**。不同人用不同图床（R2 / imgbb / GitHub / 自建），
 *    差异只在两件事上：「怎么发这个请求」和「从响应的哪儿取 URL」。
 *    抽成四个小函数，比写一个大 if-else 好维护，也让新增图床只改一处。
 *
 * 3. **配置跟着浏览器走**。和 AI Key、Unsplash Key 一样存 localStorage，
 *    不经过任何服务器 —— 这个工具的定位就是没有服务器。
 *
 * 为什么要区分 `local` 和 `absolute`：Hugo 里 `/images/a.jpg` 是站点根路径，
 * 在本地是相对 `static/` 的，到了公众号就是死链。它和 `./images/a.jpg`
 * 一样需要上传，只是归一化时少剥一层。
 */

/* ------------------------------------------------------------------ */
/* 配置                                                                */
/* ------------------------------------------------------------------ */

export type HostKind = 'r2' | 'imgbb' | 'github' | 'custom'

export interface HostConfig {
  kind: HostKind

  /** R2：走本项目的 Pages Function，默认 /api/upload；token 对应环境变量 UPLOAD_TOKEN */
  r2Base: string
  r2Token: string

  /** imgbb：只需要一个 API Key */
  imgbbKey: string

  /** GitHub：token + 仓库 + 目录，拼出 jsDelivr 或 raw 地址 */
  ghToken: string
  ghRepo: string
  ghBranch: string
  ghDir: string
  ghCdn: 'jsdelivr' | 'raw'

  /** 自定义：POST multipart，从 JSON 按路径取 URL */
  customUrl: string
  customToken: string
  customField: string
  customJsonPath: string
}

const STORE_KEY = 'dispatch.imagehost.v1'

export const emptyHostConfig: HostConfig = {
  kind: 'imgbb',
  r2Base: '/api/upload',
  r2Token: '',
  imgbbKey: '',
  ghToken: '',
  ghRepo: '',
  ghBranch: 'main',
  ghDir: 'images',
  ghCdn: 'jsdelivr',
  customUrl: '',
  customToken: '',
  customField: 'file',
  customJsonPath: 'data.url',
}

export function loadHostConfig(): HostConfig {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return { ...emptyHostConfig }
    return { ...emptyHostConfig, ...(JSON.parse(raw) as Partial<HostConfig>) }
  } catch {
    return { ...emptyHostConfig }
  }
}

export function saveHostConfig(cfg: HostConfig): boolean {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(cfg))
    return true
  } catch {
    return false
  }
}

export function clearHostConfig(): boolean {
  try {
    localStorage.removeItem(STORE_KEY)
    return true
  } catch {
    return false
  }
}

export const hostLabels: Record<HostKind, string> = {
  r2: 'Cloudflare R2',
  imgbb: 'imgbb',
  github: 'GitHub + jsDelivr',
  custom: '自建图床',
}

/** 当前配置能不能上传。只校验「这个类型必需的那几项」，别的类型填了也不管 */
export function hostReady(cfg: HostConfig = loadHostConfig()): boolean {
  switch (cfg.kind) {
    case 'r2':
      return Boolean(cfg.r2Base.trim() && cfg.r2Token.trim())
    case 'imgbb':
      return Boolean(cfg.imgbbKey.trim())
    case 'github':
      return Boolean(cfg.ghToken.trim() && /^[^/\s]+\/[^/\s]+$/.test(cfg.ghRepo.trim()))
    case 'custom':
      return Boolean(cfg.customUrl.trim() && cfg.customJsonPath.trim())
  }
}

/** 配置不全时缺什么，直接说出来，别让用户对着「未配置」猜 */
export function missingHint(cfg: HostConfig): string {
  switch (cfg.kind) {
    case 'r2':
      if (!cfg.r2Base.trim()) return '填上传地址（默认 /api/upload）'
      if (!cfg.r2Token.trim()) return '填上传口令，要和 Cloudflare 环境变量 UPLOAD_TOKEN 一致'
      return ''
    case 'imgbb':
      return cfg.imgbbKey.trim() ? '' : '填 imgbb 的 API Key'
    case 'github':
      if (!cfg.ghToken.trim()) return '填 GitHub token（需要 repo 写权限）'
      if (!/^[^/\s]+\/[^/\s]+$/.test(cfg.ghRepo.trim())) return '仓库要写成 owner/repo'
      return ''
    case 'custom':
      if (!cfg.customUrl.trim()) return '填上传接口地址'
      if (!cfg.customJsonPath.trim()) return '填响应里 URL 的路径，比如 data.url'
      return ''
  }
}

/* ------------------------------------------------------------------ */
/* 错误                                                                */
/* ------------------------------------------------------------------ */

export type HostFailKind = 'no-config' | 'auth' | 'conflict' | 'quota' | 'network' | 'bad-response'

export class HostError extends Error {
  readonly kind: HostFailKind

  constructor(kind: HostFailKind, message: string) {
    super(message)
    this.name = 'HostError'
    this.kind = kind
  }
}

/* ------------------------------------------------------------------ */
/* 图片地址分类                                                        */
/* ------------------------------------------------------------------ */

/**
 * - `remote`：已经在网上（含协议相对地址），**不动它**
 * - `data`：内嵌 base64，可以上传（否则会把 md 撑成几 MB）
 * - `local`：本地路径或站点根路径，必须上传
 */
export type SrcKind = 'remote' | 'data' | 'local'

export function classifySrc(src: string): SrcKind {
  const s = src.trim()
  if (/^https?:\/\//i.test(s)) return 'remote'
  // 协议相对：//cdn.example.com/a.jpg —— 跟着页面协议走，本质也是外链
  if (s.startsWith('//')) return 'remote'
  if (/^data:/i.test(s)) return 'data'
  return 'local'
}

export function isRemote(src: string): boolean {
  return classifySrc(src) === 'remote'
}

/**
 * 归一化成本地相对路径，用来和拖进来的文件比对。
 * `./images/a.jpg` / `/images/a.jpg` / `images/a.jpg` 都变成 `images/a.jpg`。
 * query 和 hash 一律丢掉 —— `a.jpg?v=2` 指向的还是同一个文件。
 */
export function normalizeSrc(src: string): string {
  return src
    .trim()
    .replace(/[?#].*$/, '')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
}

/* ------------------------------------------------------------------ */
/* 文件名与 URL 拼接                                                   */
/* ------------------------------------------------------------------ */

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
}

/** 图床都要一个像样的文件名：没扩展名就按 MIME 补一个 */
export function fileNameFor(file: File, fallback = 'image'): string {
  const raw = (file.name || '').trim()
  const base = raw.replace(/[\\/:*?"<>|\s]+/g, '-')
  if (/\.[a-z0-9]{2,5}$/i.test(base)) return base
  const ext = MIME_EXT[file.type.toLowerCase()] ?? 'jpg'
  return `${base || fallback}.${ext}`
}

/** GitHub 的 contents 接口要求路径按段编码，斜杠不能编码 */
function encodePath(path: string): string {
  return path.split('/').filter(Boolean).map(encodeURIComponent).join('/')
}

/** 从任意嵌套对象里按 `a.b.c` 取值 */
export function getByPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj
  for (const seg of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[seg]
  }
  return cur
}

/* ------------------------------------------------------------------ */
/* 编码与请求                                                          */
/* ------------------------------------------------------------------ */

async function fileToBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer())
  // 不能一次 String.fromCharCode(...buf)：几百 KB 的图会把调用栈打爆
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < buf.length; i += CHUNK) {
    binary += String.fromCharCode(...buf.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    // 图床出错时经常直接返回一段 HTML，原样截一段出来比「解析失败」有用
    throw new HostError('bad-response', `图床返回的不是 JSON：${text.slice(0, 120)}`)
  }
}

function netError(e: unknown): HostError {
  if (e instanceof HostError) return e
  return new HostError(
    'network',
    '连不上图床。检查网络或代理；有些图床会拦掉浏览器直传，那就得走自建接口。',
  )
}

/* ------------------------------------------------------------------ */
/* 四个适配器                                                          */
/* ------------------------------------------------------------------ */

export interface UploadResult {
  url: string
}

async function uploadToR2(cfg: HostConfig, file: File, name: string): Promise<UploadResult> {
  const fd = new FormData()
  fd.append('file', file, name)
  let res: Response
  try {
    res = await fetch(cfg.r2Base.trim() || '/api/upload', {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.r2Token.trim()}` },
      body: fd,
    })
  } catch (e) {
    throw netError(e)
  }
  if (res.status === 401) {
    throw new HostError('auth', '上传口令不对。要和 Cloudflare 环境变量 UPLOAD_TOKEN 一致。')
  }
  if (res.status === 403) {
    throw new HostError('auth', 'R2 拒绝了这次上传，检查 Pages Function 的权限配置。')
  }
  if (res.status === 404) {
    throw new HostError('no-config', '找不到上传接口。这个功能要部署到 Cloudflare Pages 才可用（本地 dev 没有 /api/upload）。')
  }
  if (res.status === 501) {
    throw new HostError('no-config', 'R2 没绑定。去 Cloudflare 后台给 Pages 项目加一个名为 IMAGES 的 R2 绑定。')
  }
  if (res.status === 503) {
    throw new HostError('no-config', '服务端没设 UPLOAD_TOKEN，为了安全禁止了上传。去环境变量里加一个。')
  }
  if (!res.ok) throw new HostError('bad-response', `上传失败：HTTP ${res.status}`)

  const json = (await readJson(res)) as { url?: unknown }
  if (typeof json.url !== 'string' || !json.url) {
    throw new HostError('bad-response', '上传成功但没返回 url。检查 Function 的返回格式。')
  }
  return { url: json.url }
}

async function uploadToImgbb(cfg: HostConfig, file: File, name: string): Promise<UploadResult> {
  const fd = new FormData()
  // imgbb 的字段名固定叫 image，改别的会被当成没传文件
  fd.append('image', file, name)

  let res: Response
  try {
    res = await fetch(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(cfg.imgbbKey.trim())}`, {
      method: 'POST',
      body: fd,
    })
  } catch (e) {
    throw netError(e)
  }

  // 这里不能直接用 readJson：imgbb 出错时经常返回空响应体或一段 HTML
  // （429 尤其常见），先解析会把「限流」误报成「返回的不是 JSON」，
  // 让人去查 Key 而不是等一会儿。所以先按状态码分类，再尽量取它的错误说明。
  const text = await res.text()
  let json: {
    success?: boolean
    data?: { url?: string; display_url?: string }
    error?: { message?: string }
  } = {}
  try {
    json = JSON.parse(text) as typeof json
  } catch {
    // 留着 text，下面拼提示用
  }

  if (!res.ok || json.success === false) {
    const detail = json.error?.message ?? (text.trim() ? text.trim().slice(0, 120) : '')
    const msg = detail || `HTTP ${res.status}`
    if (res.status === 429) throw new HostError('quota', 'imgbb 限流了，等一会儿再传。')
    if (res.status === 401 || res.status === 403) throw new HostError('auth', `imgbb 拒绝了 Key：${msg}`)
    if (res.status === 400 && /key/i.test(msg)) {
      throw new HostError('auth', `imgbb 说 Key 不对：${msg}`)
    }
    throw new HostError('bad-response', `imgbb 返回错误：${msg}`)
  }

  const url = json.data?.display_url || json.data?.url
  if (!url) throw new HostError('bad-response', 'imgbb 没返回图片地址。')
  return { url }
}

async function uploadToGithub(cfg: HostConfig, file: File, name: string): Promise<UploadResult> {
  const repo = cfg.ghRepo.trim()
  const branch = cfg.ghBranch.trim() || 'main'
  const dir = cfg.ghDir.trim().replace(/^\/+|\/+$/g, '')
  const path = dir ? `${dir}/${name}` : name

  const content = await fileToBase64(file)

  let res: Response
  try {
    res = await fetch(`https://api.github.com/repos/${repo}/contents/${encodePath(path)}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${cfg.ghToken.trim()}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: `upload ${name}`,
        content,
        branch,
      }),
    })
  } catch (e) {
    throw netError(e)
  }

  if (res.status === 401) throw new HostError('auth', 'GitHub token 无效或已过期。')
  if (res.status === 403) throw new HostError('auth', 'GitHub token 没有这个仓库的写权限。')
  if (res.status === 404) throw new HostError('no-config', `找不到仓库 ${repo}，或者 token 看不到它。`)
  if (res.status === 422) {
    throw new HostError(
      'conflict',
      `仓库里已经有 ${path} 了。改个文件名再传，或者把「目录」换一个 —— 覆盖已有文件需要先删掉它。`,
    )
  }
  if (res.status === 409) throw new HostError('conflict', `分支 ${branch} 不存在。`)
  if (!res.ok) throw new HostError('bad-response', `GitHub 返回 HTTP ${res.status}`)

  // 不依赖响应体拼地址：jsDelivr 的格式是固定的，自己拼比解析更稳
  const encoded = encodePath(path)
  const url =
    cfg.ghCdn === 'raw'
      ? `https://raw.githubusercontent.com/${repo}/${encodeURIComponent(branch)}/${encoded}`
      : `https://cdn.jsdelivr.net/gh/${repo}@${encodeURIComponent(branch)}/${encoded}`
  return { url }
}

async function uploadToCustom(cfg: HostConfig, file: File, name: string): Promise<UploadResult> {
  const field = cfg.customField.trim() || 'file'
  const fd = new FormData()
  fd.append(field, file, name)

  const headers: Record<string, string> = {}
  const token = cfg.customToken.trim()
  if (token) headers.Authorization = `Bearer ${token}`

  let res: Response
  try {
    res = await fetch(cfg.customUrl.trim(), { method: 'POST', headers, body: fd })
  } catch (e) {
    throw netError(e)
  }

  if (res.status === 401 || res.status === 403) throw new HostError('auth', '图床拒绝了 token。')
  if (res.status === 413) throw new HostError('quota', '图片超过图床的体积上限。')
  if (!res.ok) throw new HostError('bad-response', `图床返回 HTTP ${res.status}`)

  const json = await readJson(res)
  const value = getByPath(json, cfg.customJsonPath.trim())
  if (typeof value !== 'string' || !value) {
    throw new HostError(
      'bad-response',
      `响应里没有 ${cfg.customJsonPath}，或者它不是字符串。用浏览器开发者工具看一眼真实响应结构。`,
    )
  }
  return { url: value }
}

/* ------------------------------------------------------------------ */
/* 统一入口                                                            */
/* ------------------------------------------------------------------ */

export async function uploadImage(
  file: File,
  cfg: HostConfig = loadHostConfig(),
): Promise<UploadResult> {
  if (!hostReady(cfg)) {
    throw new HostError('no-config', `图床还没配好：${missingHint(cfg)}`)
  }
  const name = fileNameFor(file)
  switch (cfg.kind) {
    case 'r2':
      return uploadToR2(cfg, file, name)
    case 'imgbb':
      return uploadToImgbb(cfg, file, name)
    case 'github':
      return uploadToGithub(cfg, file, name)
    case 'custom':
      return uploadToCustom(cfg, file, name)
  }
}

/**
 * 连通性测试。
 *
 * 传一张 1×1 的 PNG 而不是「发个 OPTIONS 就算通」：OPTIONS 只说明域名活着，
 * 说明不了 Key 对不对、字段名对不对、返回结构对不对 —— 那三样才是真正会出错的。
 */
export async function testHost(cfg: HostConfig = loadHostConfig()): Promise<string> {
  const bytes = Uint8Array.from(
    atob(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    ),
    (c) => c.charCodeAt(0),
  )
  const probe = new File([bytes], 'host-probe.png', { type: 'image/png' })
  const { url } = await uploadImage(probe, cfg)
  return url
}
