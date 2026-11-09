/**
 * 按平台导出图片
 *
 * 目标只有一个：把 md 里的外链图片，转成「这个平台后台上传时最不容易出问题」的形态。
 *
 * 三条边界，先说清楚：
 *
 * 1. **不碰 md**。正文里的链接原样保留 —— 图床是你的，地址也是你的。
 *    这里只产出文件，不改写文章。
 * 2. **不碰服务器**。全部在浏览器里用 canvas 转，图片不出本机。
 * 3. **不确定的就不做**。动图（GIF）重编码会丢动画，所以一律原样输出，
 *    只在清单里说明「这张超了但没压」。宁可交一张超标的原图，
 *    也不能交一张变成静止画面的「优化过」的图 —— 后者是静默的数据损坏。
 *
 * 为什么必须走 blob 再画 canvas：
 * 直接 `img.src = 'https://img.hulatu.com/...'` 画到 canvas 上，canvas 会被
 * 跨域污染（tainted），`toBlob()` 直接抛 SecurityError。图床开不开 CORS 决定成败，
 * 而大多数自建图床（含 R2 自定义域名）默认不发 Access-Control-Allow-Origin。
 * 先用 fetch 拿到 blob，再 `URL.createObjectURL(blob)` —— blob URL 与页面同源，
 * 画进去不会污染。取 blob 这一步本身可以走同源代理，所以整条链路都不依赖图床配置。
 */

/* ------------------------------------------------------------------ */
/* 平台规则                                                            */
/* ------------------------------------------------------------------ */

export interface ExportRule {
  /** 输出体积上限（字节）。0 表示不限 */
  maxBytes: number
  /** 最长边上限（像素）。超过就等比缩 */
  maxEdge: number
  /** 需要裁成这个比例（宽, 高），按中心裁切 */
  ratio?: [number, number]
  /** 一律铺白底转 JPEG（平台不认透明） */
  flatten?: boolean
  /** 为什么有这些限制 —— 显示在面板上，省得用户以为是工具瞎改 */
  note: string
}

const MB = 1024 * 1024

/**
 * 2 MB 这条线和体检用的是同一条，不是巧合：体检说「偏大」的那张，
 * 导出时正好就是会被压的那张。两个数字对不上，用户会以为其中一个在瞎报。
 */
const RULES: Partial<Record<string, ExportRule>> = {
  wechat: {
    maxBytes: 2 * MB,
    // 公众号正文显示宽度约 677px，2 倍图 1354 已经够；留到 1920 是为了
    // 读者点开大图时不糊，再大就只是白白占体积
    maxEdge: 1920,
    flatten: true,
    note: '公众号会把正文图片转存到自己的 CDN：超过 2 MB 容易转存失败，透明底会变黑，SVG 会被剥掉。',
  },
  xiaohongshu: {
    maxBytes: 2 * MB,
    maxEdge: 1920,
    ratio: [3, 4],
    note: '小红书首图是 3:4 竖图，横图会被居中裁掉两边；这里提前裁好，所见即所得。',
  },
}

const DEFAULT_RULE: ExportRule = {
  maxBytes: 0,
  maxEdge: 0,
  note: '这个平台没有已知的图片限制，原样导出。',
}

export function exportRule(platform: string): ExportRule {
  return RULES[platform] ?? DEFAULT_RULE
}

/* ------------------------------------------------------------------ */
/* 取图                                                                */
/* ------------------------------------------------------------------ */

/**
 * 同源图片代理。图床只服务 `<img>`、不发 Access-Control-Allow-Origin 时，
 * fetch 会被浏览器拦掉；`<img>` 却照常显示 —— 所以「预览正常、下载全红」。
 * 这个路径由 Pages Function 转发并补上 CORS 头。
 */
const PROXY = '/api/img?u='

const IMAGE_TIMEOUT = 15_000

/** 并发度。取 3 而不是浏览器的 6，是不想同时向同一个图床开满连接 —— 容易被当成爬虫。 */
export const IMAGE_CONCURRENCY = 3

