import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Doc, DocMeta } from './core/ir'
import { blocksToText, collectImages } from './core/ir'
import { parseArticle, renderPreviewHtml } from './core/parse'
import { charCount } from './core/cjk'
import { splitSections } from './core/sections'
import { copyByMode, copyPlain, downloadText, mimeFor } from './core/copy'
import { splitByH2 } from './core/split'
import { checkText, scopeOf, stripHtml } from './core/compliance'
import {
  articleKeyOf,
  clearArticle,
  markPublished as markRecord,
  readLedger,
  setUrl as setLedgerUrl,
  unmark,
  type ArticleLedger,
} from './core/ledger'
import { convertPlatforms, getConvertPlatform, rewritePlatforms, type RenderOutput } from './renderers'
import { WECHAT_CONTENT_LIMIT } from './renderers/wechat'
import { ThemePicker } from './components/ThemePicker'
import { wechatThemes } from './themes/wechat'
import { runDigest, runPlatform } from './ai/pipeline'
import { resolveProvider } from './ai/provider'
import {
  emptyAIState,
  emptyDigestState,
  emptyPlatformStates,
  rewriteIds,
  type AIState,
  type DigestSet,
  type DigestState,
  type PlatformAIStates,
  type RewriteId,
  type RewriteTone,
} from './ai/types'
import { DEFAULT_SITE_NAME } from './cards/build'

import { ImportPanel } from './components/ImportPanel'
import { MetaEditor } from './components/MetaEditor'
import { PlatformNav } from './components/PlatformNav'
import { AIPanel } from './components/AIPanel'
import { CardStudio } from './components/CardStudio'
import { SettingsSheet } from './components/SettingsSheet'
import { ComplianceChip } from './components/ComplianceChip'
import { PublishLedger } from './components/PublishLedger'
import { ImageList } from './components/ImageList'
import { NoticeStack, type NoticeItem } from './components/NoticeStack'
import { ToastLayer, useToasts } from './components/Toast'

type Kind = 'convert' | 'rewrite' | 'card'

function kindOf(id: string): Kind {
  if (convertPlatforms.some((p) => p.id === id)) return 'convert'
  if (rewritePlatforms.some((p) => p.id === id)) return 'rewrite'
  return 'card'
}

function isRewriteId(id: string): id is RewriteId {
  return (rewriteIds as string[]).includes(id)
}

const THEME_KEY = 'ad.wechat-theme'

/** 记住上次选的公众号主题；存的值失效（主题改名或删掉）就回退到默认 */
function readStoredTheme(): string {
  try {
    const saved = localStorage.getItem(THEME_KEY)
    if (saved && wechatThemes.some((t) => t.id === saved)) return saved
  } catch {
    // 隐私模式下 localStorage 会抛异常，忽略即可
  }
  return 'paper'
}

