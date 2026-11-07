/**
 * 卡片导出
 *
 * 封装成 renderCardToBlob(node) —— 将来若要换成 satori + resvg（确定性更好、
 * 可内嵌字体、能服务端批量），只需要改这个文件，UI 与模板都不用动。
 *
 * 尺寸策略：模板按 540×720 CSS 像素排版，导出 pixelRatio: 2 → 1080×1440，
 * 正好是小红书 3:4 标准。不用「1080 CSS × 2x」，那样内存翻四倍，Safari 容易崩。
 *
 * 依赖全部动态 import：html-to-image 和 jszip 加起来 35KB gzip，
 * 只有点了「导出」才用得上，没理由让它们拖慢首屏。
 */

export interface ExportOptions {
  backgroundColor: string
  pixelRatio?: number
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(',')
  const mime = /:(.*?);/.exec(head)?.[1] ?? 'image/png'
  const binary = atob(body)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

/** 把卡片节点渲染成 PNG Blob。Safari 偶发整张空白，失败时自动重试一次。 */
export async function renderCardToBlob(node: HTMLElement, opts: ExportOptions): Promise<Blob> {
  const { backgroundColor, pixelRatio = 2 } = opts
  const { toPng } = await import('html-to-image')

  const run = () =>
    toPng(node, {
      pixelRatio,
      backgroundColor,
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

  return dataUrlToBlob(dataUrl)
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
      const blob = await renderCardToBlob(entry.node, opts)
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