async function fetchOnce(url: string): Promise<Blob> {
  // AbortSignal.timeout 在 Safari 16 以下没有，直接用会抛 TypeError，
  // 结果被当成「跨域失败」—— 提示全错。手动兜一层。
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(new DOMException('timeout', 'TimeoutError')), IMAGE_TIMEOUT)
  try {
    const res = await fetch(url, { mode: 'cors', credentials: 'omit', signal: ctrl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const blob = await res.blob()
    if (!blob.type.startsWith('image/')) throw new Error('不是图片')
    return blob
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 超时重试一次。
 *
 * 只重试超时：CORS 被拦和网络失败在浏览器里都是同一个 TypeError，
 * 分不出来，重试也是白等 15 秒。而超时是明确信号 —— 图床慢一下很常见。
 */
export async function fetchImage(url: string): Promise<Blob> {
  try {
    try {
      return await fetchOnce(url)
    } catch (err) {
      const isTimeout = err instanceof DOMException && err.name === 'TimeoutError'
      if (!isTimeout) throw err
      return await fetchOnce(url)
    }
  } catch {
    // 直连不行就走同源代理再试一次。
    // 代理不可用时（本地没跑 Functions、域名不在白名单）这里会再抛，
    // 由上层把这张标成「跨域」。
    return await fetchOnce(PROXY + encodeURIComponent(url))
  }
}

/* ------------------------------------------------------------------ */
/* 计划（纯函数，可测）                                                */
/* ------------------------------------------------------------------ */

export interface SourceFacts {
  bytes?: number
  contentType?: string
  width?: number
  height?: number
  /** URL 里的扩展名，已归一（jpeg → jpg） */
  urlExt?: string
}

export interface ExportStep {
  kind: 'resize' | 'crop' | 'compress' | 'flatten' | 'rasterize' | 'skip'
  /** 一句话说明，写进清单 */
  text: string
}

/**
 * 哪些格式可能有透明通道。
 *
 * 只对它们做「铺白底」：JPEG / BMP / TIFF 本来就没有 alpha，把它们也重编码一遍
 * 只会白白损失质量 —— 实测一张 195 KB 的 JPEG 铺完白底变成 250 KB，
 * 「优化」之后更大了，这是最糟的一种改动。
 */
const MAY_HAVE_ALPHA = /^image\/(png|webp|avif|gif|svg\+xml)$/

/**
 * 决定这张图要做什么，以及为什么。
 *
 * 顺序：能不能转 → 尺寸 → 比例 → 体积。前一条否决时后面不再叠加 ——
 * 「压不了」的时候再说「我帮你裁成 3:4」是自相矛盾。
 */
export function planExport(facts: SourceFacts, rule: ExportRule): ExportStep[] {
  const steps: ExportStep[] = []
  const type = (facts.contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? ''

  // 动图：canvas 只能取第一帧，压了就是把它变成静图。这个损失比「体积超标」大得多。
  if (type === 'image/gif') {
    // 没超限就是「什么都不用做」，不该报成「没处理」—— 正常的动图不该被当成问题
    if (rule.maxBytes > 0 && typeof facts.bytes === 'number' && facts.bytes > rule.maxBytes) {
      steps.push({
        kind: 'skip',
        text: `动图 ${fmtSize(facts.bytes)}，超过 ${fmtSize(rule.maxBytes)}，但重编码会丢动画 —— 原样导出，请手动处理`,
      })
    }
    return steps
  }

  // SVG：平台会剥掉，转成位图才显示得出来。尺寸未知时栅格化会得到一张 300×150 的图，
  // 不如不做 —— 交给用户判断。
  if (type === 'image/svg+xml' || facts.urlExt === 'svg') {
    if (facts.width && facts.height) {
      steps.push({ kind: 'rasterize', text: 'SVG 转成 PNG（平台会剥掉矢量图）' })
    } else {
      steps.push({ kind: 'skip', text: 'SVG 读不到尺寸，没法可靠栅格化 —— 原样导出' })
      return steps
    }
  }

  const w = facts.width ?? 0
  const h = facts.height ?? 0
  const longEdge = Math.max(w, h)

  if (rule.maxEdge > 0 && longEdge > rule.maxEdge) {
    steps.push({ kind: 'resize', text: `长边 ${longEdge} → ${rule.maxEdge}` })
  }

  if (rule.ratio && w > 0 && h > 0) {
    const want = rule.ratio[0] / rule.ratio[1]
    const got = w / h
    // 容差 3%：1080×1440 和 1080×1439 这种手抖不该被裁一刀
    if (Math.abs(got - want) / want > 0.03) {
      steps.push({ kind: 'crop', text: `裁成 ${rule.ratio[0]}:${rule.ratio[1]}（原 ${w}×${h}）` })
    }
  }

  // 只在「可能真的有透明」时才铺白。JPEG 重编码一遍只会更糊、更大
  if (rule.flatten && MAY_HAVE_ALPHA.test(type)) {
    steps.push({ kind: 'flatten', text: '透明区域铺白底（JPEG 不支持透明）' })
  }

  if (rule.maxBytes > 0 && typeof facts.bytes === 'number' && facts.bytes > rule.maxBytes) {
    steps.push({ kind: 'compress', text: `压到 ${fmtSize(rule.maxBytes)} 以内（原 ${fmtSize(facts.bytes)}）` })
  }

  return steps
}

export function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/* ------------------------------------------------------------------ */
/* 转码                                                                */
/* ------------------------------------------------------------------ */

export interface ExportOutcome {
  blob: Blob
  /** 输出扩展名（不含点） */
  ext: string
  /** 实际做了什么，写进清单 */
  done: string[]
  /** 做不了的事 */
  skipped: string[]
}

/**
 * 像素总量兜底。
 *
 * 4000 万像素约等于 8000×5000 —— 再大的图 canvas 会直接分配失败，
 * 或者把标签页拖死。缩到这个量级以内的代价肉眼看不出来（导出后照样是高清图），
 * 但能保证「点了导出不会卡死」。
 */
const MAX_PIXELS = 40_000_000

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob)
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('这张图解不开（可能不是真正的图片，或者文件已损坏）'))
    }
    img.src = url
  })
}

