import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Doc, DocMeta } from './core/ir'
import { blocksToText } from './core/ir'
import { parseArticle } from './core/parse'
import { charCount } from './core/cjk'
import { splitSections } from './core/sections'
import { copyByMode, copyPlain, downloadText, mimeFor } from './core/copy'
import { splitByH2 } from './core/split'
import { convertPlatforms, getConvertPlatform, rewritePlatforms, type RenderOutput } from './renderers'
import { WECHAT_CONTENT_LIMIT } from './renderers/wechat'
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

export default function App() {
  const [doc, setDoc] = useState<Doc | null>(null)
  const [fileName, setFileName] = useState('')
  const [platform, setPlatform] = useState('wechat')
  const [themeId, setThemeId] = useState('paper')
  const [cardThemeId, setCardThemeId] = useState('paper')
  const [siteName, setSiteName] = useState(DEFAULT_SITE_NAME)

  const [tone, setTone] = useState<RewriteTone>('original')
  const [digest, setDigest] = useState<DigestState>(emptyDigestState)
  const [platformStates, setPlatformStates] = useState<PlatformAIStates>(emptyPlatformStates())

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsVersion, setSettingsVersion] = useState(0)
  const abortRef = useRef<AbortController | null>(null)
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
        toast(`已复制${label}`, 'success')
      } catch {
        toast('复制失败，浏览器拒绝了剪贴板访问', 'error')
      }
    },
    [toast],
  )

  const doCopyPrimary = useCallback(async () => {
    if (!output) return
    try {
      const mode = await copyByMode(output.copyMode, { html: output.html, text: output.text })
      if (output.copyMode === 'rich') {
        toast(
          mode === 'rich' ? '已复制富文本，直接粘进编辑器即可' : '浏览器不支持富文本复制，已改为复制纯文本',
          mode === 'rich' ? 'success' : 'info',
        )
      } else {
        toast('已复制', 'success')
      }
    } catch {
      toast('复制失败', 'error')
    }
  }, [output, toast])

  const doCopySource = useCallback(async () => {
    if (!output) return
    try {
      await copyPlain(output.primary)
      toast('已复制源码', 'success')
    } catch {
      toast('复制失败', 'error')
    }
  }, [output, toast])

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

  return (
    <div className="app">
      {/* ================= 顶栏 ================= */}
      <div className="topbar">
        <div className="brand">
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
          className={`topbar-stat topbar-ai ${providerReady ? 'ok' : 'idle'}`}
          onClick={() => setSettingsOpen(true)}
          title={providerReady ? '点击修改模型设置' : '点击填入自己的 API Key'}
        >
          <span className={`dot ${providerReady ? 'dot-ok' : 'dot-idle'}`} />
          <span>{providerReady ? 'AI 已就绪' : '填入 API Key'}</span>
        </button>
        <button className="btn btn-sm" onClick={() => setSettingsOpen(true)}>
          设置
        </button>
      </div>

      <div className="app-body">
        {/* ================= 侧栏 ================= */}
        <div className="sidebar">
          <ImportPanel currentName={fileName} onLoad={load} onError={(m) => toast(m, 'error')} />
          {doc ? <MetaEditor meta={doc.meta} onChange={updateMeta} /> : null}
          <PlatformNav active={platform} onSelect={setPlatform} platformStatus={navStatus} />
        </div>

        {/* ================= 主区域 ================= */}
        <div className="main">
          <div className="main-head">
            <div className="main-head-row">
              <span className="main-title">{currentPlatformMeta?.name}</span>
              <span className="main-hint">{currentPlatformMeta?.hint}</span>
            </div>
            {currentPlatformMeta?.limits ? <div className="main-limits">{currentPlatformMeta.limits}</div> : null}

            {doc ? (
              <div className="stats-bar">
                {output?.stats.map((s, i) => (
                  <span key={i} className={`stat-chip ${s.level ?? ''}`}>
                    <span className="stat-label">{s.label}</span>
                    {s.value}
                  </span>
                ))}
                {kind === 'convert' && platform === 'wechat' ? (
                  <span className="segmented" style={{ marginLeft: 'auto' }}>
                    {wechatThemes.map((t) => (
                      <button key={t.id} className={themeId === t.id ? 'active' : ''} onClick={() => setThemeId(t.id)}>
                        {t.name}
                      </button>
                    ))}
                  </span>
                ) : null}
                {kind === 'rewrite' && sections.length > 0 ? (
                  <span className="stat-chip" style={{ marginLeft: 'auto' }}>
                    <span className="stat-label">按 ## 切分</span>
                    {sections.length} 节
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* ---------- 预览区 ---------- */}
          <div className="preview-scroll">
            {!doc ? (
              <div className="empty-state">
                <div className="empty-mark">MD</div>
                <div className="empty-text">先导入一篇博客文章</div>
                <div className="empty-hint">
                  支持拖入 .md 文件或直接粘贴。会读出 front matter 里的标题、分类、标签与摘要，
                  然后按 8 个平台各自的规则产出对应格式。
                </div>
              </div>
            ) : kind === 'convert' && output ? (
              <>
                {output.warnings.length > 0 ? (
                  <div style={{ maxWidth: 760, margin: '0 auto 14px' }}>
                    {output.warnings.map((w, i) => (
                      <div
                        key={i}
                        className={`notice ${
                          i === 0 && output.stats.some((s) => s.level === 'error') ? 'notice-error' : 'notice-warn'
                        }`}
                      >
                        <span className="notice-mark">!</span>
                        <span>{w}</span>
                      </div>
                    ))}
                    {overLimit ? (
                      <button className="btn btn-sm btn-accent" onClick={doSplitExport}>
                        按 H2 拆篇并分别导出
                      </button>
                    ) : null}
                  </div>
                ) : null}

                {output.extras?.map((extra, i) => (
                  <details key={i} className="details" style={{ maxWidth: 760, margin: '0 auto 14px' }}>
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

                {output.format === 'html' && output.html ? (
                  <div className="rich-preview" dangerouslySetInnerHTML={{ __html: output.html }} />
                ) : (
                  <div className="preview-card">
                    <pre className="code-preview">{output.primary}</pre>
                  </div>
                )}
              </>
            ) : kind === 'rewrite' && isRewriteId(platform) ? (
              <div className="preview-card plain">
                <AIPanel
                  platform={platform}
                  ai={currentAI}
                  digest={digest}
                  sections={sections}
                  tone={tone}
                  providerReady={providerReady}
                  providerLabel={currentAI.providerLabel || digest.providerLabel}
                  onToneChange={setTone}
                  onGenerate={generateCurrent}
                  onGenerateDigest={generateDigest}
                  onCancel={cancelGenerate}
                  onCopy={copyPlainText}
                  onEditSummary={editSummary}
                  onEditOneLiner={editOneLiner}
                  onOpenSettings={() => setSettingsOpen(true)}
                />
              </div>
            ) : (
              <div className="preview-card plain">
                <CardStudio
                  doc={doc}
                  cardThemeId={cardThemeId}
                  onThemeChange={setCardThemeId}
                  siteName={siteName}
                  onSiteNameChange={setSiteName}
                  onToast={toast}
                />
              </div>
            )}
          </div>

          {/* ---------- 操作条 ---------- */}
          {doc ? (
            <div className="actionbar">
              {kind === 'convert' && output ? (
                <>
                  <button className="btn btn-accent" onClick={doCopyPrimary}>
                    {output.copyMode === 'rich' ? '复制富文本' : '复制全文'}
                  </button>
                  <button className="btn" onClick={doCopySource}>
                    复制源码
                  </button>
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
                    {currentAI.status === 'running' || digest.status === 'running' ? <span className="spinner" /> : null}
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
                <span className="muted" style={{ fontSize: 12.5 }}>
                  在右侧选择卡片、改文字、换配色，然后导出 PNG
                </span>
              ) : null}

              <div className="actionbar-spacer" />
              {doc.warnings.length > 0 ? (
                <details className="details" style={{ margin: 0, maxWidth: 420 }}>
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
        </div>
      </div>

      <SettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={(m) => {
          setSettingsVersion((v) => v + 1)
          toast(m, 'success')
        }}
      />
      <ToastLayer items={toasts} />
    </div>
  )
}
