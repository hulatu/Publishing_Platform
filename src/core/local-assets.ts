/**
 * 本地图片资源
 *
 * 拖一个文件夹进来时，md 里的 `./images/a.jpg` 和磁盘上的 `images/a.jpg`
 * 是两回事：前者是作者写的一串字符，后者是真实的字节。这个模块负责把两者对上。
 *
 * 匹配从严到宽三档，因为「严」的那档最不容易配错：
 *   1. 完整相对路径相等        images/a.jpg  ==  images/a.jpg
 *   2. 结尾匹配                拖的是整个博客目录时，路径会带前缀 post/images/a.jpg
 *   3. 文件名唯一匹配          只拖了几张图、md 里写的是 ../images/a.jpg
 *
 * 第 3 档必须要求「唯一」：两篇文章各有一张 `1.jpg` 是常态，
 * 名字撞了就宁可不匹配、让用户自己指，也不能传错图 —— 传错了是静默的，
 * 用户直到发出去才发现封面变成了别人的图。
 */

export interface AssetFile {
  /** 相对根目录的路径（拖文件夹时来自 webkitRelativePath，单独选时就是文件名） */
  path: string
  file: File
}

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|svg|avif|bmp)$/i

export function isImageFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true
  return IMAGE_EXT.test(file.name)
}

export function isMarkdownFile(file: File): boolean {
  return /\.(md|markdown|txt)$/i.test(file.name)
}

function pathOf(file: File): string {
  // webkitRelativePath 只在「选文件夹」或「拖目录」时有值
  const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath
  return (rel && rel.trim()) || file.name
}

export function collectAssets(files: File[]): AssetFile[] {
  return files
    .filter(isImageFile)
    .map((file) => ({ path: pathOf(file).replace(/^\.\//, ''), file }))
}

function baseName(path: string): string {
  const parts = path.split('/')
  return parts[parts.length - 1] ?? path
}

/**
 * 给一个 md 里的 src 找对应的本地文件。找不到返回 null。
 *
 * `src` 应当已经过 normalizeSrc 处理（去掉 ./、前导 /、query）。
 */
export function matchAsset(normalizedSrc: string, assets: AssetFile[]): AssetFile | null {
  if (!normalizedSrc) return null

  // 1. 完整路径相等
  const exact = assets.find((a) => a.path === normalizedSrc)
  if (exact) return exact

  // 2. 结尾匹配：/post/images/a.jpg 以 images/a.jpg 结尾
  const suffix = `/${normalizedSrc}`
  const bySuffix = assets.filter((a) => a.path.endsWith(suffix))
  if (bySuffix.length === 1) return bySuffix[0]

  // 3. 文件名唯一匹配
  const name = baseName(normalizedSrc)
  const byName = assets.filter((a) => baseName(a.path) === name)
  if (byName.length === 1) return byName[0]

  return null
}

/* ------------------------------------------------------------------ */
/* 拖放读取                                                            */
/* ------------------------------------------------------------------ */

interface FsEntry {
  isFile: boolean
  isDirectory: boolean
  fullPath: string
  file?: (ok: (f: File) => void, err?: (e: unknown) => void) => void
  createReader?: () => {
    readEntries: (ok: (entries: FsEntry[]) => void, err?: (e: unknown) => void) => void
  }
}

function readFileEntry(entry: FsEntry): Promise<File | null> {
  return new Promise((resolve) => {
    if (!entry.file) return resolve(null)
    entry.file(
      (f) => resolve(f),
      () => resolve(null),
    )
  })
}

async function readDirEntry(entry: FsEntry, out: File[]): Promise<void> {
  if (!entry.createReader) return
  const reader = entry.createReader()
  // readEntries 一次最多返回 100 条，必须循环读到空数组为止，
  // 否则超过 100 张图的目录会被悄悄截断
  for (;;) {
    const batch = await new Promise<FsEntry[]>((resolve) => {
      reader.readEntries(
        (entries) => resolve(entries),
        () => resolve([]),
      )
    })
    if (batch.length === 0) break
    for (const e of batch) {
      if (e.isFile) {
        const f = await readFileEntry(e)
        if (f) out.push(f)
      } else if (e.isDirectory) {
        await readDirEntry(e, out)
      }
    }
  }
}

/**
 * 从拖放事件里读出所有文件，目录会递归展开。
 *
 * 不能只看 `dataTransfer.files`：拖一个文件夹进来时它在多数浏览器里是空的
 * 或者只有一层，必须走 `webkitGetAsEntry`。这也是为什么这个函数是 async 的。
 */
export async function readDataTransfer(dt: DataTransfer): Promise<File[]> {
  const items = dt.items ? [...dt.items] : []
  const entries = items
    .map((it) => (typeof it.webkitGetAsEntry === 'function' ? (it.webkitGetAsEntry() as unknown as FsEntry | null) : null))
    .filter((e): e is FsEntry => Boolean(e))

  if (entries.length === 0) return [...dt.files]

  const out: File[] = []
  for (const e of entries) {
    if (e.isFile) {
      const f = await readFileEntry(e)
      if (f) out.push(f)
    } else if (e.isDirectory) {
      await readDirEntry(e, out)
    }
  }
  return out
}

/* ------------------------------------------------------------------ */
/* 改写 Markdown                                                       */
/* ------------------------------------------------------------------ */

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * 把正文里指定的图片地址换掉。
 *
 * 只在「图片语法里」替换，不做全局字符串替换 —— `images/a.jpg` 这种串
 * 完全可能出现在正文的代码块或说明文字里，全局换会把文章改坏。
 *
 * 支持两种写法：
 *   ![alt](./images/a.jpg "标题")
 *   <img src="./images/a.jpg">
 */
export function rewriteImageSrc(md: string, mapping: Map<string, string>): string {
  if (mapping.size === 0) return md
  let out = md
  for (const [from, to] of mapping) {
    if (!from || from === to) continue
    const re = escapeRe(from)

    // Markdown 图片：![alt](src) 或 ![alt](src "title")
    out = out.replace(
      new RegExp(`(!\\[[^\\]]*\\]\\()${re}(\\s+(?:"[^"]*"|'[^']*'))?\\)`, 'g'),
      (_m, head: string, title?: string) => `${head}${to}${title ?? ''})`,
    )

    // HTML img：属性顺序不定，只认 src 本身
    out = out.replace(new RegExp(`(<img\\b[^>]*?\\bsrc=["'])${re}(["'])`, 'gi'), (_m, head: string, tail: string) => `${head}${to}${tail}`)
  }
  return out
}
