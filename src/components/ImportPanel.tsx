import { useRef, useState, type DragEvent } from 'react'
import { decodeText, looksMojibake } from '../core/text'
import { isImageFile, isMarkdownFile, readDataTransfer } from '../core/local-assets'

interface Props {
  currentName: string
  onLoad: (source: string, fileName: string) => void
  onError: (message: string) => void
  /** 非错误的提示，比如「这份文件是 GBK 编码，已自动转换」 */
  onNotice?: (message: string) => void
}

export function ImportPanel({ currentName, onLoad, onError, onNotice }: Props) {
  const [over, setOver] = useState(false)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  /** 已经导入过就收起成一行 —— 侧栏的空间要留给平台导航 */
  const [reopen, setReopen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const dirRef = useRef<HTMLInputElement>(null)

  const compact = Boolean(currentName) && !reopen

  const readFile = async (file: File) => {
    if (!/\.(md|markdown|txt)$/i.test(file.name)) {
      onError('只支持 .md / .markdown / .txt 文件')
      return
    }
    if (file.size > 4 * 1024 * 1024) {
      onError('文件超过 4MB，请检查是否选错')
      return
    }
    // 不能直接 file.text()：它按 UTF-8 硬解且不报错，
    // 一份 GBK 的 .md 会变成满屏乱码还照常「解析成功」
    const { text, encoding } = decodeText(new Uint8Array(await file.arrayBuffer()))
    if (encoding !== 'utf-8') {
      onNotice?.(`「${file.name}」是 ${encoding === 'gb18030' ? 'GBK' : encoding} 编码，已自动转换`)
    } else if (looksMojibake(text)) {
      // 文件本身是合法 UTF-8，但内容就是乱码（比如把 GBK 文本粘进了 UTF-8 文件）。
      // 这种情况自动转码救不回来，只能提醒用户回头查源头
      onNotice?.('正文看起来是乱码，可能是复制粘贴时用了错误的编码，建议检查原文')
    }
    onLoad(text, file.name)
    setReopen(false)
  }

  /** 一批文件里挑出 .md。拖文件夹和选文件夹都走这里 */
  const applyFiles = async (files: File[]) => {
    const md = files.find(isMarkdownFile)
    if (!md) {
      onError(
        files.some(isImageFile)
          ? '这一批里只有图片，还差一个 .md 文件'
          : '没找到 .md 文件',
      )
      return
    }
    await readFile(md)
  }

  const handleDrop = async (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    // 拖文件夹时 dataTransfer.files 可能只有一层甚至是空的，
    // 必须走 webkitGetAsEntry 递归读，所以这里不能同步取 files[0]
    const files = await readDataTransfer(e.dataTransfer)
    if (files.length === 0) {
      onError('没读到文件。如果是文件夹，试试点下面的「选文件夹」')
      return
    }
    await applyFiles(files)
  }

  const handlePaste = () => {
    if (!pasteText.trim()) {
      onError('粘贴区是空的')
      return
    }
    onLoad(pasteText, 'paste.md')
    setPasteText('')
    setPasteOpen(false)
    setReopen(false)
  }

  return (
    <div className="side-section">
      <div className="side-title">
        <span>文章</span>
        {currentName && reopen ? <span className="count">{currentName.slice(0, 22)}</span> : null}
      </div>

      {compact ? (
        <button className="file-row" onClick={() => setReopen(true)} title="换一篇">
          <span className="file-row-icon">MD</span>
          <span className="file-row-name">{currentName}</span>
          <span className="file-row-swap">换一篇</span>
        </button>
      ) : (
        <>
          <div
            className={`dropzone ${over ? 'over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault()
              setOver(true)
            }}
            onDragLeave={() => setOver(false)}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
          >
            <span className="dropzone-icon" aria-hidden>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M12 16V4M12 4l-4 4M12 4l4 4" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" strokeLinecap="round" />
              </svg>
            </span>
            <span className="dropzone-main">把 .md 拖到这里</span>
            <span className="dropzone-hint">拖整个文件夹也行，会自动找出里面的 .md</span>
          </div>

          {/* 单文件入口：点拖放区也能选文件，但那不明显。文件夹 input 选单个 .md 没反应
              （directory 模式只要文件夹），所以单文件要一个自己的按钮 */}
          <button className="paste-toggle" onClick={() => fileRef.current?.click()}>
            选择 .md 文件
          </button>

          <button className="paste-toggle" onClick={() => dirRef.current?.click()}>
            选文件夹（自动找 .md）
          </button>

          <button className="paste-toggle" onClick={() => setPasteOpen((v) => !v)}>
            {pasteOpen ? '收起粘贴区' : '直接粘贴 Markdown'}
          </button>

          {pasteOpen ? (
            <div className="paste-wrap">
              <textarea
                className="paste-area"
                placeholder="把 Markdown 全文粘贴到这里，包含 --- 包裹的 front matter 也可以…"
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
              />
              <div className="paste-actions">
                <button className="btn btn-sm btn-primary" onClick={handlePaste}>
                  解析这篇文章
                </button>
                <button className="btn btn-sm" onClick={() => setPasteText('')}>
                  清空
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}

      <input
        ref={fileRef}
        type="file"
        accept=".md,.markdown,.txt"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void readFile(file)
          e.target.value = ''
        }}
      />

      {/* 选文件夹：md 和图片一次给齐。webkitdirectory 是 Chromium / Safari 的私有属性，
          React 的类型里没有，只能绕过类型检查挂上去 */}
      <input
        ref={dirRef}
        type="file"
        className="hidden"
        {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          if (files.length > 0) void applyFiles(files)
          e.target.value = ''
        }}
      />
    </div>
  )
}
