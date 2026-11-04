/**
 * 公众号草稿箱直发的**客户端一半**
 *
 * 为什么必须有中转服务，而不是浏览器直接调微信接口：
 *
 * 1. **AppSecret 不能进前端**。打包后的 JS 任何人都能读，一旦泄露等于把公众号交出去。
 * 2. **access_token 需要缓存与统一刷新**。它 2 小时过期，且微信对刷新次数有限制 ——
 *    多端各自刷新会把彼此的 token 顶掉，症状是「刚才还能用，现在 40001」。
 * 3. **IP 白名单**。微信要求调用方 IP 在后台白名单里，浏览器没有固定出口 IP。
 * 4. **CORS**。api.weixin.qq.com 不返回跨域头，浏览器根本读不到响应。
 *
 * 所以这里只做三件事：
 * - 保存「中转服务地址 + 访问口令」
 * - 发请求前把微信的硬限制查一遍（正文 20000 字符 / 1MB、标题 64 字…）
 * - 把 errcode 翻成人话
 *
 * 第三件是最有价值的：用户看到「errcode 40164」完全不知道该怎么办，
 * 而「调用方 IP 不在白名单」+「去公众平台加一下中转服务器的出口 IP」就能自己解决。
 */

const RELAY_KEY = 'ad.wechat-relay.v1'

/** 微信草稿接口的硬限制（官方文档 developer.work.weixin... 公众号「新建草稿」） */
export const WECHAT_LIMITS = {
  titleMax: 64,
  digestMax: 120,
  contentMax: 20_000,
  /** 正文上限 1MB（字节，不是字符） */
  contentMaxBytes: 1024 * 1024,
} as const

export interface RelayConfig {
  /** 中转服务根地址，例如 https://wechat-relay.example.workers.dev */
  url: string
  /** 访问口令，随 Authorization: Bearer 发出，防止别人拿你的中转去发文章 */
  token: string
}

export const emptyRelayConfig: RelayConfig = { url: '', token: '' }

export function readRelayConfig(): RelayConfig {
  try {
    const raw = localStorage.getItem(RELAY_KEY)
    if (!raw) return emptyRelayConfig
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return emptyRelayConfig
    const o = parsed as Partial<RelayConfig>
    return { url: typeof o.url === 'string' ? o.url : '', token: typeof o.token === 'string' ? o.token : '' }
  } catch {
    return emptyRelayConfig
  }
}

export function writeRelayConfig(cfg: RelayConfig): void {
  try {
    localStorage.setItem(RELAY_KEY, JSON.stringify(cfg))
  } catch {
    // 写不进去不影响本次使用
  }
}

/** 地址必须带协议，否则 fetch 会当成相对路径去请求本站 */
export function normalizeRelayUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

export function relayConfigured(cfg: RelayConfig): boolean {
  const url = normalizeRelayUrl(cfg.url)
  if (!/^https?:\/\/[^\s]+$/i.test(url)) return false
  return cfg.token.trim().length > 0
}

/* ------------------------------------------------------------------ */
/* 请求 / 响应契约                                                      */
/* ------------------------------------------------------------------ */

export interface DraftPayload {
  title: string
  /** 作者，公众号后台的「作者」字段，≤ 8 字更稳 */
  author?: string
  /** 摘要，≤ 120 字；不给微信会自动截正文前 54 字 */
  digest?: string
  /** 全内联样式的正文 HTML */
  content: string
  /** 「阅读原文」链接 */
  contentSourceUrl?: string
  /**
   * 封面图地址。微信「新建草稿」强制要求 thumb_media_id，
   * 所以中转服务需要一张封面：要么配了默认封面，要么把这个地址传成永久素材。
   */
  coverUrl?: string
}

export interface DraftSuccess {
  ok: true
  /** 草稿的 media_id，后续发布/编辑都用它 */
  mediaId: string
  /** 草稿箱的编辑链接，可直接点开 */
  url?: string
}

export type RelayErrorCode =
  | 'NOT_CONFIGURED'
  | 'NETWORK'
  | 'TIMEOUT'
  | 'UNAUTHORIZED'
  | 'BAD_RESPONSE'
  | 'INVALID_CREDENTIALS'
  | 'TOKEN_EXPIRED'
  | 'IP_NOT_ALLOWED'
  | 'THUMB_REQUIRED'
  | 'CONTENT_TOO_LONG'
  | 'DRAFT_LIMIT'
  | 'RATE_LIMITED'
  | 'UPSTREAM_ERROR'

