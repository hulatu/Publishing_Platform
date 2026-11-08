/**
 * 卡片导出
 *
 * 封装成 renderCardToBlob(node) —— 将来若要换成 satori + resvg（确定性更好、
 * 可内嵌字体、能服务端批量），只需要改这个文件，UI 与模板都不用动。
 *
 * 尺寸策略：模板按各比例的 CSS 尺寸排版（3:4 是 540×720），导出 pixelRatio: 2，
 * 正好是 1080×1440 小红书标准。不用「1080 CSS × 2x」，那样内存翻四倍，Safari 容易崩。
 *
 * ⚠️ 尺寸必须由 format 显式算出来传给 html-to-image，绝不能让它自己去量节点。
 * html-to-image 默认用 `node.clientWidth/clientHeight` 当导出尺寸，而离屏渲染层是
 * `position: fixed; left: -20000px` 的收缩宽度容器 —— 它的宽度等于最宽的那张卡
 * （16:9 的 960），于是每一张卡的父 div 都是 960 宽：选 3:4 导出得到 1920×1440（4:3），
 * 选 1:1 得到 1920×1280，只有 16:9 恰好正确。这个错误不报错、不空白，
 * 界面上还写着「已导出 1080×1440」，只有拿到图才发现比例不对。
 * 现在 width/height 由 getCardFormat() 给出，并在导出后回读 PNG 头核对。
 *
 * 依赖全部动态 import：html-to-image 和 jszip 加起来 35KB gzip，
 * 只有点了「导出」才用得上，没理由让它们拖慢首屏。
 */

import { getCardFormat, layoutNames, type CardFormatId, type CardSpec } from './types'

/** 成品像素 = CSS 尺寸 × 2 */
export const EXPORT_RATIO = 2

export interface ExportOptions {
  backgroundColor: string
  pixelRatio?: number
}

export interface CardExportOptions extends ExportOptions {
  /** 卡片比例。导出像素由它算出来，不读节点实际布局尺寸 */
  format: CardFormatId
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(',')
  const mime = /:(.*?);/.exec(head)?.[1] ?? 'image/png'
  const binary = atob(body)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

/** 导出后回读 PNG 头里的真实像素，用来核对尺寸（也用来让提示文案不撒谎） */
export interface PixelSize {
  w: number
  h: number
}

export async function readPngSize(blob: Blob): Promise<PixelSize | null> {
  // PNG 头固定：8 字节签名 + 4 字节块长 + 'IHDR' + 宽(4) + 高(4)
  if (blob.size < 24) return null
  const head = new Uint8Array(await blob.slice(0, 24).arrayBuffer())
  if (head[0] !== 0x89 || head[1] !== 0x50 || head[2] !== 0x4e || head[3] !== 0x47) return null
  const dv = new DataView(head.buffer, head.byteOffset, head.byteLength)
  return { w: dv.getUint32(16), h: dv.getUint32(20) }
}

/** 把卡片节点渲染成 PNG Blob。Safari 偶发整张空白，失败时自动重试一次。 */
export async function renderCardToBlob(node: HTMLElement, opts: CardExportOptions): Promise<Blob> {
  const { backgroundColor, format, pixelRatio = EXPORT_RATIO } = opts
  const f = getCardFormat(format)
  const { toPng } = await import('html-to-image')

  const run = () =>
    toPng(node, {
      pixelRatio,
      backgroundColor,
      // 显式给尺寸：不传就会去量父容器的宽度，3:4 和 1:1 都会被拉成 16:9 的 960 宽
      width: f.w,
      height: f.h,
      // 系统字体无需内嵌；开启字体内嵌会尝试抓取 @font-face，
      // 跨域字体一旦失败整张图就是空白
      skipFonts: true,
      cacheBust: false,
    })

  let dataUrl: string
  try {
    dataUrl = await run()
  } catch {
    // 等一帧再试：Safari 的 foreignObject 首帧偶发全白
    await new Promise((r) => setTimeout(r, 120))
    dataUrl = await run()
  }

  const blob = dataUrlToBlob(dataUrl)

  // 尺寸是这一层的硬约定，错了就是错的图 —— 宁可报错，也别把 4:3 当 3:4 交出去
  const want = { w: f.w * pixelRatio, h: f.h * pixelRatio }
  const got = await readPngSize(blob)
  if (got && (got.w !== want.w || got.h !== want.h)) {
    throw new Error(`导出尺寸异常：期望 ${want.w}×${want.h}，实际 ${got.w}×${got.h}`)
  }

  return blob
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export interface ZipEntry {
  node: HTMLElement
  name: string
  /** 这一张按哪个比例导，决定成品像素 */
  format: CardFormatId
  /** 子目录名（多尺寸导出时按 3x4 / 1x1 / 16x9 分开放） */
  folder?: string
}

export interface ZipResult {
  /** 成功写进 zip 的张数 */
  ok: number
  /** 渲染失败、被跳过的张数 */
  failed: number
  /** 第一张失败的错误信息，用于提示 */
  firstError?: string
}

/**
 * 批量导出为 zip —— 逐张触发下载会被浏览器拦截。
 *
 * 单张渲染失败不能让整批作废：20 张导到第 15 张崩掉时，
 * 用户已经等了快一分钟，至少要把前 14 张给他。
 */
export async function exportCardsAsZip(
  entries: ZipEntry[],
  zipName: string,
  opts: ExportOptions,
  onProgress?: (done: number, total: number) => void,
): Promise<ZipResult> {
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  let ok = 0
  let failed = 0
  let firstError: string | undefined

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    try {
      const blob = await renderCardToBlob(entry.node, { ...opts, format: entry.format })
      const target = entry.folder ? (zip.folder(entry.folder) ?? zip) : zip
      target.file(entry.name, blob)
      ok++
    } catch (e) {
      failed++
      firstError ??= e instanceof Error ? e.message : String(e)
    }
    onProgress?.(i + 1, entries.length)
  }

  if (ok === 0) {
    throw new Error(firstError ?? '所有卡片都渲染失败')
  }

  const out = await zip.generateAsync({ type: 'blob' })
  downloadBlob(out, zipName)
  return { ok, failed, firstError }
}

/** 生成安全的文件名 */
export function safeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 60)
  // 标题全被过滤掉时别产出「-配图.zip」这种以连字符开头的名字
  return cleaned || '未命名'
}