/** 抽样看有没有透明像素。全图逐像素扫在 2000 万像素的图上是几秒的事，不值得。 */
function hasAlpha(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  try {
    const step = Math.max(1, Math.floor(Math.max(w, h) / 64))
    const data = ctx.getImageData(0, 0, w, h).data
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        if (data[(y * w + x) * 4 + 3] < 250) return true
      }
    }
  } catch {
    // 读不到像素（被污染了）就当没有透明 —— 走 JPEG 也不会出错
  }
  return false
}

function encode(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('编码失败'))),
      type,
      quality,
    )
  })
}

/** `image/png` → `PNG`，只用在清单里的「换了格式」那一行 */
function shortType(type: string): string {
  const sub = type.split('/')[1] ?? type
  return sub.replace('+xml', '').toUpperCase()
}

/**
 * 把一张图转成目标形态。
 *
 * 压缩是「先降质量、再缩边」的两段式：
 * JPEG 质量从 0.85 一路降到 0.4，还超标才缩边重来。
 * 先降质量是因为它对观感的伤害比缩边小得多 —— 缩边是不可逆的信息丢失。
 */
export async function transcode(blob: Blob, rule: ExportRule, facts: SourceFacts): Promise<ExportOutcome> {
  const type = (blob.type || facts.contentType || '').split(';')[0]?.trim().toLowerCase() ?? ''
  // 字节数以 blob 为准：体检那一轮可能还没跑完，也可能因为取图被拒而没量到。
  // blob.size 是手上这份文件的确切大小，比任何探测结果都可靠。
  const bytes = typeof facts.bytes === 'number' ? facts.bytes : blob.size
  const base: SourceFacts = { ...facts, bytes, contentType: type }

  // 动图不解码 —— 解出来只有第一帧，等于把动画毁了。只在体积上给结论。
  if (type === 'image/gif') {
    const skipped = planExport(base, rule)
      .filter((s) => s.kind === 'skip')
      .map((s) => s.text)
    return { blob, ext: extOfBlob(blob, facts.urlExt), done: [], skipped }
  }

  const img = await loadImage(blob)
  const url = img.src
  try {
    const w0 = img.naturalWidth
    const h0 = img.naturalHeight
    if (!w0 || !h0) {
      // 读不到尺寸就没法安全地缩放/裁切，交给用户判断
      return { blob, ext: extOfBlob(blob, facts.urlExt), done: [], skipped: ['读不到像素尺寸，原样导出'] }
    }

    // 用**解码后的真实尺寸**重新规划：调用方传进来的 facts 可能缺尺寸（没体检过），
    // 而 loadImage 已经把准确值拿到了。拿它再判一次，才不会漏掉该缩的图。
    const full: SourceFacts = { ...base, width: w0, height: h0 }
    const steps = planExport(full, rule)
    const skipped = steps.filter((s) => s.kind === 'skip').map((s) => s.text)

    // 一条要做的都没有 → 原样交出去。
    // 这一步是「不做无谓的重编码」的关键：一张 195 KB 的 JPEG 重新编码一遍
    // 只会变成 250 KB，质量还降了。
    if (steps.length === 0) {
      return { blob, ext: extOfBlob(blob, facts.urlExt), done: [], skipped: [] }
    }

    const flatten = steps.some((s) => s.kind === 'flatten')

    // 1. 先算裁切窗口（按原始像素裁，避免先缩再裁导致的边缘糊）
    let sx = 0
    let sy = 0
    let sw = w0
    let sh = h0
    if (rule.ratio) {
      const want = rule.ratio[0] / rule.ratio[1]
      const got = w0 / h0
      if (Math.abs(got - want) / want > 0.03) {
        if (got > want) {
          sw = Math.round(h0 * want)
          sx = Math.round((w0 - sw) / 2)
        } else {
          sh = Math.round(w0 / want)
          sy = Math.round((h0 - sh) / 2)
        }
      }
    }

    // 2. 再算输出尺寸：长边上限 + 像素总量兜底，两个都取更严的那个
    let scale = 1
    if (rule.maxEdge > 0) scale = Math.min(scale, rule.maxEdge / Math.max(sw, sh))
    if (sw * sh * scale * scale > MAX_PIXELS) scale = Math.min(scale, Math.sqrt(MAX_PIXELS / (sw * sh)))
    scale = Math.min(scale, 1)

    let outW = Math.max(1, Math.round(sw * scale))
    let outH = Math.max(1, Math.round(sh * scale))

    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('这个浏览器不支持 canvas 转码')

    const draw = (w: number, h: number) => {
      canvas.width = w
      canvas.height = h
      // 缩小时用高质量插值；默认的 low 在大比例缩小时锯齿很明显
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.clearRect(0, 0, w, h)
      if (flatten) {
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, w, h)
      }
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h)
    }

    draw(outW, outH)

    const alpha = flatten ? false : hasAlpha(ctx, outW, outH)
    // 有透明就保 PNG（JPEG 会把透明画成黑块）；否则 JPEG —— 同样画质下小一半以上
    let outType = alpha ? 'image/png' : 'image/jpeg'

    let out = await encode(canvas, outType, 0.88)
    const done: string[] = []
    if (outW !== w0 || outH !== h0) done.push(`尺寸 ${w0}×${h0} → ${outW}×${outH}`)
    if (sx || sy) done.push('按中心裁切')
    // 换了格式要说 —— 一张 777 KB 的 PNG 变成 413 KB 的 JPEG，用户得知道为什么
    if (type && outType !== type) done.push(`${shortType(type)} → ${shortType(outType)}`)

    // 3. 体积：先降质量，到底了再缩边
    if (rule.maxBytes > 0 && out.size > rule.maxBytes) {
      const before = out.size
      let quality = 0.85
      let tried = 0
      while (out.size > rule.maxBytes && quality > 0.4 && tried < 8) {
        out = await encode(canvas, outType, quality)
        quality -= 0.1
        tried++
      }
      // PNG 的 quality 参数是摆设，压不动就换 JPEG 白底
      if (out.size > rule.maxBytes && outType === 'image/png') {
        outType = 'image/jpeg'
        draw(outW, outH)
        out = await encode(canvas, outType, 0.85)
        while (out.size > rule.maxBytes && quality > 0.4 && tried < 16) {
          out = await encode(canvas, outType, quality)
          quality -= 0.1
          tried++
        }
        // 格式变化会在下面统一记一笔，这里不重复
        if (!done.some((d) => d.includes('→ JPEG'))) done.push(`${shortType(type)} → JPEG（PNG 压不下来）`)
      }
      // 还不行就缩边，每次 85%
      let guard = 0
      while (out.size > rule.maxBytes && guard < 5) {
        outW = Math.max(320, Math.round(outW * 0.85))
        outH = Math.max(320, Math.round(outH * 0.85))
        draw(outW, outH)
        out = await encode(canvas, outType, 0.8)
        guard++
      }
      if (out.size <= rule.maxBytes) {
        done.push(`${fmtSize(before)} → ${fmtSize(out.size)}`)
      } else {
        skipped.push(`压到 ${fmtSize(rule.maxBytes)} 以内没成功，最后是 ${fmtSize(out.size)}`)
      }
    }

    return { blob: out, ext: outType === 'image/png' ? 'png' : 'jpg', done, skipped }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/* ------------------------------------------------------------------ */