export interface RelayFailure {
  ok: false
  code: RelayErrorCode
  /** 一句话说清发生了什么 */
  title: string
  /** 该怎么处理 */
  hint: string
  /** 中转服务或微信返回的原始信息，折叠展示，方便报错时贴给别人 */
  detail?: string
}

export type DraftOutcome = DraftSuccess | RelayFailure

/** 微信 errcode → 人话。这张表是这一整块最值钱的东西 */
const ERRCODES: Record<number, { code: RelayErrorCode; title: string; hint: string }> = {
  40001: {
    code: 'TOKEN_EXPIRED',
    title: 'access_token 失效',
    hint: '中转服务缓存的 token 被顶掉了（多端同时刷新会这样）。点重试一般就好；连续失败说明 AppSecret 不对。',
  },
  40013: {
    code: 'INVALID_CREDENTIALS',
    title: 'AppID 无效',
    hint: '检查中转服务里配的 WECHAT_APPID，注意别把「原始 ID」（gh_ 开头那个）当成 AppID。',
  },
  40125: {
    code: 'INVALID_CREDENTIALS',
    title: 'AppSecret 无效',
    hint: '去公众平台「设置与开发 → 基本配置」重置 AppSecret，再更新到中转服务的环境变量里。',
  },
  40164: {
    code: 'IP_NOT_ALLOWED',
    title: '调用方 IP 不在白名单',
    hint: '把中转服务器的出口 IP 加到公众平台「基本配置 → IP 白名单」。Cloudflare Worker 的出口 IP 不固定，需要改用固定 IP 的机器或配置固定出口。',
  },
  45009: {
    code: 'RATE_LIMITED',
    title: '接口调用超过限额',
    hint: '当天的调用次数用完了，明天再试。频繁失败也会累积配额，先确认不是死循环重试。',
  },
  45110: {
    code: 'CONTENT_TOO_LONG',
    title: '内容超过微信上限',
    hint: '正文上限 20000 字符且不超过 1MB。用「按 H2 拆篇导出」拆成两篇发。',
  },
  40007: {
    code: 'THUMB_REQUIRED',
    title: '封面素材无效',
    hint: 'thumb_media_id 不存在或已失效。重新上传一张封面，或在「正文图片」里挑一张作为封面。',
  },
  53503: {
    code: 'DRAFT_LIMIT',
    title: '草稿箱满了',
    hint: '公众号草稿箱最多 20 篇，去后台删几篇旧草稿再发。',
  },
  53504: {
    code: 'DRAFT_LIMIT',
    title: '草稿箱满了',
    hint: '公众号草稿箱最多 20 篇，去后台删几篇旧草稿再发。',
  },
  48001: {
    code: 'UPSTREAM_ERROR',
    title: '接口未授权',
    hint: '这个公众号没有「草稿箱」接口权限。未认证的订阅号/服务号可能没有，需要先完成认证。',
  },
}

