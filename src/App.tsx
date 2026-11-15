import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Doc, DocMeta } from './core/ir'
import { collectImages } from './core/ir'
import { charCount } from './core/cjk'
import { sanitizePreview } from './core/sanitize-preview'
import { splitSections } from './core/sections'
import { checkText, scopeOf, stripHtml } from './core/compliance'
import { readTailConfig, writeTailConfig, type TailConfig } from './core/tail'
import { loadOpenOnCopy, publishUrlOf, saveOpenOnCopy } from './core/publish'
import {
  clearDrafts,
  deleteDraft,
  draftValue,
  fingerprintOf,
  formatAgo,
  listDrafts,
  readDraft,
  type DraftSnapshot,
} from './core/drafts'
import {
  articleKeyOf,
  clearArticle,
  publishedCount,
  readAllLedgers,
  setUrl as setLedgerUrl,
  unmarkPublished,
} from './core/ledger'
import { summarizeAll } from './core/review'
import {
  allPlatforms,
  cardPlatform,
  convertPlatforms,
  loadConvertRenderer,
  platformGroups,
  rewritePlatforms,
  type RenderFn,
  type RenderOutput,
} from './renderers'
import { loadHidden, saveHidden, sortByWidth } from './core/platform-visibility'
import { WECHAT_WORD_LIMIT } from './renderers/limits'
import { ThemePicker } from './components/ThemePicker'
import { wechatThemes } from './themes/wechat'
import { resolveProvider } from './ai/provider'
import { emptyAIState, isRewriteId, rewriteIds, type AIState, type RewriteId } from './ai/types'
import { useAIJobs } from './hooks/useAIJobs'
import { useCopyActions } from './hooks/useCopyActions'
import { useLedger } from './hooks/useLedger'
import { useReadiness } from './hooks/useReadiness'
import { useDraftAutosave } from './hooks/useDraftAutosave'
import { DEFAULT_SITE_NAME } from './cards/build'
import { SAMPLE_ARTICLE } from './core/sample'

import { ImportPanel, type ImportPanelHandle } from './components/ImportPanel'
import { ActionBar } from './components/ActionBar'
import { PlatformNav } from './components/PlatformNav'
import { Sheet, type SheetId } from './components/Sheet'
import type { LedgerContentState } from './components/PublishLedger'
// 主工作面板首屏不需要；弹层也只在用户打开时加载，避免把设置、台账、
// 封面、复盘等低频代码都塞进首屏主包。
const AIPanel = lazy(() =>
  import('./components/AIPanel').then((m) => ({ default: m.AIPanel })),
)
const CardStudio = lazy(() =>
  import('./components/CardStudio').then((m) => ({ default: m.CardStudio })),
)
const SettingsSheet = lazy(() =>
  import('./components/SettingsSheet').then((m) => ({ default: m.SettingsSheet })),
)
const PublishLedger = lazy(() =>
  import('./components/PublishLedger').then((m) => ({ default: m.PublishLedger })),
)
const ImageList = lazy(() =>
  import('./components/ImageList').then((m) => ({ default: m.ImageList })),
)
const CoverSheet = lazy(() =>
  import('./components/CoverSheet').then((m) => ({ default: m.CoverSheet })),
)
const MetaLab = lazy(() =>
  import('./components/MetaLab').then((m) => ({ default: m.MetaLab })),
)
const TailSheet = lazy(() =>
  import('./components/TailSheet').then((m) => ({ default: m.TailSheet })),
)
const DraftsSheet = lazy(() =>
  import('./components/DraftsSheet').then((m) => ({ default: m.DraftsSheet })),
)
const ReviewSheet = lazy(() =>
  import('./components/ReviewSheet').then((m) => ({ default: m.ReviewSheet })),
)
const PlatformFilterSheet = lazy(() =>
  import('./components/PlatformFilterSheet').then((m) => ({
    default: m.PlatformFilterSheet,
  })),
)
const ReadinessSheet = lazy(() =>
  import('./components/ReadinessSheet').then((m) => ({ default: m.ReadinessSheet })),
)
const PlatformPalette = lazy(() =>
  import('./components/PlatformPalette').then((m) => ({ default: m.PlatformPalette })),
)
const RecoverySheet = lazy(() =>
  import('./components/RecoverySheet').then((m) => ({ default: m.RecoverySheet })),
)
import { NoticeStack, type NoticeItem } from './components/NoticeStack'
import { ToastLayer, useToasts } from './components/Toast'

type Kind = 'convert' | 'rewrite' | 'card'

function kindOf(id: string): Kind {
  if (convertPlatforms.some((p) => p.id === id)) return 'convert'
  if (rewritePlatforms.some((p) => p.id === id)) return 'rewrite'
  return 'card'
}

const THEME_KEY = 'ad.wechat-theme'
const ACCOUNT_KEY = 'ad.wechat-account'

/** 公众号账号名，替换文末模板里的 {account} */
function readStoredAccount(): string {
  try {
    return localStorage.getItem(ACCOUNT_KEY) ?? ''
  } catch {
    return ''
  }
}

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

/**
 * Markdown 解析（含 markdown-it，单文件 125KB min）是动态 import 进来的 ——
 * 首屏（空状态）不需要它，导入文章时才加载。模块级缓存：整个会话只加载一次。
 */
type ParseModule = typeof import('./core/parse')
let parseModulePromise: Promise<ParseModule> | null = null
function loadParseModule(): Promise<ParseModule> {
  parseModulePromise ??= import('./core/parse')
  return parseModulePromise
}