/* ------------------------------------------------------------------ */
/* 卡片文件名                                                          */
/* ------------------------------------------------------------------ */

/**
 * 文件名里标题部分的上限。标题是同一篇共有的前缀，留着便于辨认，
 * 但编号必须排在最前面 —— 文件选择器会把超长文件名截断，
 * 编号一旦落在中后段就可能被截掉，那这个编号就白加了。
 */
const NAME_TITLE_MAX = 16
/** 小节标题同理，而且它本身就是文件名里最容易失控的部分 */
const NAME_SECTION_MAX = 18

/** 编号：补零到两位，否则按名称排序时 10 会排到 2 前面 */
export function cardNo(n: number): string {
  return String(n).padStart(2, '0')
}

/** 断句用的标点：截断时优先在这里断开，别把词切成两半 */
const CLIP_AT = ['，', '：', '、', '。', '；', '｜', ' ']

/**
 * 截到 n 字。能断在标点上就断在标点（并丢掉那个标点），
 * 否则硬截 —— `一、文章分发台：一篇稿子，十一种形态` 截到 18 字刚好整句，
 * 截到 14 字则退到「一、文章分发台：一篇稿子」，比「…一篇稿」好看得多。
 */
function clip(text: string, n: number): string {
  if (text.length <= n) return text
  const head = text.slice(0, n)
  const at = Math.max(...CLIP_AT.map((p) => head.lastIndexOf(p)))
  // 断点太靠前（不到 60%）就没有意义，宁可硬截也别把整句砍成一个词
  return (at >= Math.floor(n * 0.6) ? head.slice(0, at) : head).trim()
}

/**
 * 单张卡片导出的文件名（不含扩展名），形如「01-标题-封面」「04-标题-小节标题」。
 *
 * 一套图是「封面 → 各小节 → 结尾」，上传时要按顺序挑，可卡片上的页码
 * （01 / 08）只印在图里 —— 挑文件的时候看不见。所以编号必须进文件名，
 * 而且要补零：文件管理器和小红书的多选都按名称排序，`10` 排在 `2` 前面
 * 就全乱了。编号放最前面而不是紧跟标题，是因为文件名一旦被文件选择器
 * 截断，末尾的编号会先没；放最前面无论怎么截都还在。
 */
export function cardFileName(
  spec: Pick<CardSpec, 'layout' | 'title'>,
  /** 从 0 开始的卡片序号 */
  index: number,
  articleTitle: string,
): string {
  const head = clip(safeFileName(articleTitle), NAME_TITLE_MAX).trim() || '未命名'
  const tail =
    spec.layout === 'section'
      ? clip(safeFileName(spec.title), NAME_SECTION_MAX).trim() || layoutNames.section
      : layoutNames[spec.layout]
  return `${cardNo(index + 1)}-${head}-${tail}`
}