const CODES: Record<Exclude<RelayErrorCode, never>, { title: string; hint: string }> = {
  NOT_CONFIGURED: {
    title: '还没配置中转服务',
    hint: '公众号接口不能从浏览器直连（AppSecret 会暴露、IP 不在白名单、还有跨域）。先部署一个中转服务，再把地址和口令填进来。',
  },
  NETWORK: {
    title: '连不上中转服务',
    hint: '检查地址是否写对、服务是否在运行。浏览器控制台里会有更具体的 CORS 或 DNS 报错。',
  },
  TIMEOUT: {
    title: '中转服务没响应',
    hint: '超过 30 秒没有返回。可能正在上传封面图，稍等再试；反复超时就去看看服务日志。',
  },
  UNAUTHORIZED: {
    title: '口令不对',
    hint: '中转服务拒绝了这次请求。核对访问口令是否与部署时设置的 RELAY_TOKEN 一致。',
  },
  BAD_RESPONSE: {
    title: '中转服务返回了看不懂的东西',
    hint: '通常是地址填成了网页而不是接口，或者服务报错时返回了 HTML。用「测试连接」看具体返回。',
  },
  INVALID_CREDENTIALS: {
    title: '公众号凭据无效',
    hint: '检查中转服务里配置的 AppID / AppSecret。',
  },
  TOKEN_EXPIRED: {
    title: 'access_token 失效',
    hint: '重试一次；持续失败说明 AppSecret 不对。',
  },
  IP_NOT_ALLOWED: {
    title: '调用方 IP 不在白名单',
    hint: '把中转服务器的出口 IP 加到公众平台「基本配置 → IP 白名单」。',
  },
  THUMB_REQUIRED: {
    title: '缺封面图',
    hint: '微信新建草稿必须带封面。在中转服务里配一张默认封面，或在这里填一个封面图地址。',
  },
  CONTENT_TOO_LONG: {
    title: '内容超过微信上限',
    hint: '正文上限 20000 字符且不超过 1MB，用「按 H2 拆篇导出」拆开发。',
  },
  DRAFT_LIMIT: {
    title: '草稿箱满了',
    hint: '公众号草稿箱最多 20 篇，去后台删几篇再发。',
  },
  RATE_LIMITED: {
    title: '调用太频繁',
    hint: '等一会儿再试。别连续点重试，会越试越久。',
  },
  UPSTREAM_ERROR: {
    title: '微信返回了错误',
    hint: '看下面的原始信息，或把 errcode 贴给中转服务的日志。',
  },
}

/**
 * 把中转服务返回的错误翻成人话。
 *
 * 优先认 `upstream.errcode` —— 这样即使中转服务很「笨」（只是把微信的响应原样转发），
 * 前端也能给出可执行的建议，不必要求中转服务自己做错误映射。
 */
export function explainFailure(input: {
  code?: string
  message?: string
  upstream?: { errcode?: number; errmsg?: string }
}): RelayFailure {
  const errcode = input.upstream?.errcode
  if (typeof errcode === 'number' && ERRCODES[errcode]) {
    const m = ERRCODES[errcode]
    return {
      ok: false,
      code: m.code,
      title: m.title,
      hint: m.hint,
      detail: `errcode ${errcode}${input.upstream?.errmsg ? ` · ${input.upstream.errmsg}` : ''}`,
    }
  }

  const known = input.code && input.code in CODES ? (input.code as RelayErrorCode) : 'UPSTREAM_ERROR'
  const text = CODES[known]
  const detail = [input.message, errcode !== undefined ? `errcode ${errcode}` : '', input.upstream?.errmsg]
    .filter(Boolean)
    .join(' · ')

  return { ok: false, code: known, title: text.title, hint: text.hint, detail: detail || undefined }
}

/* ------------------------------------------------------------------ */
/* 发送前自检                                                           */
/* ------------------------------------------------------------------ */

export interface PreflightIssue {
  level: 'block' | 'warn'
  text: string
}

/**
 * 发之前先查一遍微信的硬限制。
 *
 * 这些限制中转服务也能查，但让用户在点发送之前就看到，比让他等 2 秒后
 * 收到一个 45110 要好得多。
 */
export function preflight(payload: DraftPayload, cfg: RelayConfig): PreflightIssue[] {
  const issues: PreflightIssue[] = []

  if (!relayConfigured(cfg)) {
    issues.push({ level: 'block', text: '还没配置中转服务的地址与口令' })
  }

  const title = payload.title.trim()
  if (!title) issues.push({ level: 'block', text: '标题是空的，公众号草稿必须有标题' })
  else if ([...title].length > WECHAT_LIMITS.titleMax) {
    issues.push({
      level: 'block',
      text: `标题 ${[...title].length} 字，超过微信 ${WECHAT_LIMITS.titleMax} 字上限`,
    })
  }

  const content = payload.content
  const chars = [...content].length
  if (!content.trim()) {
    issues.push({ level: 'block', text: '正文是空的' })
  } else if (chars > WECHAT_LIMITS.contentMax) {
    issues.push({
      level: 'block',
      text: `正文 ${chars} 字符，超过 ${WECHAT_LIMITS.contentMax} 上限（超 ${chars - WECHAT_LIMITS.contentMax}）`,
    })
  }

  const bytes = byteLength(content)
  if (bytes > WECHAT_LIMITS.contentMaxBytes) {
    issues.push({
      level: 'block',
      text: `正文 ${(bytes / 1024 / 1024).toFixed(2)} MB，超过 1 MB 上限`,
    })
  }

  if (payload.digest && [...payload.digest].length > WECHAT_LIMITS.digestMax) {
    issues.push({
      level: 'warn',
      text: `摘要 ${[...payload.digest].length} 字，超过 ${WECHAT_LIMITS.digestMax} 字，微信会截断`,
    })
  }

  if (!payload.coverUrl?.trim()) {
    issues.push({
      level: 'warn',
      text: '没填封面图地址。如果中转服务没配默认封面，会被微信拒（thumb_media_id 是必填）',
    })
  }

  return issues
}

