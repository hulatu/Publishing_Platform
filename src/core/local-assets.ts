/**
 * 拖进来的文件
 *
 * 只做两件事：从拖放事件里把文件（含文件夹）读出来，判断哪个是 .md。
 *
 * 这里**不收集图片**。图片归作者自己的图床管 —— 这个工具只读 md 里的链接，
 * 不上传、不改写、也不猜「这张本地图对应正文哪一处」。少一层猜测，
 * 就少一种「传错图还是静默的」事故。
 */

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|svg|avif|bmp)$/i

export function isImageFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true
  return IMAGE_EXT.test(file.name)
}

export function isMarkdownFile(file: File): boolean {
  return /\.(md|markdown|txt)$/i.test(file.name)
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
  // 否则超过 100 个文件的目录会被悄悄截断 —— 而截断的位置正好可能是那个 .md
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
