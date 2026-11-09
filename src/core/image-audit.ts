/**
 * 图片体检
 *
 * 为什么需要它：正文里的图挂掉是**静默**的。公众号粘过去裂一张，编辑器不报错；
 * 知乎转存失败，也就是那张图没了。等到读者看见的时候已经发出去了。
 *
 * 这里只查四件「查得准」的事，不猜：
 *
 * 1. **能不能取到** —— `new Image()` 加载，失败就是 404 / 域名挂了。
 *    这条路不受 CORS 限制，是唯一能可靠判断「图还在不在」的浏览器手段。
 *
 * 2. **别的站引用会不会被拒** —— 走 `/api/img?probe=1`，由 Worker 带一个
 *    第三方 Referer 去取。浏览器自己做不到这件事：`referrerPolicy` 只能选
 *    no-referrer / same-origin / origin，改不成 `mp.weixin.qq.com`。
 *    实测过：R2 上开了 Hotlink Protection 时，不带 Referer 是 200、带第三方
 *    Referer 是 403 —— 而这个差别决定了「粘到公众号会不会裂」。
 *
 * 3. **体积** —— 超过 2 MB 的图，公众号转存和手机端加载都容易出问题。
 *
 * 4. **真实格式** —— URL 写 `.webp`、内容其实是 JPEG 这种事真的会发生
 *    （本机实测 53 张全中）。浏览器不看扩展名，但打包下载、传别的平台会看。
 *
 * 刻意**不**做的事：
 * - 不猜平台的精确体积上限。除了公众号那条 2 MB，别的平台没有公开且稳定的数字，
 *   编一个出来只会让人以为查得比实际准。
 * - 不下「必须改」的结论。查出问题、说清依据，改不改由人定。
 */

/* ------------------------------------------------------------------ */
/* 平台规则                                                            */
/* ------------------------------------------------------------------ */

export interface ImageRule {
  /** 超过这个体积算「偏大」（字节） */
  heavyBytes: number
  /** 这个平台正文里显示不了的格式（按真实格式判，不按扩展名） */
  banned: string[]
  /** 期望的宽高比 [宽, 高]，比如小红书 3:4 */
  ratio?: [number, number]
  /** 比例容差（相对误差） */
  ratioTolerance?: number
  /** 为什么有这些限制 —— 直接显示在面板里，省得用户以为是自己写错了 */
  note: string
}

/**
 * 2 MB 这条线不是「某个平台的官方上限」，而是三个事实的交点：
 * 公众号转存大图失败率高、手机端 4G 加载明显卡、多数图床/平台的单图上限也在这一档。
 * 超过它不一定出错，但值得看一眼。
 */
const HEAVY = 2 * 1024 * 1024

const DEFAULT_RULE: ImageRule = {
  heavyBytes: HEAVY,
  banned: [],
  note: '只查能不能取到、多大、什么格式。',
}

const RULES: Partial<Record<string, ImageRule>> = {
  wechat: {
    heavyBytes: HEAVY,
    // 公众号正文会剥掉 SVG，粘过去就是一块空白
    banned: ['svg'],
    note: '微信会把正文图片转存到自己的 CDN：超过 2 MB 容易转存失败，SVG 会被剥掉。',
  },
  xiaohongshu: {
    heavyBytes: HEAVY,
    banned: [],
    // 小红书首图 3:4，横图会被居中裁切
    ratio: [3, 4],
    ratioTolerance: 0.03,
    note: '小红书首图是 3:4 竖图，横图会被裁掉两边。',
  },
}

export function imageRule(platform: string): ImageRule {
  return RULES[platform] ?? DEFAULT_RULE
}

/* ------------------------------------------------------------------ */
/* 格式                                                                */
/* ------------------------------------------------------------------ */

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/pjpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
}

/** jpeg / jpg 是同一件事，比较前先归一 */
export function normalizeExt(ext: string): string {
  const e = ext.trim().toLowerCase().replace(/^\./, '')
  if (e === 'jpeg' || e === 'jpe') return 'jpg'
  if (e === 'svg+xml') return 'svg'
  return e
}