export default function App() {
  const [doc, setDoc] = useState<Doc | null>(null)
  const [fileName, setFileName] = useState('')
  const [platform, setPlatform] = useState('wechat')
  /** 侧栏隐藏了哪些平台。只是显示偏好，不影响渲染、台账和生成 */
  const [hidden, setHidden] = useState(() => loadHidden(allPlatforms.map((p) => p.id)))
  const [sidebarOpen, setSidebarOpen] = useState(false)
  /**
   * 当前打开的弹层。原来这里是 12 个独立布尔 —— 于是「开 B 之前先关 A」
   * 得靠每个调用点自己记得，漏一次就是两个遮罩叠在一起。
   * 现在同时只可能有一个，这件事由类型保证。
   */
  const [sheet, setSheet] = useState<SheetId | null>(null)
  const closeSheet = useCallback(() => setSheet(null), [])
  const [themeId, setThemeIdRaw] = useState(readStoredTheme)

  const setThemeId = useCallback((id: string) => {
    setThemeIdRaw(id)
    try {
      localStorage.setItem(THEME_KEY, id)
    } catch {
      // 写不进去不影响本次使用
    }
  }, [])

  /** 文末配置改一个字就落盘：没有保存按钮，关掉弹层再打开还得是刚才的样子 */
  const changeTail = useCallback((cfg: TailConfig) => {
    setTail(cfg)
    writeTailConfig(cfg)
  }, [])

  const changeAccount = useCallback((name: string) => {
    setAccount(name)
    try {
      localStorage.setItem(ACCOUNT_KEY, name)
    } catch {
      // 同上
    }
  }, [])
  const [cardThemeId, setCardThemeId] = useState('paper')
  const [siteName, setSiteName] = useState(DEFAULT_SITE_NAME)

  const [settingsVersion, setSettingsVersion] = useState(0)
  /** 台账的 key 在导入时算一次就锁住 —— 用户改标题不该把记录「弄丢」 */
  const [articleKey, setArticleKey] = useState('')
  const [ledgerFocusPlatform, setLedgerFocusPlatform] = useState('')
  /** 封面图：从 Unsplash 按文章搜 3 张候选 */
  /** 公众号文末三块（账号级配置，和文章无关，所以存在 localStorage 而不是 doc 里） */
  const [tail, setTail] = useState<TailConfig>(readTailConfig)
  const [account, setAccount] = useState(readStoredAccount)
  /** 点击发布轨道的「草稿」时，通知侧栏里的文章信息展开 */
  const [metaEditorSignal, setMetaEditorSignal] = useState(0)
  /** 导入时的完整原文（含 front matter），草稿要连正文一起存才恢复得回来 */
  const [sourceText, setSourceText] = useState('')
  const [drafts, setDrafts] = useState<DraftSnapshot[]>(listDrafts)
  /** 预览 / 源码。md 与 html 平台都先看排版，需要时再切源码 */
  const [viewMode, setViewMode] = useState<'preview' | 'source'>('preview')
  const scrollRef = useRef<HTMLDivElement>(null)
  const importPanelRef = useRef<ImportPanelHandle>(null)
  const mainTitleRef = useRef<HTMLHeadingElement>(null)
  /** 已加载的解析模块：load / restoreDraft 里先加载、再 setDoc，所以 previewHtml 的 useMemo 跑到时它一定已经在了 */
  const parseModRef = useRef<ParseModule | null>(null)
  const { items: toasts, push: toast, dismiss: dismissToast, pause: pauseToast, resume: resumeToast } = useToasts()

  /* ---------------- AI：状态与编排 ---------------- */
  /**
   * 章节切分。摘要、配图、发布轨道都按它走 ——
   * 必须排在 useAIJobs 之前，因为它就是这个 hook 的入参。
   */
  const sections = useMemo(() => (doc ? splitSections(doc) : []), [doc])

  // 摘要 / 四平台文案 / 标题候选 / 语气，以及三段流水线的并发与取消语义，
  // 都在 hooks/useAIJobs.ts 里。这里只拿结果和动作。
  const {
    tone,
    digest,
    platformStates,
    metaLab,
    setTone,
    adopt: adoptAI,
    reset: resetAI,
    generateDigest,
    generateCurrent,
    generateAll,
    cancelGenerate,
    generateMetaLab,
    cancelMetaLab,
    editSummary,
    editOneLiner,
  } = useAIJobs({ doc, sections, platform, toast })

  /** 复制后是否自动打开发布页。默认开，用户关掉后记住 */
  const [openOnCopy, setOpenOnCopy] = useState(loadOpenOnCopy)
  /**
   * 勾选 / 取消一个平台的显示。
   *
   * 必须挡住「全藏」：列表空了虽然还能从筛选面板找回来，但主区域会停在一个
   * 列表里根本不存在的平台上，看起来像坏了。
   */
  const togglePlatform = useCallback(
    (id: string) => {
      const next = new Set(hidden)
      if (next.has(id)) next.delete(id)
      else next.add(id)

      if (allPlatforms.every((p) => next.has(p.id))) {
        toast('至少要留一个平台，全藏了就没得看了', 'info')
        return
      }

      setHidden(next)
      if (!saveHidden(next)) toast('浏览器拒绝写入本地存储，这次的选择只在本次会话有效', 'error')
    },
    [hidden, toast],
  )

  const resetHidden = useCallback(() => {
    setHidden(new Set())
    if (!saveHidden([])) toast('浏览器拒绝写入本地存储，这次的选择只在本次会话有效', 'error')
  }, [toast])

  /** 当前平台被藏起来时（含从草稿恢复的情况）切到侧栏最上面那个，跟眼睛看到的一致 */
  useEffect(() => {
    if (!hidden.has(platform)) return
    const pick =
      sortByWidth(convertPlatforms.filter((p) => !hidden.has(p.id)))[0] ??
      sortByWidth(rewritePlatforms.filter((p) => !hidden.has(p.id)))[0] ??
      (hidden.has(cardPlatform.id) ? undefined : cardPlatform)
    if (pick) setPlatform(pick.id)
  }, [hidden, platform])

  const kind = kindOf(platform)
  /** 当前平台的发布页地址；卡片平台没有 */
  const publishTarget = publishUrlOf(platform)

  /* ---------------- 载入 ---------------- */

  /**
   * 导入。
   *
   * 若这篇（同 slug）已经有草稿、且正文结构没变，就把草稿里的 AI 产物接回来。
   * 只接 AI 产物、不接 meta：文件才是元信息的权威；而摘要 / 四平台文案 / 标题候选
   * 是花钱生成的，重来一次代价大得多。想沿用旧标题也不亏 —— 标题弹层里的候选
   * 一并恢复了，点一下就能重新套上。
   *
   * 正文结构变了（增删小节、大段增删）就不套旧文案：小节数对不上时，
   * AI 面板会显示「N 节」而摘要只有 M 条，看着像坏了，其实是两份东西。
   */
  const load = useCallback(
    async (source: string, name: string) => {
      const mod = await loadParseModule()
      parseModRef.current = mod
      const parsed = mod.parseArticle({ source, fileName: name })
      const key = articleKeyOf(parsed)
      const fp = fingerprintOf(parsed, splitSections(parsed).length)
      const saved = readDraft(key)

      setDoc(parsed)
      setFileName(name)
      setSourceText(source)
      setArticleKey(key)

      if (saved && parsed.blocks.length > 0 && saved.fingerprint === fp && draftValue(saved).worth) {
        adoptAI({
          digest: saved.digest,
          platformStates: saved.platformStates,
          metaLab: saved.metaLab,
          tone: saved.tone,
        })
        toast(`已解析「${parsed.meta.title}」· 接回 ${formatAgo(saved.updatedAt)} 的草稿`, 'success')
        return
      }

      resetAI()

      if (parsed.blocks.length === 0) {
        toast('解析后正文是空的，请检查文件内容', 'error')
      } else if (saved && saved.fingerprint !== fp) {
        toast(`已解析「${parsed.meta.title}」· 正文结构变了，旧草稿不再套用`, 'info')
      }
    },
    [toast, adoptAI, resetAI],
  )

  const updateMeta = useCallback((patch: Partial<DocMeta>) => {
    setDoc((d) => (d ? { ...d, meta: { ...d.meta, ...patch } } : d))
  }, [])

  /* ---------------- 渲染 ---------------- */

  /**
   * 已加载的平台渲染函数：7 个渲染器按平台拆包后，首屏不再包含任何一个。
   * 只有导入文章后、切到某个转换平台时，才加载它那一份。
   */
  const [renderFns, setRenderFns] = useState<Partial<Record<string, RenderFn>>>({})
  /** 当前平台渲染器加载失败时的原因；有值时 output 会变成一条报错产物 */
  const [renderLoadError, setRenderLoadError] = useState('')

  useEffect(() => {
    if (kind !== 'convert' || !doc) return
    if (renderFns[platform]) return
    let alive = true
    setRenderLoadError('')
    loadConvertRenderer(platform)
      .then((fn) => {
        if (!alive) return
        setRenderFns((prev) => (prev[platform] ? prev : { ...prev, [platform]: fn }))
      })
      .catch((e) => {
        if (!alive) return
        setRenderLoadError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      alive = false
    }
  }, [platform, kind, doc, renderFns])

  /**
   * 破图占位：预览是 dangerouslySetInnerHTML 插进去的 HTML，React 挂不上 onError。
   * 用捕获阶段的全局 error 监听（资源加载失败不冒泡，但捕获阶段能到 document），
   * 给预览里的破图打上 is-broken class，样式见 global.css。
   */
  useEffect(() => {
    const onError = (e: Event) => {
      const img = e.target as HTMLImageElement
      if (!(img instanceof HTMLImageElement)) return
      if (!img.closest('.md-preview, .rich-preview')) return
      if (img.classList.contains('is-broken')) return
      img.classList.add('is-broken')
      // alt 后面补一句「图片取不到」：破图框里显示的 alt 文字就是它
      img.alt = img.alt ? `${img.alt}（图片取不到）` : '图片取不到'
    }
    document.addEventListener('error', onError, true)
    return () => document.removeEventListener('error', onError, true)
  }, [])

  const output: RenderOutput | null = useMemo(() => {
    if (!doc || kind !== 'convert') return null
    const render = renderFns[platform]
    if (!render) {
      // 渲染器还在加载：返回 null，外层显示「加载中…」；
      // 加载失败则给一条报错产物，让提示条把原因说清楚。
      if (!renderLoadError) return null
      return {
        primary: '',
        text: '',
        format: 'text',
        copyMode: 'plain',
        warnings: [`渲染器加载失败：${renderLoadError}，刷新页面可重试`],
        stats: [],
      }
    }
    try {
      return render(doc, { wechatThemeId: themeId, tail, account })
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
  }, [doc, platform, themeId, kind, tail, account, renderFns, renderLoadError])

  /**
   * 公众号超限判定：按**字数**，和微信编辑器口径一致。
   * 别再拿 HTML 字符数去比 —— 内联样式会让 1.1 万字的稿子变成 5.9 万字符，
   * 那样每篇都会被误判超限。
   */
  const overLimit = Boolean(output && platform === 'wechat' && charCount(output.text) > WECHAT_WORD_LIMIT)

  /** Markdown 平台的阅读预览：和转换器共用同一套前置处理 */
  const previewHtml = useMemo(() => {
    if (!doc || kind !== 'convert' || !output || output.format !== 'markdown') return ''
    try {
      return parseModRef.current?.renderPreviewHtml(doc.rawMd) ?? ''
    } catch {
      return ''
    }
  }, [doc, kind, output])

  /**
   * 富文本预览只给站内看，复制出去的 HTML 不应带懒加载属性。
   * 长文一次插几十张图时，只让首屏附近的图片立即解码。
   *
   * 先过一遍允许列表再补属性：这段 HTML 是 dangerouslySetInnerHTML 插进我们
   * 自己的页面的，作者在 Markdown 里写的裸 HTML 会原样进来（公众号产物为了保真
   * 不剥内联样式），所以预览这一层必须自己兜住脚本。见 core/sanitize-preview.ts。
   */
  const richPreviewHtml = useMemo(
    () =>
      sanitizePreview(output?.html ?? '').replace(
        /<img\b(?![^>]*\bloading=)/g,
        '<img loading="lazy" decoding="async"',
      ),
    [output],
  )

  /** 能切「预览 / 源码」的平台：md 走渲染预览，公众号走富文本预览 */
  const canPreview = Boolean(
    output && (output.format === 'markdown' ? previewHtml : output.format === 'html' && output.html),
  )

  const { notices, formatNotes } = useMemo<{ notices: NoticeItem[]; formatNotes: string[] }>(() => {
    if (!output) return { notices: [], formatNotes: [] }
    const hasError = output.stats.some((s) => s.level === 'error')
    const warnings = output.warnings
      // 外链被转成文末参考链接是这些平台的固定转换结果，不是用户需要处理的异常。
      .filter((text) => !/外链.*(?:抽成文末|转文末)/.test(text))
    const actionable = warnings.filter((text) => /超过|超限|往期推荐|需在|请手动|无法|失败|错误/.test(text))
    const formatNotes = warnings.filter((text) => !actionable.includes(text))
    return {
      notices: actionable.map((text, i) => ({
        text,
        level: i === 0 && hasError ? 'error' : 'warn',
      })),
      formatNotes,
    }
  }, [output])

  /* ---------------- 发布台账 / 合规检查 / 图片清单 ---------------- */

  const {
    ledger,
    apply: applyLedger,
    changeStats,
    markPublished: markLedgerPublished,
  } = useLedger(articleKey, toast)

  /**
   * 跨篇复盘。
   *
   * 标题优先取草稿箱里的（那里存着每篇的完整 meta），草稿被淘汰了就退化成 slug ——
   * 至少还能认出是哪篇，不至于显示成「未命名」。
   */
  const reviewSheetOpen = sheet === 'review'
  const summaries = useMemo(() => {
    const titles = new Map(drafts.map((d) => [d.key, d.title]))
    if (doc) titles.set(articleKey, doc.meta.title)
    return summarizeAll(readAllLedgers(), (k) => titles.get(k))
    // 「复盘」打开时重读一次，避免在别的标签页改过之后看到旧数字；
    // ledger 也是刻意列的：刚在台账里改完数字，复盘要立刻反映出来
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ledger 只用来触发重读
  }, [drafts, doc, articleKey, ledger, reviewSheetOpen])

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

  /* ---------------- 草稿箱 ---------------- */

  // 自动保存：800ms 防抖、生成中跳过、内容没变不写、写失败只报一次。
  // 细节见 hooks/useDraftAutosave.ts。
  const { saveStatus, savedAt, adoptSnapshot } = useDraftAutosave({
    doc,
    articleKey,
    sourceText,
    fileName,
    tone,
    themeId,
    platform,
    digest,
    platformStates,
    metaLab,
    sectionCount: sections.length,
    onDrafts: setDrafts,
    toast,
  })

  /** 从草稿箱显式打开：这次连 meta 一起还原，用户要的就是「回到当时那一刻」 */
  const restoreDraft = useCallback(
    async (key: string) => {
      const d = readDraft(key)
      if (!d) {
        toast('草稿不见了，可能已被清空', 'error')
        setDrafts(listDrafts())
        return
      }
      const mod = await loadParseModule()
      parseModRef.current = mod
      const parsed = mod.parseArticle({ source: d.source, fileName: d.fileName })
      setDoc({ ...parsed, meta: d.meta })
      setFileName(d.fileName)
      setSourceText(d.source)
      setArticleKey(d.key)
      adoptAI({
        digest: d.digest,
        platformStates: d.platformStates,
        metaLab: d.metaLab,
        tone: d.tone,
      })
      setThemeId(d.themeId)
      if (d.platform) setPlatform(d.platform)
      // 打开草稿不该算「修改」：记下它，紧接着那次自动保存会判定内容没变而跳过
      adoptSnapshot(d)
      closeSheet()
      const restoredPlatform = d.platform && !hidden.has(d.platform)
        ? allPlatforms.find((item) => item.id === d.platform)?.name
        : null
      toast(restoredPlatform ? `已恢复草稿 · 继续在${restoredPlatform}` : '已恢复草稿', 'success')
    },
    [toast, setThemeId, hidden, adoptAI, adoptSnapshot, closeSheet],
  )

  const removeDraft = useCallback(
    (key: string) => {
      const { drafts: next, persisted } = deleteDraft(key)
      setDrafts(next)
      if (!persisted) {
        toast('删除没写进本地存储，刷新后这篇草稿还会回来', 'error')
        return
      }
    },
    [toast],
  )

  const wipeDrafts = useCallback(() => {
    if (!clearDrafts()) {
      toast('清空失败：浏览器拒绝访问本地存储', 'error')
      return
    }
    setDrafts([])
  }, [toast])

  /* ---------------- AI 服务商 ---------------- */

  const settingsSheetOpen = sheet === 'settings'
  const providerReady = useMemo(
    () => resolveProvider().provider !== null,
    // settingsVersion 在保存设置后 +1：Key 换了，可用性必须重算
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 用它当版本号触发重算
    [settingsVersion, settingsSheetOpen],
  )

  /* ---------------- 标题与标签 ---------------- */

  const applyTitle = useCallback(
    (title: string) => {
      updateMeta({ title })
      // 卡片不跟着变是刻意的：CardStudio 只在重新导入时重建，
      // 否则每改一次元信息就把用户手工调过的卡片文字冲掉
    },
    [updateMeta],
  )

  const applyTags = useCallback(
    (tags: string[]) => {
      if (!doc) return
      const merged = [...doc.meta.tags]
      for (const t of tags) if (!merged.includes(t)) merged.push(t)
      updateMeta({ tags: merged })
    },
    [doc, updateMeta],
  )

  // 切平台/切视图后回到顶部 —— 否则从长文滚到一半再切走，新面板会停在中间
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [platform, viewMode])

  // 一篇文章开一个标签页是常态，标题栏不能全叫「文章分发台」
  useEffect(() => {
    document.title = doc?.meta.title ? `${doc.meta.title} · 文章分发台` : '文章分发台'
  }, [doc?.meta.title])

  /** 清单里「去生成」要滚回顶部；单独拎出来是为了给它一个稳定的引用 */
  const scrollToTop = useCallback(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  /* ---------------- 复制 / 下载 ---------------- */

  // 复制 / 下载 / 导出全平台。这段的顺序约束（先同步复制再开标签）
  // 写在 hooks/useCopyActions.ts 的文件头，改动前先读那里。
  const {
    zipping,
    copyPlainText,
    copyTextOnly,
    doCopyPrimary,
    doCopySource,
    doDownload,
    doExportAllPlatforms,
    doSplitExport,
  } = useCopyActions({
    doc,
    output,
    articleKey,
    platform,
    ledger,
    applyLedger,
    openOnCopy,
    hidden,
    themeId,
    tail,
    account,
    toast,
  })

  const currentAI: AIState = isRewriteId(platform) ? platformStates[platform] : emptyAIState

  const currentPlatformMeta = useMemo(() => {
    if (kind === 'convert') return convertPlatforms.find((p) => p.id === platform)
    if (kind === 'rewrite') return rewritePlatforms.find((p) => p.id === platform)
    return { id: 'cards', name: '配图卡片', hint: '文字卡片 · 导出 PNG', limits: '小红书 3:4' }
  }, [platform, kind])

  const navStatus = useMemo(() => {
    const map: Record<string, AIState['status']> = {}
    for (const id of rewriteIds) map[id] = platformStates[id].status
    return map
  }, [platformStates])

  /** 台账进度：11 个发布平台里，真正确认发过几个 */
  const platformTotal = convertPlatforms.length + rewritePlatforms.length
  const ledgerDone = publishedCount(ledger)
  const currentPublished = Boolean(ledger[platform]?.at)
  const currentPrepared = Boolean(ledger[platform]?.copiedAt)

  const currentRewriteCopy = useMemo(() => {
    const result = currentAI.result
    if (!result || !isRewriteId(platform)) return null
    if (platform === 'xiaohongshu' && result.xhs) {
      return {
        text: `${result.xhs.title}\n\n${result.xhs.body}\n\n${result.xhs.tags.map((t) => `#${t}`).join(' ')}`,
        label: '小红书全文',
      }
    }
    if (platform === 'twitter' && result.twitter) {
      return {
        text: result.twitter.thread
          .map((t, i) => `${i + 1}/${result.twitter!.thread.length} ${t}`)
          .join('\n\n'),
        label: '完整 thread',
      }
    }
    if (platform === 'jike' && result.jike) {
      return { text: result.jike.body, label: '即刻正文' }
    }
    if (platform === 'weibo' && result.weibo) {
      return {
        text: `${result.weibo.text} ${result.weibo.topics.map((t) => `#${t}#`).join(' ')}`,
        label: '微博全文',
      }
    }
    return null
  }, [currentAI.result, platform])

  const currentGenerated =
    kind === 'convert'
      ? Boolean(output)
      : kind === 'rewrite'
        ? Boolean(currentAI.result)
        : Boolean(doc)

  /** 当前平台发布完成后，沿侧栏可见顺序找下一个未发布平台，末尾回到开头。 */
  const nextUnpublished = useMemo(() => {
    const visible = sortByWidth(
      [...convertPlatforms, ...rewritePlatforms].filter((item) => !hidden.has(item.id)),
    )
    const index = visible.findIndex((item) => item.id === platform)
    const ordered = index >= 0 ? [...visible.slice(index + 1), ...visible.slice(0, index + 1)] : visible
    return ordered.find((item) => !ledger[item.id]?.at) ?? null
  }, [hidden, ledger, platform])

  const ledgerContentStates = useMemo<Record<string, LedgerContentState>>(() => {
    const states: Record<string, LedgerContentState> = {}
    for (const item of convertPlatforms) {
      states[item.id] = item.id === platform && output ? 'ready' : 'available'
    }
    for (const item of rewritePlatforms) {
      const id = item.id as RewriteId
      const state = platformStates[id]
      states[id] = state.status === 'running' ? 'running' : state.result ? 'ready' : 'pending'
    }
    return states
  }, [output, platform, platformStates])

  const allPublished = ledgerDone === platformTotal

  /**
   * 主界面只保留真正影响发布判断的字数。
   * HTML 体积、图片数、外链数等实现细节仍在渲染产物的 stats 里，
   * 需要时由发布准备和对应面板承接，不再长期占据主标题下方。
   */
  const summaryStats = useMemo(() => {
    if (!doc || !output) return []
    if (platform === 'wechat') {
      return output.stats.filter((stat) => stat.label === '正文' || stat.label === '含文末')
    }
    return [{ label: '正文', value: `${charCount(output.text).toLocaleString()} 字符` }]
  }, [doc, output, platform])

  const markCurrentPublished = useCallback(() => {
    markLedgerPublished(platform)
  }, [markLedgerPublished, platform])

  const copyCurrentResult = useCallback(() => {
    if (kind === 'convert') {
      doCopyPrimary()
      return
    }
    if (kind === 'rewrite') {
      if (!currentRewriteCopy) {
        toast('还没有可复制的文案，先点「生成」', 'info')
        return
      }
      void copyPlainText(currentRewriteCopy.text, currentRewriteCopy.label)
      return
    }
    toast('配图卡片请点「导出 PNG」', 'info')
  }, [kind, doCopyPrimary, currentRewriteCopy, copyPlainText, toast])

  const readiness = useReadiness({
    doc,
    kind,
    output,
    platform,
    tail,
    platformName: currentPlatformMeta?.name,
    hasAIResult: Boolean(currentAI.result),
    rewriteLabel: currentRewriteCopy?.label ?? null,
    complianceHits,
    scopeLabel,
    checkContent,
    imageCount: images.length,
    openSheet: setSheet,
    closeSheet,
    scrollToTop,
  })

  const palettePlatforms = useMemo(
    () =>
      platformGroups.flatMap((group) =>
        group.list
          .filter((item) => !hidden.has(item.id))
          .map((item) => ({
            id: item.id,
            name: item.name,
            hint: item.hint,
            group: group.label.split(' · ')[0] ?? group.label,
          })),
      ),
    [hidden],
  )

  const visiblePlatformOrder = useMemo(
    () => [
      ...sortByWidth(convertPlatforms.filter((item) => !hidden.has(item.id))),
      ...sortByWidth(rewritePlatforms.filter((item) => !hidden.has(item.id))),
      ...(hidden.has(cardPlatform.id) ? [] : [cardPlatform]),
    ],
    [hidden],
  )

  const selectPlatform = useCallback((id: string) => {
    setPlatform(id)
    setSidebarOpen(false)
    requestAnimationFrame(() => mainTitleRef.current?.focus({ preventScroll: true }))
  }, [])

  /* ---------------- 操作条高度 → CSS 变量 ---------------- */

  /**
   * toast 要浮在操作条上面，而操作条在窄窗口里会换行变高（实测 900px 宽时 56px → 94px）。
   * 写死 `bottom: 78px` 在那种宽度下会把提示压在「导出全平台」上，所以量出来交给 CSS。
   */
  const actionbarRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = actionbarRef.current
    const root = document.documentElement
    if (!el) {
      root.style.removeProperty('--actionbar-h')
      return
    }
    const apply = () => {
      root.style.setProperty('--actionbar-h', `${Math.round(el.getBoundingClientRect().height)}px`)
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => {
      ro.disconnect()
      root.style.removeProperty('--actionbar-h')
    }
  }, [doc])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey
      if (!mod) {
        const target = event.target instanceof HTMLElement ? event.target : null
        const typing = Boolean(target?.closest('input, textarea, select, [contenteditable="true"]'))
        if (
          doc &&
          !typing &&
          !event.altKey &&
          !document.querySelector('[role="dialog"]') &&
          (event.key === '[' || event.key === ']')
        ) {
          event.preventDefault()
          const current = visiblePlatformOrder.findIndex((item) => item.id === platform)
          const delta = event.key === ']' ? 1 : -1
          const next =
            visiblePlatformOrder[
              (Math.max(0, current) + delta + visiblePlatformOrder.length) % visiblePlatformOrder.length
            ]
          if (next) selectPlatform(next.id)
        }
        return
      }

      if (event.key.toLowerCase() === 'k') {
        event.preventDefault()
        if (!document.querySelector('[role="dialog"]')) setSheet('palette')
        return
      }

      if (event.key === 'Enter' && doc && !document.querySelector('[role="dialog"]')) {
        event.preventDefault()
        copyCurrentResult()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [doc, copyCurrentResult, visiblePlatformOrder, platform, selectPlatform])

  useEffect(() => {
    if (!sidebarOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSidebarOpen(false)
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [sidebarOpen])

  return (
    <div className={`app ${sidebarOpen ? 'sidebar-open' : ''}`}>
      {/* ================= 顶栏 ================= */}
      <header className="topbar">
        <button
          className="sidebar-toggle"
          onClick={() => setSidebarOpen((value) => !value)}
          aria-expanded={sidebarOpen}
          aria-label={sidebarOpen ? '收起平台列表' : '展开平台列表'}
        >
          <span aria-hidden>{sidebarOpen ? '×' : '☰'}</span>
          <span>平台</span>
        </button>

        <div className="brand">
          <img className="brand-icon" src="./icon.svg" alt="" width={26} height={26} />
          <span className="brand-mark">文章分发台</span>
        </div>

        <div className="topbar-spacer" />

        {doc ? (
          <button
            className={`save-status ${saveStatus}`}
            onClick={() => {
              setDrafts(listDrafts())
              setSheet('drafts')
            }}
            title="打开草稿箱"
            /* 不挂 aria-live：每停顿 800ms 就播报一次「已保存 14:03」太吵。
               真正需要播报的是保存失败，那条走的是 role=alert 的 toast。 */
          >
            <span className="save-dot" aria-hidden />
            {saveStatus === 'saving'
              ? '保存中…'
              : saveStatus === 'error'
                ? '保存失败'
                : savedAt
                  ? `已保存 ${new Date(savedAt).toLocaleTimeString('zh-CN', {
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false,
                    })}`
                  : '已保存'}
          </button>
        ) : null}

        {doc ? (
          <button
            className={`btn btn-sm btn-quiet ledger-entry ${ledgerDone === platformTotal ? 'complete' : ''}`}
            onClick={() => {
              setLedgerFocusPlatform('')
              setSheet('ledger')
            }}
            title="发布台账：记录这篇文章发到哪几个平台、什么时候、链接是什么"
          >
            {allPublished ? `已完成 ${platformTotal}/${platformTotal}` : `台账 ${ledgerDone}/${platformTotal}`}
          </button>
        ) : null}

        <details
          className="topbar-tools"
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
              e.currentTarget.removeAttribute('open')
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') e.currentTarget.removeAttribute('open')
          }}
        >
          <summary className="btn btn-sm btn-quiet topbar-tools-trigger">工具</summary>
          <div className="topbar-menu">
            {doc ? (
              <button
                aria-label="复盘"
                data-return-focus=".topbar-tools-trigger"
                onClick={() => setSheet('review')}
              >
                <span>复盘</span>
              </button>
            ) : null}
            <button
              aria-label="故障排查"
              data-return-focus=".topbar-tools-trigger"
              onClick={() => setSheet('recovery')}
            >
              <span>故障排查</span>
            </button>
            <button
              aria-label="打开草稿箱"
              data-return-focus=".topbar-tools-trigger"
              onClick={() => {
                setDrafts(listDrafts())
                setSheet('drafts')
              }}
            >
              <span>草稿{drafts.length > 0 ? ` ${drafts.length}` : ''}</span>
            </button>
            <button
              aria-label="打开设置"
              data-return-focus=".topbar-tools-trigger"
              onClick={() => {
                setSheet('settings')
              }}
            >
              <span>设置</span>
            </button>
          </div>
        </details>
      </header>

      <div className="app-body">
        {/* ================= 侧栏 ================= */}
        <aside className="sidebar">
          <ImportPanel
            ref={importPanelRef}
            currentName={fileName}
            meta={doc?.meta}
            onMetaChange={updateMeta}
            metaOpenSignal={metaEditorSignal}
            onLoad={load}
            onError={(m) => toast(m, 'error')}
            onNotice={(m) => toast(m, 'info')}
          />
          <PlatformNav
            active={platform}
            onSelect={selectPlatform}
            platformStatus={navStatus}
            published={ledger}
            hidden={hidden}
            onOpenFilter={() => setSheet('filter')}
            onQuickSwitch={() => setSheet('palette')}
          />
        </aside>
        {sidebarOpen ? (
          <button
            className="sidebar-scrim"
            onClick={() => setSidebarOpen(false)}
            aria-label="关闭平台列表"
          />
        ) : null}

        {/* ================= 主区域 ================= */}
        <main className="main">
          <div className="main-head">
            <div className="head-row">
              <div className="head-title">
                <h1
                  className="main-title"
                  ref={mainTitleRef}
                  tabIndex={-1}
                  aria-keyshortcuts="BracketLeft BracketRight"
                  title="按 [ / ] 切换平台"
                >
                  {currentPlatformMeta?.name}
                </h1>
              </div>

              <div className="head-tools">
                {doc ? (
                  <button
                    className={`readiness-entry tone-${readiness.tone}`}
                    onClick={() => setSheet('readiness')}
                    title="查看标题、正文、合规与素材的发布准备状态"
                  >
                    <span className="readiness-dot" aria-hidden />
                    <span>发布准备</span>
                    {readiness.done < readiness.required.length ? (
                      <strong>
                        {readiness.done}/{readiness.required.length}
                      </strong>
                    ) : null}
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

            {doc ? (
              <ol className="dispatch-rail" aria-label="当前平台的发布进度">
                <li className="done">
                  <button
                    className="dispatch-step"
                    onClick={() => {
                      setMetaEditorSignal((value) => value + 1)
                      setSidebarOpen(true)
                    }}
                  >
                    草稿
                  </button>
                </li>
                <li className={currentGenerated ? 'done' : 'current'}>
                  <button
                    className="dispatch-step"
                    onClick={() => {
                      scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
                      if (canPreview) setViewMode('preview')
                    }}
                  >
                    已生成
                  </button>
                </li>
                <li className={currentPrepared || currentPublished ? 'done' : currentGenerated ? 'current' : ''}>
                  <button
                    className="dispatch-step"
                    onClick={() => {
                      setLedgerFocusPlatform(platform)
                      setSheet('ledger')
                    }}
                  >
                    待发布
                  </button>
                </li>
                <li className={currentPublished ? 'current published' : ''}>
                  <button
                    className="dispatch-step"
                    onClick={() => {
                      setLedgerFocusPlatform(platform)
                      setSheet('ledger')
                    }}
                  >
                    已发布
                  </button>
                </li>
              </ol>
            ) : null}

            <div className="main-meta-row">
              <p className="main-hint">
                {currentPlatformMeta?.hint}
                {currentPlatformMeta?.limits ? (
                  <span
                    className="limit-note"
                    title={`${currentPlatformMeta.name}的平台限制`}
                  >
                    {currentPlatformMeta.limits}
                  </span>
                ) : null}
              </p>
              {doc && summaryStats.length > 0 ? (
                <div className="stats-bar">
                  {summaryStats.map((s, i) => (
                    <span key={i} className={`stat-chip ${s.level ?? ''}`}>
                      <span className="stat-label">{s.label}</span>
                      {s.value}
                    </span>
                  ))}
                </div>
              ) : null}
              {doc && kind === 'convert' && platform === 'wechat' ? (
                <ThemePicker value={themeId} onChange={setThemeId} />
              ) : null}
            </div>
          </div>

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
                  在左侧「文章」区拖入、选择或粘贴 Markdown 文件。
                </div>
                <div className="empty-actions">
                  <button
                    className="btn btn-accent empty-primary"
                    onClick={() => importPanelRef.current?.chooseFile()}
                  >
                    选择 Markdown 文件
                  </button>
                  <button className="btn" onClick={() => void load(SAMPLE_ARTICLE, '示例文章.md')}>
                    载入示例文章
                  </button>
                </div>
                <a
                  className="empty-help"
                  href="https://github.com/hulatu/Publishing_Platform/blob/main/USAGE.md"
                  target="_blank"
                  rel="noreferrer"
                >
                  第一次用？看使用说明 →
                </a>
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

                {formatNotes.length > 0 ? (
                  <details className="details format-notes">
                    <summary>转换说明（{formatNotes.length}）</summary>
                    <div className="details-body">
                      {formatNotes.map((note, i) => (
                        <div key={i}>· {note}</div>
                      ))}
                    </div>
                  </details>
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
                  {kind === 'convert' ? (
                    output ? (
                    viewMode === 'preview' && canPreview ? (
                      output.format === 'html' && output.html ? (
                        <div className="rich-preview" dangerouslySetInnerHTML={{ __html: richPreviewHtml }} />
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
                    ) : (
                      <div className="panel-card">
                        <p>加载中…</p>
                      </div>
                    )
                  ) : kind === 'rewrite' && isRewriteId(platform) ? (
                    <div className="panel-card">
                      <Suspense fallback={<p>加载中…</p>}>
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
                        onOpenSettings={() => setSheet('settings')}
                      />
                      </Suspense>
                    </div>
                  ) : (
                    <div className="panel-card">
                      <Suspense fallback={<p>加载中…</p>}>
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
                      </Suspense>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* ---------- 操作条 ---------- */}
          {doc ? (
            <ActionBar
              kind={kind}
              doc={doc}
              output={output}
              platformName={currentPlatformMeta?.name ?? ''}
              publishTarget={publishTarget}
              currentPrepared={currentPrepared}
              currentPublished={currentPublished}
              currentGenerated={currentGenerated}
              allPublished={allPublished}
              platformTotal={platformTotal}
              nextUnpublished={nextUnpublished}
              busy={currentAI.status === 'running' || digest.status === 'running'}
              aiRunning={currentAI.status === 'running'}
              hasRewriteResult={Boolean(currentAI.result)}
              canCopyRewrite={Boolean(currentAI.result) && Boolean(currentRewriteCopy)}
              rewriteCopyLabel={currentRewriteCopy?.label ?? null}
              zipping={zipping}
              openOnCopy={openOnCopy}
              onToggleOpenOnCopy={(on) => {
                setOpenOnCopy(on)
                saveOpenOnCopy(on)
              }}
              onCopyPrimary={doCopyPrimary}
              onCopySource={doCopySource}
              onDownload={doDownload}
              onExportAll={() => void doExportAllPlatforms()}
              onGenerateAll={() => void generateAll()}
              onCopyCurrent={copyCurrentResult}
              onGenerateCurrent={() => void generateCurrent()}
              onMarkPublished={markCurrentPublished}
              onSelectPlatform={selectPlatform}
              actionbarRef={actionbarRef}
            />
          ) : null}
        </main>
      </div>

      <Sheet id="settings" current={sheet}>
        <SettingsSheet
          open
          onClose={closeSheet}
          onSaved={(m, kind = 'success') => {
            setSettingsVersion((v) => v + 1)
            toast(m, kind)
          }}
        />
      </Sheet>

      {doc ? (
        <Sheet id="ledger" current={sheet}>
          <PublishLedger
            open
            onClose={() => {
              closeSheet()
              setLedgerFocusPlatform('')
            }}
            title={doc.meta.title}
            ledger={ledger}
            contentStates={ledgerContentStates}
            focusPlatform={ledgerFocusPlatform}
            onSelectPlatform={selectPlatform}
            onMark={(id) => markLedgerPublished(id)}
            onUnmark={(id) => applyLedger(unmarkPublished(articleKey, id))}
            onSetUrl={(id, url) => applyLedger(setLedgerUrl(articleKey, id, url))}
            onClear={() => {
              // 失败时 applyLedger 已经报过错，别再补一条「已清空」
              applyLedger(clearArticle(articleKey))
            }}
          />
        </Sheet>
      ) : null}

      <Sheet id="images" current={sheet}>
        <ImageList
          open
          onClose={closeSheet}
          images={images}
          title={doc?.meta.title ?? '文章'}
          platform={platform}
          platformLabel={allPlatforms.find((p) => p.id === platform)?.name ?? platform}
        />
      </Sheet>

      <Sheet id="cover" current={sheet}>
        <CoverSheet
          open
          onClose={closeSheet}
          doc={doc}
          onToast={toast}
          onOpenSettings={() => setSheet('settings')}
        />
      </Sheet>

      {doc ? (
        <Sheet id="meta" current={sheet}>
          <MetaLab
            open
            onClose={closeSheet}
            state={metaLab}
            currentTitle={doc.meta.title}
            currentTags={doc.meta.tags}
            onRun={generateMetaLab}
            onCancel={cancelMetaLab}
            onApplyTitle={applyTitle}
            onApplyTags={applyTags}
            onCopy={copyTextOnly}
            providerReady={providerReady}
            onOpenSettings={() => setSheet('settings')}
          />
        </Sheet>
      ) : null}

      <Sheet id="tail" current={sheet}>
        <TailSheet
          open
          onClose={closeSheet}
          cfg={tail}
          account={account}
          themeId={themeId}
          onChange={changeTail}
          onAccountChange={changeAccount}
        />
      </Sheet>

      <Sheet id="drafts" current={sheet}>
        <DraftsSheet
          open
          onClose={closeSheet}
          drafts={drafts}
          currentKey={articleKey}
          onOpen={restoreDraft}
          onDelete={removeDraft}
          onClearAll={wipeDrafts}
        />
      </Sheet>

      <Sheet id="review" current={sheet}>
        <ReviewSheet
          open
          onClose={closeSheet}
          articleTitle={doc?.meta.title ?? ''}
          ledger={ledger}
          summaries={summaries}
          onSetStats={changeStats}
        />
      </Sheet>

      <Sheet id="recovery" current={sheet}>
        <RecoverySheet
          open
          onClose={closeSheet}
          providerReady={providerReady}
          imageCount={images.length}
          onOpenSettings={() => setSheet('settings')}
          onOpenImages={() => setSheet('images')}
          onOpenDrafts={() => {
            setDrafts(listDrafts())
            setSheet('drafts')
          }}
        />
      </Sheet>

      <Sheet id="filter" current={sheet}>
        <PlatformFilterSheet
          open
          onClose={closeSheet}
          hidden={hidden}
          onToggle={togglePlatform}
          onReset={resetHidden}
        />
      </Sheet>

      {doc ? (
        <Sheet id="readiness" current={sheet}>
          <ReadinessSheet
            open
            onClose={closeSheet}
            title={doc.meta.title}
            platformName={currentPlatformMeta?.name ?? platform}
            items={readiness.items}
          />
        </Sheet>
      ) : null}

      <Sheet id="palette" current={sheet}>
        <PlatformPalette
          open
          onClose={closeSheet}
          active={platform}
          platforms={palettePlatforms}
          onSelect={selectPlatform}
        />
      </Sheet>

      <ToastLayer
        items={toasts}
        onDismiss={dismissToast}
        onPause={pauseToast}
        onResume={resumeToast}
      />
    </div>
  )
}
