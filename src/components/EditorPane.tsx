/**
 * 中间栏：正文 Markdown 编辑器
 *
 * 这一栏只负责正文。front matter 里的标题/分类/标签/摘要仍然在左栏的
 * 「文章信息」里改 —— 两处都能改标题的话，改完一边另一边会静默覆盖，
 * 用户很难判断以谁为准。
 *
 * 编辑后的重新解析由 App 负责（350ms 防抖），这里只上抛文本。
 * 空态和载入后共用同一个 textarea：粘贴、拖入、选文件都落在这一个区域，
 * 不会出现「先在这里粘、导进来又要去左边找」的割裂。
 */

import {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from 'react'
import type { Doc } from '../core/ir'
import { charCount } from '../core/cjk'
import { decodeText, looksMojibake } from '../core/text'
import { isImageFile, isMarkdownFile } from '../core/local-assets'

export interface EditorPaneHandle {
  chooseFile: () => void
  focus: () => void
  /** 拖到编辑区外面也按同一套规则读文件（编码、大小、提示都在这里） */
  loadFile: (file: File) => void
}

interface Props {
  doc: Doc | null
  fileName: string
  /** 正文 Markdown（不含 front matter） */
  value: string
  /** 正在等待防抖重新解析 */
  dirty: boolean
  onChange: (body: string) => void
  onLoad: (source: string, fileName: string) => void
  onError: (message: string) => void
  onNotice?: (message: string) => void
  onSample: () => void
  /** 窄屏：切到右侧预览 */
  onShowPreview: () => void
}

export const EditorPane = forwardRef<EditorPaneHandle, Props>(function EditorPane(
  { doc, fileName, value, dirty, onChange, onLoad, onError, onNotice, onSample, onShowPreview },
  ref,
) {
  const fileRef = useRef<HTMLInputElement>(null)
  const fileBtnRef = useRef<HTMLButtonElement>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const [emptyText, setEmptyText] = useState('')
  const [over, setOver] = useState(false)

  useImperativeHandle(ref, () => ({
    chooseFile: () => fileRef.current?.click(),
    focus: () => textRef.current?.focus(),
    // 推迟到调用时再读 readFile（它声明在本行之后）
    loadFile: (file: File) => void readFile(file),
  }))

  const readFile = async (file: File) => {
    if (!/\.(md|markdown|txt)$/i.test(file.name)) {
      onError('只支持 .md / .markdown / .txt 文件')
      return
    }
    if (file.size > 4 * 1024 * 1024) {
      onError('文件超过 4MB，请检查是否选错')
      return
    }
    const { text, encoding } = decodeText(new Uint8Array(await file.arrayBuffer()))
    if (encoding !== 'utf-8') {
      onNotice?.(`「${file.name}」是 ${encoding === 'gb18030' ? 'GBK' : encoding} 编码，已自动转换`)
    } else if (looksMojibake(text)) {
      onNotice?.('正文看起来是乱码，可能是复制粘贴时用了错误的编码，建议检查原文')
    }
    onLoad(text, file.name)
  }

  const handleDrop = async (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    const files = [...e.dataTransfer.files]
    if (files.length === 0) {
      onError('没读到文件，请重新拖入 .md 文件')
      return
    }
    const md = files.find(isMarkdownFile)
    if (!md) {
      onError(files.some(isImageFile) ? '这一批里只有图片，还差一个 .md 文件' : '没找到 .md 文件')
      return
    }
    await readFile(md)
  }

  /**
   * Tab 插入两个空格，Shift+Tab 离开 —— 正文框不能是键盘陷阱。
   *
   * 只拦不带修饰键的 Tab：Shift+Tab 必须交给浏览器，否则焦点进得来出不去，
   * 键盘用户没法从正文框走到下面的「解析并排版」和预览区（WCAG 2.1.2）。
   * Esc 也回到工具行，作为另一条明确的退路。
   */
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // 中文输入法组字中，Esc / Tab 归输入法处理，别把焦点抢走
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Escape') {
      e.currentTarget.blur()
      fileBtnRef.current?.focus()
      return
    }
    if (e.key !== 'Tab' || e.shiftKey || e.altKey || e.metaKey || e.ctrlKey) return
    e.preventDefault()
    const el = e.currentTarget
    const { selectionStart, selectionEnd } = el
    const next = `${el.value.slice(0, selectionStart)}  ${el.value.slice(selectionEnd)}`
    if (doc) onChange(next)
    else setEmptyText(next)
    requestAnimationFrame(() => {
      el.selectionStart = el.selectionEnd = selectionStart + 2
    })
  }

  return (
    <section
      className={`editor-pane ${over ? 'over' : ''}`}
      aria-label="正文 Markdown 编辑器"
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => void handleDrop(e)}
    >
      <div className="editor-head">
        <div className="editor-head-main">
          <span className="editor-eyebrow">正文</span>
          {doc ? (
            <>
              <span className="editor-file" title={fileName}>
                {fileName || '未命名'}
              </span>
              <span className="editor-count">{charCount(value)} 字</span>
              {dirty ? <span className="editor-dirty">排版中…</span> : null}
            </>
          ) : (
            <span className="editor-hint">粘贴 Markdown，或把 .md 拖进来</span>
          )}
        </div>
        <div className="editor-head-tools">
          <button className="mobile-pane-link" onClick={onShowPreview}>
            预览 →
          </button>
          <button
            ref={fileBtnRef}
            className="btn btn-sm"
            onClick={() => fileRef.current?.click()}
          >
            {doc ? '换一篇' : '选择 .md'}
          </button>
        </div>
      </div>

      <div className="editor-body">
        {doc ? (
          <textarea
            ref={textRef}
            className="editor-textarea"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            placeholder="正文 Markdown…"
            aria-label="正文 Markdown"
          />
        ) : (
          <textarea
            ref={textRef}
            className="editor-textarea editor-textarea-empty"
            value={emptyText}
            onChange={(e) => setEmptyText(e.target.value)}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            placeholder={'把 Markdown 全文粘贴到这里，包含 --- 包裹的 front matter 也可以…'}
            aria-label="粘贴 Markdown"
          />
        )}
      </div>

      <div className="editor-foot">
        {doc ? (
          <>
            <span>只改正文；标题、分类、标签在左侧「文章信息」里编辑。</span>
            {dirty ? <span className="editor-foot-dirty">停止输入后自动重新排版</span> : null}
          </>
        ) : (
          <>
            {/* 空态里只留预览区那个朱红主按钮；粘贴路径用次级样式，两个实心按钮不互相抢 */}
            <button className="btn btn-sm" onClick={() => {
              if (!emptyText.trim()) {
                onError('粘贴区是空的')
                return
              }
              onLoad(emptyText, 'paste.md')
              setEmptyText('')
            }}>
              解析并排版
            </button>
            <button className="btn btn-sm" onClick={onSample}>
              载入示例文章
            </button>
            <span className="editor-foot-hint">支持 .md / .markdown / .txt</span>
          </>
        )}
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

      {over ? <div className="editor-drop-hint">松手载入 .md</div> : null}
    </section>
  )
})