/* 命名与清单                                                          */
/* ------------------------------------------------------------------ */

const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/pjpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
}

/**
 * 扩展名按**内容**取，不按 URL 取。
 *
 * 实测这个图床上 53 张 `.webp` 全是 JPEG 字节 —— 按 URL 命名会得到
 * `03.webp` 里装 JPEG，上传到按扩展名校验的地方就被拒。
 */
export function extOfBlob(blob: Blob, fallback?: string): string {
  const byType = EXT_BY_TYPE[blob.type.toLowerCase()]
  if (byType) return byType
  return fallback || 'jpg'
}

export function fileNameFor(index: number, ext: string): string {
  return `${String(index + 1).padStart(2, '0')}.${ext}`
}

export interface ManifestRow {
  name: string
  src: string
  alt: string
  /** 输出后的体积 */
  bytes: number
  /** 输出尺寸 */
  width?: number
  height?: number
  done: string[]
  skipped: string[]
}

/**
 * 清单。
 *
 * 为什么非要这个文件：zip 解开是一堆 `01.jpg`，光看文件名没法知道
 * 哪张对应文中哪个位置。上传到公众号后台时对不上号，就会传错顺序。
 */
export function manifestText(rows: ManifestRow[], platformLabel: string, when: string): string {
  const head = [
    `${platformLabel} · 正文图片 ${rows.length} 张`,
    `导出时间 ${when}`,
    '',
    '文件名按正文出现顺序编号，直接在平台后台上传即可。',
    '正文里的图片链接没有改动 —— 这份 zip 只是同一批图的本地副本。',
    '',
  ]

  const body: string[] = []
  for (const r of rows) {
    const size = r.width && r.height ? `${r.width}×${r.height}  ` : ''
    body.push(`${r.name}  ${size}${fmtSize(r.bytes)}`)
    body.push(`    原文说明：${r.alt || '（无）'}`)
    body.push(`    原图地址：${r.src}`)
    if (r.done.length > 0) body.push(`    已处理：${r.done.join('；')}`)
    if (r.skipped.length > 0) body.push(`    没处理：${r.skipped.join('；')}`)
    body.push('')
  }

  return [...head, ...body].join('\n')
}

/** 给面板用的一句话：这批图会被怎么处理 */
export function planSummary(rule: ExportRule): string {
  const parts: string[] = []
  if (rule.maxEdge > 0) parts.push(`长边超过 ${rule.maxEdge} 的缩到 ${rule.maxEdge}`)
  if (rule.ratio) parts.push(`不是 ${rule.ratio[0]}:${rule.ratio[1]} 的按中心裁`)
  if (rule.flatten) parts.push('有透明底的铺白')
  if (rule.maxBytes > 0) parts.push(`超过 ${fmtSize(rule.maxBytes)} 的压到这个数以内`)
  if (parts.length === 0) return '原样导出，不做任何处理。'
  return `${parts.join('，')}。动图（GIF）原样保留。`
}
