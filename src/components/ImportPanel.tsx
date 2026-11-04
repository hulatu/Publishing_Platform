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
  const fileRef = useRef<HTMLInputElement>(null)

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
  }

  return (
    <div className="side-section">
      <div className="side-title">
        <span>导入文章</span>
        {currentName ? <span className="count">{currentName.slice(0, 22)}</span> : null}
      </div>

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
        <div className="dropzone-icon">↓</div>
        <div className="dropzone-main">把 .md 文件拖到这里</div>
        <div className="dropzone-hint">或点击选择文件</div>
      </div>

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

      <button className="paste-toggle" onClick={() => setPasteOpen((v) => !v)}>
        {pasteOpen ? '收起粘贴区' : '直接粘贴 Markdown'}
      </button>

      {pasteOpen ? (
        <>
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
        </>
      ) : null}
    </div>
  )
}