export default function App() {
  const [doc, setDoc] = useState<Doc | null>(null)
  const [fileName, setFileName] = useState('')
  const [platform, setPlatform] = useState('wechat')
  const [themeId, setThemeIdRaw] = useState(readStoredTheme)

  const setThemeId = useCallback((id: string) => {
    setThemeIdRaw(id)
    try {
      localStorage.setItem(THEME_KEY, id)
    } catch {
      // 写不进去不影响本次使用
    }
  }, [])
  const [cardThemeId, setCardThemeId] = useState('paper')
  const [siteName, setSiteName] = useState(DEFAULT_SITE_NAME)

  const [tone, setTone] = useState<RewriteTone>('original')
  const [digest, setDigest] = useState<DigestState>(emptyDigestState)
  const [platformStates, setPlatformStates] = useState<PlatformAIStates>(emptyPlatformStates())

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsVersion, setSettingsVersion] = useState(0)
  /** 发布台账：这篇文章已经发到哪几个平台 */
  const [ledger, setLedger] = useState<ArticleLedger>({})
  /** 台账的 key 在导入时算一次就锁住 —— 用户改标题不该把记录「弄丢」 */
  const [articleKey, setArticleKey] = useState('')
  const [ledgerOpen, setLedgerOpen] = useState(false)
  const [imagesOpen, setImagesOpen] = useState(false)
  /** 预览 / 源码。md 与 html 平台都先看排版，需要时再切源码 */
  const [viewMode, setViewMode] = useState<'preview' | 'source'>('preview')
  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const { items: toasts, push: toast } = useToasts()

  const kind = kindOf(platform)

  /* ---------------- 载入 ---------------- */

  const load = useCallback(
    (source: string, name: string) => {
      const parsed = parseArticle({ source, fileName: name })
      setDoc(parsed)
      setFileName(name)
      setDigest(emptyDigestState)
      setPlatformStates(emptyPlatformStates())
      setArticleKey(articleKeyOf(parsed))
      if (parsed.blocks.length === 0) {
        toast('解析后正文是空的，请检查文件内容', 'error')
      } else {
        toast(`已解析「${parsed.meta.title}」`, 'success')
      }
    },
    [toast],
  )

  const updateMeta = useCallback((patch: Partial<DocMeta>) => {
    setDoc((d) => (d ? { ...d, meta: { ...d.meta, ...patch } } : d))
  }, [])

  /* ---------------- 渲染 ---------------- */

  const output: RenderOutput | null = useMemo(() => {
    if (!doc || kind !== 'convert') return null
    const p = getConvertPlatform(platform)
    if (!p) return null
    try {
      return p.render(doc, { wechatThemeId: themeId })
    } catch (e) {
      return {
        primary: '',
        text: '',
        format: 'text',
        copyMode: 'plain',
        warnings: [`渲染出错：${e instanceof Error ? e.message : String(e)}`],
        stats: [],
      }
    }
  }, [doc, platform, themeId, kind])

  const overLimit = Boolean(output && platform === 'wechat' && output.primary.length > WECHAT_CONTENT_LIMIT)

  /** Markdown 平台的阅读预览：和转换器共用同一套前置处理 */
  const previewHtml = useMemo(() => {
    if (!doc || kind !== 'convert' || !output || output.format !== 'markdown') return ''
    try {
      return renderPreviewHtml(doc.rawMd)
    } catch {
      return ''
    }
  }, [doc, kind, output])

  /** 能切「预览 / 源码」的平台：md 走渲染预览，公众号走富文本预览 */
  const canPreview = Boolean(
    output && (output.format === 'markdown' ? previewHtml : output.format === 'html' && output.html),
  )

  const notices: NoticeItem[] = useMemo(() => {
    if (!output) return []
    const hasError = output.stats.some((s) => s.level === 'error')
    return output.warnings.map((text, i) => ({
      text,
      level: i === 0 && hasError ? 'error' : 'warn',
    }))
  }, [output])

  /* ---------------- 发布台账 / 合规检查 / 图片清单 ---------------- */

  // 换文章才重读台账。key 在导入时算一次就锁住，改标题不会把它冲掉
  useEffect(() => {
    setLedger(articleKey ? readLedger(articleKey) : {})
  }, [articleKey])

  const images = useMemo(() => (doc ? collectImages(doc.blocks) : []), [doc])

  /** 检查用的纯文本：转换平台看产物，改写平台看当前生成的文案 */
  const checkContent = useMemo(() => {
    if (kind === 'convert' && output) {
      const plain = output.text || output.primary
      return output.format === 'html' ? stripHtml(plain) : plain
    }
    if (kind === 'rewrite' && isRewriteId(platform)) {
      // 流式输出时每个 chunk 都会变，正文检查要等它写完，否则每次都要扫几万字
      if (platformStates[platform].status === 'running') return ''
      const r = platformStates[platform].result
      if (!r) return ''
      return [
        r.xhs?.title,
        r.xhs?.body,
        r.xhs?.tags?.join(' '),
        r.twitter?.thread?.join('\n'),
        r.jike?.body,
        r.weibo?.text,
        r.weibo?.topics?.join(' '),
      ]
        .filter(Boolean)
        .join('\n')
    }
    return ''
  }, [kind, output, platform, platformStates])

  const complianceHits = useMemo(
    () => checkText(checkContent, scopeOf(platform)),
    [checkContent, platform],
  )

  const scopeLabel =
    platform === 'xiaohongshu' ? '小红书规则' : platform === 'wechat' ? '公众号规则' : '通用规则'

  /* ---------------- 章节切分 ---------------- */

  const sections = useMemo(() => (doc ? splitSections(doc) : []), [doc])

  /* ---------------- AI 编排 ---------------- */

  const providerReady = useMemo(
    () => resolveProvider().provider !== null,
    // settingsVersion 在保存设置后 +1，用于强制重算
    [settingsVersion, settingsOpen],
  )

  const startJob = useCallback(() => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    return controller
  }, [])

  /** Stage 1：逐节摘要 */
  const generateDigest = useCallback(async () => {
    if (!doc || sections.length === 0) {
      toast('没有可切分的正文', 'error')
      return
    }
    const controller = startJob()
    setDigest({ ...emptyDigestState, status: 'running' })

    const out = await runDigest(doc, sections, tone, controller.signal, {
      onStream: (text) => setDigest((prev) => ({ ...prev, status: 'running', streaming: text })),
    })

    setDigest(out.state)
    if (out.state.error) {
      toast(out.state.error, out.state.fallback ? 'info' : 'error')
    } else {
      toast(`已生成 ${out.state.digest?.sections.length ?? 0} 节摘要`, 'success')
    }
  }, [doc, sections, tone, startJob, toast])

  const setOnePlatform = useCallback((id: RewriteId, state: AIState) => {
    setPlatformStates((prev) => ({ ...prev, [id]: state }))
  }, [])

  /** Stage 2：单个平台 */
  const runOnePlatform = useCallback(
    async (id: RewriteId, dg: DigestSet, signal: AbortSignal): Promise<AIState | null> => {
      if (!doc) return null
      setOnePlatform(id, { ...emptyAIState, status: 'running' })

      const out = await runPlatform(id, doc, dg, tone, signal, {
        onStream: (text) =>
          setPlatformStates((prev) => ({ ...prev, [id]: { ...prev[id], status: 'running', streaming: text } })),
      })

      setOnePlatform(id, out.state)
      return out.state
    },
    [doc, tone, setOnePlatform],
  )

  /** 生成当前平台：缺摘要就先跑 Stage 1 */
  const generateCurrent = useCallback(async () => {
    if (!doc || !isRewriteId(platform)) return
    const controller = startJob()

    let dg = digest.digest
    if (!dg) {
      setDigest({ ...emptyDigestState, status: 'running' })
      const dOut = await runDigest(doc, sections, tone, controller.signal, {
        onStream: (text) => setDigest((prev) => ({ ...prev, status: 'running', streaming: text })),
      })
      setDigest(dOut.state)
      dg = dOut.state.digest
      if (!dg) {
        toast(dOut.state.error ?? '摘要生成失败', 'error')
        return
      }
    }

    const state = await runOnePlatform(platform, dg, controller.signal)
    if (!state) return
    if (state.error) toast(state.error, state.fallback ? 'info' : 'error')
    else if (state.fallback) toast('已用本地组装生成（未调用大模型）')
    else toast('生成好了', 'success')
  }, [doc, platform, digest.digest, sections, tone, startJob, runOnePlatform, toast])

  /** 生成四个平台 */
  const generateAll = useCallback(async () => {
    if (!doc) return
    const controller = startJob()

    let dg = digest.digest
    if (!dg) {
      setDigest({ ...emptyDigestState, status: 'running' })
      const dOut = await runDigest(doc, sections, tone, controller.signal, {
        onStream: (text) => setDigest((prev) => ({ ...prev, status: 'running', streaming: text })),
      })
      setDigest(dOut.state)
      dg = dOut.state.digest
      if (!dg) {
        toast(dOut.state.error ?? '摘要生成失败', 'error')
        return
      }
    }

    for (const id of rewriteIds) {
      if (controller.signal.aborted) return
      await runOnePlatform(id, dg, controller.signal)
    }
    toast('四个平台的文案都生成好了', 'success')
  }, [doc, digest.digest, sections, tone, startJob, runOnePlatform, toast])

  const cancelGenerate = useCallback(() => {
    abortRef.current?.abort()
    setDigest((prev) => (prev.status === 'running' ? { ...prev, status: 'idle', streaming: '' } : prev))
    setPlatformStates((prev) => {
      const next = { ...prev }
      for (const id of rewriteIds) {
        if (next[id].status === 'running') next[id] = { ...next[id], status: 'idle', streaming: '' }
      }
      return next
    })
    toast('已停止生成')
  }, [toast])

  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  // 切平台/切视图后回到顶部 —— 否则从长文滚到一半再切走，新面板会停在中间
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [platform, viewMode])

  /* ---------------- 摘要编辑 ---------------- */

  const editSummary = useCallback((index: number, summary: string) => {
    setDigest((prev) => {
      if (!prev.digest) return prev
      return {
        ...prev,
        digest: {
          ...prev.digest,
          sections: prev.digest.sections.map((s) => (s.index === index ? { ...s, summary } : s)),
        },
      }
    })
  }, [])

  const editOneLiner = useCallback((oneLiner: string) => {
    setDigest((prev) => (prev.digest ? { ...prev, digest: { ...prev.digest, oneLiner } } : prev))
  }, [])

  /* ---------------- 复制 / 下载 ---------------- */

  const copyPlainText = useCallback(
    async (text: string, label: string) => {
      try {
        await copyPlain(text)
        // 改写平台复制成功也算发过了；第一次会顺带提示，避免用户以为只是复制
        let tail = ''
        if (articleKey && isRewriteId(platform)) {
          tail = ledger[platform] ? '' : ' · 已记为已发'
          setLedger(markRecord(articleKey, platform))
        }
        toast(`已复制${label}${tail}`, 'success')
      } catch {
        toast('复制失败，浏览器拒绝了剪贴板访问', 'error')
      }
    },
    [toast, articleKey, platform, ledger],
  )

  const doCopyPrimary = useCallback(async () => {
    if (!output) return
    try {
      const mode = await copyByMode(output.copyMode, { html: output.html, text: output.text })
      const tail = ledger[platform] ? '' : ' · 已记为已发'
      if (articleKey) setLedger(markRecord(articleKey, platform))
      if (output.copyMode === 'rich') {
        toast(
          mode === 'rich' ? `已复制富文本，直接粘进编辑器即可${tail}` : `浏览器不支持富文本复制，已改为复制纯文本${tail}`,
          mode === 'rich' ? 'success' : 'info',
        )
      } else {
        toast(`已复制${tail}`, 'success')
      }
    } catch {
      toast('复制失败', 'error')
    }
  }, [output, toast, articleKey, platform, ledger])

  const doCopySource = useCallback(async () => {
    if (!output) return
    try {
      await copyPlain(output.primary)
      const tail = ledger[platform] ? '' : ' · 已记为已发'
      if (articleKey) setLedger(markRecord(articleKey, platform))
      toast(`已复制源码${tail}`, 'success')
    } catch {
      toast('复制失败', 'error')
    }
  }, [output, toast, articleKey, platform, ledger])

  const doDownload = useCallback(() => {
    if (!output) return
    downloadText(output.primary, output.fileName ?? 'article.md', mimeFor(output.format))
  }, [output])

  const doSplitExport = useCallback(() => {
    if (!doc) return
    const parts = splitByH2(doc)
    const p = getConvertPlatform('wechat')
    if (!p) return
    parts.forEach((part, i) => {
      const out = p.render(part, { wechatThemeId: themeId })
      setTimeout(() => {
        downloadText(
          out.primary,
          `${out.fileName?.replace(/\.html$/, '') ?? `part-${i + 1}`}.html`,
          'text/html',
        )
      }, i * 300)
    })
    toast(`已拆成 ${parts.length} 篇并开始下载`, 'success')
  }, [doc, themeId, toast])

  /* ---------------- 顶栏统计 ---------------- */

  const totalChars = useMemo(() => (doc ? charCount(blocksToText(doc.blocks)) : 0), [doc])

  const currentAI: AIState = isRewriteId(platform) ? platformStates[platform] : emptyAIState

  const currentPlatformMeta = useMemo(() => {
    if (kind === 'convert') return convertPlatforms.find((p) => p.id === platform)
    if (kind === 'rewrite') return rewritePlatforms.find((p) => p.id === platform)
    return { id: 'cards', name: '配图卡片', hint: '1080×1440 文字卡片，导出 PNG', limits: '小红书 3:4' }
  }, [platform, kind])

  const navStatus = useMemo(() => {
    const map: Record<string, AIState['status']> = {}
    for (const id of rewriteIds) map[id] = platformStates[id].status
    return map
  }, [platformStates])

  /** 台账进度：8 个平台发了几个 */
  const platformTotal = convertPlatforms.length + rewritePlatforms.length
  const ledgerDone = Object.keys(ledger).length

  return (
    <div className="app">
      {/* ================= 顶栏 ================= */}
      <header className="topbar">
        <div className="brand">
          <img className="brand-icon" src="./icon.svg" alt="" width={26} height={26} />
          <span className="brand-mark">文章分发台</span>
          <span className="brand-sub">Dispatch</span>
        </div>

        <div className="topbar-spacer" />

        {doc ? (
          <div className="topbar-stat">
            <span>正文</span>
            <strong>{totalChars.toLocaleString()}</strong>
            <span>字</span>
          </div>
        ) : null}

        <button
          className={`topbar-ai ${providerReady ? 'ok' : 'idle'}`}
          onClick={() => setSettingsOpen(true)}
          title={providerReady ? '点击修改模型设置' : '点击填入自己的 API Key'}
        >
          <span className={`dot ${providerReady ? 'dot-ok' : 'dot-idle'}`} />
          <span>{providerReady ? 'AI 已就绪' : '填入 API Key'}</span>
        </button>

        {doc ? (
          <button
            className={`btn btn-sm btn-quiet ledger-entry ${ledgerDone === platformTotal ? 'complete' : ''}`}
            onClick={() => setLedgerOpen(true)}
            title="发布台账：记录这篇文章发到哪几个平台、什么时候、链接是什么"
          >
            台账 {ledgerDone}/{platformTotal}
          </button>
        ) : null}

        <button className="btn btn-sm btn-quiet" onClick={() => setSettingsOpen(true)}>
          设置
        </button>
      </header>

      <div className="app-body">
        {/* ================= 侧栏 ================= */}
        <aside className="sidebar">
          <ImportPanel currentName={fileName} onLoad={load} onError={(m) => toast(m, 'error')} />
          {doc ? <MetaEditor meta={doc.meta} onChange={updateMeta} /> : null}
          <PlatformNav
            active={platform}
            onSelect={setPlatform}
            platformStatus={navStatus}
            published={ledger}
          />
        </aside>

        {/* ================= 主区域 ================= */}
        <main className="main">
          <div className="main-head">
            <div className="head-row">
              <div className="head-title">
                <h1 className="main-title">{currentPlatformMeta?.name}</h1>
                <p className="main-hint">{currentPlatformMeta?.hint}</p>
              </div>

              <div className="head-tools">
                {currentPlatformMeta?.limits ? (
                  <span className="limit-chip">{currentPlatformMeta.limits}</span>
                ) : null}
                {doc && kind !== 'card' && checkContent.length > 0 ? (
                  <ComplianceChip hits={complianceHits} scopeLabel={scopeLabel} />
                ) : null}
                {doc && kind !== 'card' && images.length > 0 ? (
                  <button
                    className="head-chip"
                    onClick={() => setImagesOpen(true)}
                    title="正文图片清单：按序号打包下载，方便传进公众号"
                  >
                    图片 {images.length}
                  </button>
                ) : null}
                {canPreview ? (
                  <div className="segmented view-switch">
                    <button
                      className={viewMode === 'preview' ? 'active' : ''}
                      onClick={() => setViewMode('preview')}
                    >
                      预览
                    </button>
                    <button
                      className={viewMode === 'source' ? 'active' : ''}
                      onClick={() => setViewMode('source')}
                    >
                      源码
                    </button>
                  </div>
                ) : null}
              </div>
            </div>

            {doc && (output?.stats.length || kind === 'rewrite') ? (
              <div className="stats-bar">
                {output?.stats.map((s, i) => (
                  <span key={i} className={`stat-chip ${s.level ?? ''}`}>
                    <span className="stat-label">{s.label}</span>
                    {s.value}
                  </span>
                ))}
                {kind === 'rewrite' && sections.length > 0 ? (
                  <span className="stat-chip">
                    <span className="stat-label">按 ## 切分</span>
                    {sections.length} 节
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>

          {kind === 'convert' && platform === 'wechat' && doc ? (
            <ThemePicker value={themeId} onChange={setThemeId} />
          ) : null}

          {/* ---------- 预览区 ---------- */}
          <div className="preview-scroll" ref={scrollRef}>
            {!doc ? (
              <div className="empty-state">
                <div className="empty-art" aria-hidden>
                  <span />
                  <span />
                  <span />
                </div>
                <div className="empty-text">先导入一篇博客文章</div>
                <div className="empty-hint">
                  支持拖入 .md 或直接粘贴。会读出 front matter 里的标题、分类、标签与摘要，
                  再按各平台规则产出对应格式。
                </div>
                <div className="empty-steps">
                  <span>
                    <b>1</b>拖入 .md
                  </span>
                  <span>
                    <b>2</b>选平台
                  </span>
                  <span>
                    <b>3</b>复制粘贴
                  </span>
                </div>
              </div>
            ) : (
              <>
                {notices.length > 0 ? (
                  <div className="notice-holder">
                    <NoticeStack
                      items={notices}
                      action={
                        overLimit ? (
                          <button className="btn btn-sm btn-accent" onClick={doSplitExport}>
                            按 H2 拆篇导出
                          </button>
                        ) : undefined
                      }
                    />
                  </div>
                ) : null}

                {output?.extras?.map((extra, i) => (
                  <details key={i} className="details">
                    <summary>
                      {extra.title}（{extra.items.length}）
                    </summary>
                    <div className="details-body">
                      {extra.items.map((item, j) => (
                        <div key={j}>{item}</div>
                      ))}
                    </div>
                  </details>
                ))}

                <div className="stage" key={`${platform}-${viewMode}`}>
                  {kind === 'convert' && output ? (
                    viewMode === 'preview' && canPreview ? (
                      output.format === 'html' && output.html ? (
                        <div className="rich-preview" dangerouslySetInnerHTML={{ __html: output.html }} />
                      ) : (
                        <div className="md-preview-wrap" dangerouslySetInnerHTML={{ __html: previewHtml }} />
                      )
                    ) : (
                      <div className="source-card">
                        <div className="source-head">
                          <span className="source-lang">{output.format === 'markdown' ? 'Markdown' : 'HTML'}</span>
                          <span className="source-note">复制时用的就是这份源码</span>
                        </div>
                        <pre className="code-preview">{output.primary}</pre>
                      </div>
                    )
                  ) : kind === 'rewrite' && isRewriteId(platform) ? (
                    <div className="panel-card">
                      <AIPanel
                        platform={platform}
                        ai={currentAI}
                        digest={digest}
                        sections={sections}
                        tone={tone}
                        providerReady={providerReady}
                        providerLabel={currentAI.providerLabel || digest.providerLabel}
                        onToneChange={setTone}
                        onGenerateDigest={generateDigest}
                        onCancel={cancelGenerate}
                        onCopy={copyPlainText}
                        onEditSummary={editSummary}
                        onEditOneLiner={editOneLiner}
                        onOpenSettings={() => setSettingsOpen(true)}
                      />
                    </div>
                  ) : (
                    <div className="panel-card">
                      <CardStudio
                        doc={doc}
                        sections={sections}
                        summaries={digest.digest?.sections ?? null}
                        cardThemeId={cardThemeId}
                        onThemeChange={setCardThemeId}
                        siteName={siteName}
                        onSiteNameChange={setSiteName}
                        onToast={toast}
                      />
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* ---------- 操作条 ---------- */}
          {doc ? (
            <div className="actionbar">
              {kind === 'convert' && output ? (
                <>
                  <button className="btn btn-accent" onClick={doCopyPrimary}>
                    {output.copyMode === 'rich' ? '复制富文本' : output.copyMode === 'markdown' ? '复制 Markdown' : '复制全文'}
                  </button>
                  {/* markdown 平台的 primary 就是 text，两个按钮会做同一件事 */}
                  {output.format !== 'markdown' ? (
                    <button className="btn" onClick={doCopySource}>
                      复制源码
                    </button>
                  ) : null}
                  <button className="btn" onClick={doDownload}>
                    下载 {output.format === 'markdown' ? '.md' : '.html'}
                  </button>
                </>
              ) : null}

              {kind === 'rewrite' ? (
                <>
                  <button
                    className="btn btn-accent"
                    onClick={generateCurrent}
                    disabled={currentAI.status === 'running' || digest.status === 'running'}
                  >
                    {currentAI.status === 'running' || digest.status === 'running' ? (
                      <span className="spinner" />
                    ) : null}
                    {currentAI.status === 'running' || digest.status === 'running'
                      ? '生成中…'
                      : currentAI.result
                        ? `重新生成${currentPlatformMeta?.name ?? ''}`
                        : `生成${currentPlatformMeta?.name ?? ''}文案`}
                  </button>
                  <button
                    className="btn"
                    onClick={generateAll}
                    disabled={currentAI.status === 'running' || digest.status === 'running'}
                  >
                    四个平台一起生成
                  </button>
                </>
              ) : null}

              {kind === 'card' ? (
                <span className="muted actionbar-note">左侧选卡片、改文字、换配色，然后导出 PNG</span>
              ) : null}

              <div className="actionbar-spacer" />

              {doc.warnings.length > 0 ? (
                <details className="details details-inline">
                  <summary>解析提示（{doc.warnings.length}）</summary>
                  <div className="details-body">
                    {doc.warnings.map((w, i) => (
                      <div key={i}>· {w}</div>
                    ))}
                  </div>
                </details>
              ) : null}
            </div>
          ) : null}
        </main>
      </div>

      <SettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={(m) => {
          setSettingsVersion((v) => v + 1)
          toast(m, 'success')
        }}
      />

      {doc ? (
        <PublishLedger
          open={ledgerOpen}
          onClose={() => setLedgerOpen(false)}
          title={doc.meta.title}
          ledger={ledger}
          onMark={(id) => setLedger(markRecord(articleKey, id))}
          onUnmark={(id) => setLedger(unmark(articleKey, id))}
          onSetUrl={(id, url) => setLedger(setLedgerUrl(articleKey, id, url))}
          onClear={() => {
            setLedger(clearArticle(articleKey))
            toast('已清空这篇的台账')
          }}
        />
      ) : null}

      <ImageList
        open={imagesOpen}
        onClose={() => setImagesOpen(false)}
        images={images}
        title={doc?.meta.title ?? '文章'}
      />

      <ToastLayer items={toasts} />
    </div>
  )
}
