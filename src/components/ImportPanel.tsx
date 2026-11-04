import { useRef, useState, type DragEvent } from 'react'

interface Props {
  currentName: string
  onLoad: (source: string, fileName: string) => void
  onError: (message: string) => void
}

export function ImportPanel({ currentName, onLoad, onError }: Props) {
  const [over, setOver] = useState(false)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  /** 已经导入过就收起成一行 —— 侧栏的空间要留给平台导航 */
  const [reopen, setReopen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

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
    const text = await file.text()
    onLoad(text, file.name)
    setReopen(false)
  }

  const handleDrop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) void readFile(file)
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
            <span className="dropzone-hint">或点击选择文件</span>
          </div>

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
    </div>
  )
}