export function blockedBy(issues: PreflightIssue[]): boolean {
  return issues.some((i) => i.level === 'block')
}

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length
}

/* ------------------------------------------------------------------ */
/* 发送                                                                */
/* ------------------------------------------------------------------ */

const TIMEOUT_MS = 30_000

export async function sendDraft(
  cfg: RelayConfig,
  payload: DraftPayload,
  signal?: AbortSignal,
): Promise<DraftOutcome> {
  if (!relayConfigured(cfg)) return explainFailure({ code: 'NOT_CONFIGURED' })

  const url = `${normalizeRelayUrl(cfg.url)}/wechat/draft`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  // 外部取消（比如用户关掉弹层）也要能中断
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort)

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.token.trim()}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError'
    return explainFailure({
      code: aborted && !signal?.aborted ? 'TIMEOUT' : 'NETWORK',
      message: e instanceof Error ? e.message : String(e),
    })
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }

  if (res.status === 401 || res.status === 403) {
    return explainFailure({ code: 'UNAUTHORIZED', message: `HTTP ${res.status}` })
  }

  let body: unknown
  try {
    body = await res.json()
  } catch {
    return explainFailure({ code: 'BAD_RESPONSE', message: `HTTP ${res.status}，响应不是 JSON` })
  }

  if (!body || typeof body !== 'object') {
    return explainFailure({ code: 'BAD_RESPONSE', message: '响应不是对象' })
  }

  const o = body as Record<string, unknown>

  // 成功
  if (o.ok === true || typeof o.mediaId === 'string' || typeof o.media_id === 'string') {
    const mediaId = typeof o.mediaId === 'string' ? o.mediaId : (o.media_id as string)
    if (mediaId) {
      return { ok: true, mediaId, url: typeof o.url === 'string' ? o.url : undefined }
    }
  }

  // 失败：既认我们自己定义的 code，也认微信原样转发的 errcode
  const upstream =
    o.upstream && typeof o.upstream === 'object'
      ? (o.upstream as { errcode?: number; errmsg?: string })
      : typeof o.errcode === 'number'
        ? { errcode: o.errcode, errmsg: typeof o.errmsg === 'string' ? o.errmsg : undefined }
        : undefined

  return explainFailure({
    code: typeof o.code === 'string' ? o.code : undefined,
    message: typeof o.message === 'string' ? o.message : typeof o.errmsg === 'string' ? o.errmsg : undefined,
    upstream,
  })
}

/** 「测试连接」：GET {url}/health，返回中转服务自报的配置是否齐 */
export async function pingRelay(cfg: RelayConfig): Promise<
  { ok: true; appIdMasked?: string; hasDefaultCover?: boolean } | RelayFailure
> {
  if (!relayConfigured(cfg)) return explainFailure({ code: 'NOT_CONFIGURED' })
  try {
    const res = await fetch(`${normalizeRelayUrl(cfg.url)}/health`, {
      headers: { Authorization: `Bearer ${cfg.token.trim()}` },
    })
    if (res.status === 401 || res.status === 403) {
      return explainFailure({ code: 'UNAUTHORIZED', message: `HTTP ${res.status}` })
    }
    const body = (await res.json()) as Record<string, unknown>
    if (body.ok !== true) {
      return explainFailure({
        code: typeof body.code === 'string' ? body.code : undefined,
        message: typeof body.message === 'string' ? body.message : undefined,
      })
    }
    return {
      ok: true,
      appIdMasked: typeof body.appIdMasked === 'string' ? body.appIdMasked : undefined,
      hasDefaultCover: body.hasDefaultCover === true,
    }
  } catch (e) {
    return explainFailure({ code: 'NETWORK', message: e instanceof Error ? e.message : String(e) })
  }
}