/** URL 路径里的扩展名，没有就返回空串 */
export function urlExt(src: string): string {
  const path = src.split(/[?#]/)[0] ?? ''
  const m = /\.([a-z0-9]{2,5})$/i.exec(path)
  return m ? normalizeExt(m[1]) : ''
}

/** MIME → 扩展名，未知返回空串 */
export function mimeExt(contentType: string | undefined): string {
  if (!contentType) return ''
  const base = contentType.split(';')[0]?.trim().toLowerCase() ?? ''
  const mapped = MIME_EXT[base]
  return mapped ? normalizeExt(mapped) : ''
}

/* ------------------------------------------------------------------ */
/* 结论                                                                */
/* ------------------------------------------------------------------ */

export type IssueLevel = 'error' | 'warn'

export interface ImageIssue {
  level: IssueLevel
  /** 缩略图上那个两三个字的角标 */
  tag: string
  /** 说清依据，别只说「有问题」 */
  detail: string
}

/** 一次体检拿到的原始事实。全部可缺省 —— 没查到的部分不下结论。 */
export interface ImageFacts {
  /** `new Image()` 是否加载成功 */
  loaded?: boolean
  /** 真实像素尺寸 */
  width?: number
  height?: number
  /** 真实 MIME */
  contentType?: string
  /** 字节数 */
  bytes?: number
  /** 带第三方 Referer 取图被拒（403） */
  hotlink?: boolean
  /**
   * 代理那边确认「这张图确实在」（upstream 200 且是 image/*）。
   *
   * 为什么需要这个独立证人：`loaded === false` 有两种完全不同的成因 ——
   * 图真的没了，或者**只是这个浏览器没拿到**。后者很常见：缩略图那次请求
   * 被防盗链挡了（403），浏览器会把同一个 URL 的失败结果合并/缓存，
   * 紧接着体检再问一次，拿到的还是那个 403。
   * 这时本地说「打不开」、代理说「200，195 KB，image/jpeg」——
   * 两个证据打架，就得分开说，不能一律报成「图没了」。
   */
  reachable?: boolean
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * 把事实翻成结论。纯函数，不碰网络 —— 这样 check-imgaudit 能直接喂数据进来测。
 *
 * 判定顺序是有讲究的：**取不到 > 防盗链 > 格式 > 体积 > 比例**。
 * 前两条是「这张图根本不会显示」，后面的只是「显示得不好」，
 * 一张图同时命中多条时，先说的必须是最致命的那条。
 */
export function judge(facts: ImageFacts, rule: ImageRule, src: string): ImageIssue[] {
  const issues: ImageIssue[] = []
  const realExt = mimeExt(facts.contentType)
  const remote = /^https?:\/\//i.test(src) || src.startsWith('//')

  if (!remote && src.startsWith('data:')) {
    issues.push({
      level: 'warn',
      tag: '内嵌图片',
      detail: '这是 base64 内嵌的图，粘到平台通常会被丢掉，而且会让正文长出一大截。换成图床外链。',
    })
  } else if (!remote) {
    // 本地路径不是「取不到」，是「根本没传上去」—— 这两件事的修法不一样，
    // 所以文案必须分开写，否则人会去查图床设置。
    issues.push({
      level: 'error',
      tag: '本地路径',
      detail:
        '这张图还是本地相对路径，粘到任何平台都取不到。' +
        '先在 upic（或你自己的图床）把它传上去，再把正文里的路径换成外链地址 —— ' +
        '这个工具不改写正文，只读链接。',
    })
  } else if (facts.loaded === false) {
    if (facts.reachable === true) {
      // 代理取到了、浏览器没显示 —— 这两件事同时成立时，图是存在的。
      // 说成「打不开」会让人去查图床/删图重传，方向就错了。
      issues.push({
        level: 'warn',
        tag: '没显示',
        detail:
          '代理能取到这张图（200），但这个页面里没加载出来。' +
          '常见原因是图床的防盗链把带本站 Referer 的请求挡了，也可能是本机网络抖动。' +
          '换个网络或刷新一次再看；一直这样的话，去图床关掉 Hotlink Protection。',
      })
    } else {
      issues.push({
        level: 'error',
        tag: '打不开',
        detail: '地址取不到图片：可能是 404、域名解析失败，或者对方站点拦了直接访问。',
      })
    }
  }

  // 独立判断，不挂在「打不开」的 else 里：一张图可以既取不到又被防盗链拦，
  // 但更常见的是「取得到、只是别的站引用会被拒」—— 后者只有这条能说清。
  if (facts.hotlink) {
    issues.push({
      level: 'error',
      tag: '防盗链',
      detail:
        '带第三方 Referer 取图返回 403 —— 别的网站直接引用这张图会被拒。' +
        '公众号、知乎这类「服务端转存」的平台可能照常显示，但任何直接热链的地方都会裂图。',
    })
  }

  if (realExt && rule.banned.includes(realExt)) {
    issues.push({
      level: 'error',
      tag: `${realExt.toUpperCase()} 不支持`,
      detail: `这个平台的正文里显示不了 ${realExt.toUpperCase()}，粘过去会变成空白。换成 PNG 或 JPG。`,
    })
  }

  const ext = urlExt(src)
  if (ext && realExt && ext !== realExt) {
    issues.push({
      level: 'warn',
      tag: '格式不符',
      detail:
        `地址写的是 .${ext}，内容其实是 ${realExt.toUpperCase()}。` +
        '浏览器按内容解码、不看扩展名，所以正文里显示不受影响；' +
        `但「打包下载」会把它存成 .${ext}，里面装的却是 ${realExt.toUpperCase()} —— ` +
        '上传到按扩展名校验的地方会被拒。',
    })
  }

  if (typeof facts.bytes === 'number' && facts.bytes > rule.heavyBytes) {
    issues.push({
      level: 'warn',
      tag: '偏大',
      detail: `${fmtBytes(facts.bytes)}，超过 ${fmtBytes(rule.heavyBytes)}。大图在公众号转存和手机端加载都容易出问题。`,
    })
  }

  if (rule.ratio && facts.width && facts.height) {
    const want = rule.ratio[0] / rule.ratio[1]
    const got = facts.width / facts.height
    const tol = rule.ratioTolerance ?? 0.03
    if (Math.abs(got - want) / want > tol) {
      const w = rule.ratio[0]
      const h = rule.ratio[1]
      issues.push({
        level: 'warn',
        tag: '比例',
        detail: `这张是 ${facts.width}×${facts.height}，要求 ${w}:${h}。会被居中裁切。`,
      })
    }
  }

  return issues
}

export interface AuditSummary {
  total: number
  errors: number
  warns: number
  /** 一句话结论 */
  line: string
  /** 没查出问题时的那句 */
  clean: boolean
  /** 体积量到的张数。比 total 少时，结论里不能声称「体积没问题」 */
  measured: number
}

/**
 * 汇总成一句话。
 *
 * 刻意不写「全部通过」这种话：没查过和查过没问题必须能分开。
 * 更进一步 —— 查了但没量到体积（取图被 403 挡住），也不能说「体积没问题」，
 * 只能说「没量到」。这类「差一点的诚实」是这个功能存在的意义：
 * 一句假的「全部正常」比不报更坏。
 */
export function summarize(all: { issues: ImageIssue[]; bytes?: number }[], probed: boolean): AuditSummary {
  const total = all.length
  const errors = all.filter((a) => a.issues.some((i) => i.level === 'error')).length
  const warns = all.filter((a) => !a.issues.some((i) => i.level === 'error') && a.issues.length > 0).length
  const measured = all.filter((a) => typeof a.bytes === 'number').length

  const parts: string[] = []
  if (errors > 0) parts.push(`${errors} 张不能直接用`)
  if (warns > 0) parts.push(`${warns} 张要注意`)

  let line: string
  if (total === 0) {
    line = '这篇文章里没有图片。'
  } else if (parts.length > 0) {
    line = `${total} 张图，${parts.join('、')}。`
  } else if (!probed) {
    line = `${total} 张图都取得到。体积和格式还没查 —— 点「重查一遍」。`
  } else if (measured < total) {
    line = `${total} 张图都取得到，但其中 ${total - measured} 张量不到体积（取图被拒），格式和体积没查全。`
  } else {
    line = `${total} 张图，都取得到、体积和格式也没问题。`
  }

  return { total, errors, warns, line, clean: errors === 0 && warns === 0, measured }
}

/* ------------------------------------------------------------------ */
/* 网络                                                                */
/* ------------------------------------------------------------------ */

/** 同源图片代理。图床不开 CORS 时，只有它能读到响应头。 */
const PROXY = '/api/img?u='

/**
 * 量一张图的真实像素尺寸。
 *
 * 用 `new Image()` 而不是 fetch：`<img>` 不受 CORS 限制，图床不发
 * Access-Control-Allow-Origin 也能拿到 naturalWidth。fetch 会直接抛 TypeError，
 * 而那个错和「404」在浏览器里长得一模一样，分不出来。
 *
 * referrerPolicy 必须是 no-referrer：缩略图那边就是这么显示的，
 * 这里要判断的是「图本身在不在」，不是「防盗链拦不拦」—— 后者由代理去测。
 *
 * 失败会**再试一次**，第二次带一个一次性参数。原因：同一个 URL 如果刚刚
 * 在缩略图里失败过（防盗链 403），浏览器会把那次失败的结果合并/缓存下来，
 * 紧接着再问一次拿到的还是它 —— 图明明在，却量不到尺寸。
 * 加参数只是绕开缓存键，R2 和常见图床都忽略 query，取到的还是同一张图。
 * 只在失败时加，正常路径不多花一个字节。
 */
export function measureImage(src: string, timeoutMs = 15000): Promise<{ loaded: boolean; width?: number; height?: number }> {
  return attemptLoad(src, timeoutMs).then((r) => {
    if (r.loaded || src.startsWith('data:')) return r
    return attemptLoad(bustCache(src), timeoutMs)
  })
}

/** 加一个一次性参数。已经带了 query 的用 `&`，否则用 `?` */
function bustCache(src: string): string {
  const sep = src.includes('?') ? '&' : '?'
  return `${src}${sep}audit=${Date.now().toString(36)}`
}

function attemptLoad(
  src: string,
  timeoutMs: number,
): Promise<{ loaded: boolean; width?: number; height?: number }> {
  return new Promise((resolve) => {
    const img = new Image()
    let done = false
    const finish = (r: { loaded: boolean; width?: number; height?: number }) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(r)
    }
    const timer = setTimeout(() => finish({ loaded: false }), timeoutMs)
    img.referrerPolicy = 'no-referrer'
    img.onload = () => finish({ loaded: true, width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => finish({ loaded: false })
    img.src = src
  })
}

export type ProbeResult =
  | { ok: true; status: number; contentType?: string; bytes?: number; hotlink: boolean }
  | { ok: false; reason: 'no-proxy' | 'network'; message: string }

/**
 * 让 Worker 带着第三方 Referer 去取一次图，只读响应头，不读图片本体。
 *
 * 返回 `{status: 403}` 就是防盗链；`no-proxy` 表示 Functions 没部署
 * （本地 `npm run dev` 就是这个情况）—— 那属于「没查到」，不是「查出问题」。
 */
export async function probeImage(src: string, timeoutMs = 15000): Promise<ProbeResult> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(new DOMException('timeout', 'TimeoutError')), timeoutMs)
  try {
    const res = await fetch(`${PROXY}${encodeURIComponent(src)}&probe=1`, {
      signal: ctrl.signal,
      credentials: 'omit',
    })
    // 本地没跑 Functions 时，这个路径会落到 SPA 的 index.html（200 + text/html），
    // 或者干脆 404。两种都不是「体检结果」。
    const type = res.headers.get('content-type') ?? ''
    if (!type.includes('application/json')) {
      return { ok: false, reason: 'no-proxy', message: '图片代理不可用' }
    }
    const json = (await res.json()) as {
      status?: number
      contentType?: string | null
      bytes?: number | null
      hotlink?: boolean
    }
    return {
      ok: true,
      status: typeof json.status === 'number' ? json.status : 0,
      contentType: json.contentType ?? undefined,
      bytes: typeof json.bytes === 'number' ? json.bytes : undefined,
      // hotlink 由 Worker 判：它比客户端多知道一件事 ——
      // 「不带 Referer 那次是不是 200」。404 的图不该被报成防盗链。
      hotlink: json.hotlink === true,
    }
  } catch (e) {
    const isTimeout = e instanceof DOMException && e.name === 'TimeoutError'
    return {
      ok: false,
      reason: 'network',
      message: isTimeout ? '探测超时' : '探测失败',
    }
  } finally {
    clearTimeout(timer)
  }
}

export interface AuditRow extends ImageFacts {
  src: string
  issues: ImageIssue[]
  /**
   * 代理探测有没有真的跑通。
   * false 表示「没查到」而不是「查出问题」—— 本地 `npm run dev` 没有 Functions，
   * 这时不该把每张图都标成有毛病。
   */
  probed: boolean
}

/** 量尺寸 + 探代理，合成一份事实。任何一步失败都只填能确定的部分。 */
export async function auditImage(src: string, rule: ImageRule): Promise<AuditRow> {
  const remote = /^https?:\/\//i.test(src) || src.startsWith('//')

  // 本地路径没什么可量的：它本来就取不到，结论在 judge 里已经定了，
  // 再去发一个注定失败的请求只是让体检慢半拍。
  if (!remote && !src.startsWith('data:')) {
    return { src, issues: judge({}, rule, src), probed: false }
  }

  const size = await measureImage(src)
  const facts: ImageFacts = { loaded: size.loaded, width: size.width, height: size.height }
  let probed = false

  if (remote) {
    const probe = await probeImage(src)
    if (probe.ok) {
      probed = true
      // 只有「200 + 真是张图」才算取到了。404 的页面上也可能带着
      // content-length（错误页的字节数），拿它当图片体积会得出荒唐的结论。
      const isImage = probe.status === 200 && Boolean(probe.contentType)
      facts.reachable = isImage
      if (isImage) {
        facts.contentType = probe.contentType
        facts.bytes = probe.bytes
      }
      facts.hotlink = probe.hotlink
    }
  }

  return { src, ...facts, issues: judge(facts, rule, src), probed }
}
