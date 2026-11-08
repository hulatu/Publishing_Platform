import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Doc, DocMeta } from './core/ir'
import { blocksToText, collectImages } from './core/ir'
import { parseArticle, renderPreviewHtml } from './core/parse'
import { charCount } from './core/cjk'
import { splitSections } from './core/sections'
import { copyByMode, copyPlain, copySync, downloadText, mimeFor } from './core/copy'
import { splitByH2 } from './core/split'
import { checkText, scopeOf, stripHtml } from './core/compliance'
import { activeBlocks, readTailConfig, writeTailConfig, type TailConfig } from './core/tail'
import { whenIdle } from './core/async'
import { loadOpenOnCopy, preopenTab, publishUrlOf, saveOpenOnCopy } from './core/publish'
import {
  clearDrafts,
  deleteDraft,
  draftValue,
  fingerprintOf,
  formatAgo,
  listDrafts,
  readDraft,
  sameDraft,
  sanitizeForStore,
  writeDraft,
  type DraftSnapshot,
} from './core/drafts'
import {
  articleKeyOf,
  clearArticle,
  markPublished as markRecord,
  readAllLedgers,
  readLedger,
  setStats as setLedgerStats,
  setUrl as setLedgerUrl,
  unmark,
  type ArticleLedger,
  type LedgerWrite,
  type PlatformStats,
} from './core/ledger'
import { summarizeAll } from './core/review'
import { allPlatforms, cardPlatform, convertPlatforms, getConvertPlatform, rewritePlatforms, type RenderOutput } from './renderers'
import { downloadBlob, safeFileName } from './cards/export'
import { loadHidden, saveHidden, sortByWidth } from './core/platform-visibility'
import { WECHAT_WORD_LIMIT } from './renderers/wechat'
import { ThemePicker } from './components/ThemePicker'
import { wechatThemes } from './themes/wechat'
import { runDigest, runPlatform } from './ai/pipeline'
import { runMetaLab } from './ai/meta-lab'
import { resolveProvider } from './ai/provider'
import {
  emptyAIState,
  emptyDigestState,
  emptyMetaLabState,
  emptyPlatformStates,
  rewriteIds,
  type AIState,
  type DigestSet,
  type DigestState,
  type MetaLabState,
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
import { CoverSheet } from './components/CoverSheet'
import { rewriteImageSrc, type AssetFile } from './core/local-assets'
import { MetaLab } from './components/MetaLab'
import { TailSheet } from './components/TailSheet'
import { DraftsSheet } from './components/DraftsSheet'
import { ReviewSheet } from './components/ReviewSheet'
import { PlatformFilterSheet } from './components/PlatformFilterSheet'
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
 * 复制失败时的提示文案。
 *
 * 「剪贴板没被改写」这句必须说清：写失败时剪贴板里留的是**上一次**的内容，
 * 用户直接粘出来会以为「复制不全、后半篇丢了」，其实是拿到了旧快照。
 */
const COPY_FAILED = '复制失败：剪贴板没被改写，里面还是上一次的内容'

export default function App() {
  const [doc, setDoc] = useState<Doc | null>(null)
  const [fileName, setFileName] = useState('')
  const [platform, setPlatform] = useState('wechat')
  /** 侧栏隐藏了哪些平台。只是显示偏好，不影响渲染、台账和生成 */
  const [hidden, setHidden] = useState(() => loadHidden(allPlatforms.map((p) => p.id)))
  const [filterOpen, setFilterOpen] = useState(false)
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
  /** 封面图：从 Unsplash 按文章搜 3 张候选 */
  const [coverOpen, setCoverOpen] = useState(false)
  /** 标题候选 + 标签推荐 */
  const [metaLab, setMetaLab] = useState<MetaLabState>(emptyMetaLabState)
  const [metaOpen, setMetaOpen] = useState(false)
  /** 公众号文末三块（账号级配置，和文章无关，所以存在 localStorage 而不是 doc 里） */
  const [tail, setTail] = useState<TailConfig>(readTailConfig)
  const [account, setAccount] = useState(readStoredAccount)
  const [tailOpen, setTailOpen] = useState(false)
  /** 导入时的完整原文（含 front matter），草稿要连正文一起存才恢复得回来 */
  const [sourceText, setSourceText] = useState('')
  /** 和 md 一起拖进来的本地图片，上传图床时按路径匹配 */
  const [assets, setAssets] = useState<AssetFile[]>([])
  const [drafts, setDrafts] = useState<DraftSnapshot[]>(listDrafts)
  const [draftsOpen, setDraftsOpen] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const saveTimer = useRef<number | null>(null)
  /** 草稿存盘失败只提醒一次，别每 800ms 弹一条 */
  const saveFailedRef = useRef(false)
  /** 上次真正落盘的那份快照，用来跳过「内容没变」的重复写入 */
  const lastSnapRef = useRef<DraftSnapshot | null>(null)
  /** 预览 / 源码。md 与 html 平台都先看排版，需要时再切源码 */
  const [viewMode, setViewMode] = useState<'preview' | 'source'>('preview')
  /** 「导出全平台」打包中 */
  const [zipping, setZipping] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const { items: toasts, push: toast } = useToasts()

  /** 复制后是否自动打开发布页。默认开，用户关掉后记住 */
  const [openOnCopy, setOpenOnCopy] = useState(loadOpenOnCopy)
  /** 上一次自动打开的时间，用来挡住连点两下复制时开出两个标签 */
  const lastOpenRef = useRef(0)

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
    (source: string, name: string, nextAssets: AssetFile[] = []) => {
      const parsed = parseArticle({ source, fileName: name })
      const key = articleKeyOf(parsed)
      const fp = fingerprintOf(parsed, splitSections(parsed).length)
      const saved = readDraft(key)

      setDoc(parsed)
      setFileName(name)
      setSourceText(source)
      setArticleKey(key)
      setAssets(nextAssets)

      if (saved && parsed.blocks.length > 0 && saved.fingerprint === fp && draftValue(saved).worth) {
        setDigest(saved.digest)
        setPlatformStates(saved.platformStates)
        setMetaLab(saved.metaLab)
        setTone(saved.tone)
        toast(`已解析「${parsed.meta.title}」· 接回 ${formatAgo(saved.updatedAt)} 的草稿`, 'success')
        return
      }

      setDigest(emptyDigestState)
      setPlatformStates(emptyPlatformStates())
      setMetaLab(emptyMetaLabState)

      if (parsed.blocks.length === 0) {
        toast('解析后正文是空的，请检查文件内容', 'error')
      } else if (saved && saved.fingerprint !== fp) {
        toast(`已解析「${parsed.meta.title}」· 正文结构变了，旧草稿不再套用`, 'info')
      } else {
        toast(`已解析「${parsed.meta.title}」`, 'success')
      }
    },
    [toast],
  )

  const updateMeta = useCallback((patch: Partial<DocMeta>) => {
    setDoc((d) => (d ? { ...d, meta: { ...d.meta, ...patch } } : d))
  }, [])

  /**
   * 图床上传完成后，把正文里的本地路径换成图床地址。
   *
   * 只替换「图片语法里」的地址，不做全局字符串替换 —— `images/a.jpg` 这种串
   * 完全可能出现在正文说明或代码块里，全局换会把文章改坏。
   *
   * 替换后重新解析，让预览、复制、导出全部用上新链接；但**不动**已经生成的
   * AI 文案和台账 —— 换个图片地址不该把摘要和改写结果清空。
   */
  const applyHostUrls = useCallback(
    (mapping: Map<string, string>) => {
      if (mapping.size === 0) return
      const next = rewriteImageSrc(sourceText, mapping)
      if (next === sourceText) return
      setSourceText(next)
      setDoc(parseArticle({ source: next, fileName }))
    },
    [sourceText, fileName],
  )

  const addAssets = useCallback((more: AssetFile[]) => {
    setAssets((prev) => {
      // 同路径的后来者覆盖前面的：用户补选就是为了换掉缺的那张
      const map = new Map(prev.map((a) => [a.path, a]))
      for (const a of more) map.set(a.path, a)
      return [...map.values()]
    })
  }, [])

  /* ---------------- 渲染 ---------------- */

  const output: RenderOutput | null = useMemo(() => {
    if (!doc || kind !== 'convert') return null
    const p = getConvertPlatform(platform)
    if (!p) return null
    try {
      return p.render(doc, { wechatThemeId: themeId, tail, account })
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
  }, [doc, platform, themeId, kind, tail, account])

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

  /**
   * 跨篇复盘。
   *
   * 标题优先取草稿箱里的（那里存着每篇的完整 meta），草稿被淘汰了就退化成 slug ——
   * 至少还能认出是哪篇，不至于显示成「未命名」。
   */
  const summaries = useMemo(() => {
    const titles = new Map(drafts.map((d) => [d.key, d.title]))
    if (doc) titles.set(articleKey, doc.meta.title)
    return summarizeAll(readAllLedgers(), (k) => titles.get(k))
    // reviewOpen 进依赖：每次打开都重读，避免在别的标签页改过之后看到旧数字
  }, [drafts, doc, articleKey, ledger, reviewOpen])

  /**
   * 落地一次台账写操作。
   *
   * 内存里的值照常更新（点了「标记已发」必须立刻有反应），
   * 但落盘失败要说出来 —— 否则刷新之后记录全没，用户还以为自己记过。
   * 只提醒一次，避免每敲一个数字弹一条。
   *
   * 返回是否真的写进了本地存储：调用方要据此决定还能不能说「已记为已发」，
   * 否则会先弹一条红字「没存上」、紧跟一条绿字「已记为已发」。
   */
  const ledgerFailedRef = useRef(false)
  const applyLedger = useCallback(
    (w: LedgerWrite): boolean => {
      setLedger(w.ledger)
      if (w.persisted) {
        ledgerFailedRef.current = false
        return true
      }
      if (!ledgerFailedRef.current) {
        ledgerFailedRef.current = true
        toast('台账没存上：浏览器本地存储已满或被禁用。这次的记录刷新后会丢', 'error')
      }
      return false
    },
    [toast],
  )

  const changeStats = useCallback(
    (platformId: string, patch: PlatformStats) => {
      if (!articleKey) return
      applyLedger(setLedgerStats(articleKey, platformId, patch))
    },
    [articleKey, applyLedger],
  )

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

  /* ---------------- 草稿箱 ---------------- */

  /**
   * 自动保存，延迟 800ms。
   *
   * 没有保存按钮：用户会忘。但也不能每次按键都写盘 —— 一篇文章的草稿带正文
   * 约 30–60KB，逐字序列化会把主线程卡出明显的输入延迟。
   *
   * 生成过程中整个跳过：streaming 每 100ms 涨一次，写进去既没用又浪费配额。
   */
  useEffect(() => {
    if (!doc || !articleKey || !sourceText) return
    const busy =
      digest.status === 'running' ||
      metaLab.status === 'running' ||
      Object.values(platformStates).some((s) => s.status === 'running')
    if (busy) return

    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      const snap = sanitizeForStore({
        key: articleKey,
        doc,
        source: sourceText,
        fileName,
        tone,
        themeId,
        platform,
        digest,
        platformStates,
        metaLab,
        sectionCount: sections.length,
      })
      // 写盘挪到空闲时段：一篇文章带正文 30–60KB，同步写会卡主线程十几毫秒，
      // 而 800ms 的防抖窗口正好是用户还在打字的时候
      whenIdle(() => {
        // 内容一个字没变（只是打开草稿 / 切了标签）就别写，
        // 否则「最后修改时间」会变成「最后看了一眼的时间」
        if (sameDraft(lastSnapRef.current, snap)) return
        const ok = writeDraft(snap)
        setDrafts(listDrafts())
        // 草稿箱的全部价值就是「关掉页面也不会丢」。存不下却不说，
        // 等于骗用户 —— localStorage 满或隐私模式时必须让他知道
        if (!ok) {
          if (!saveFailedRef.current) {
            saveFailedRef.current = true
            toast('草稿没存上：浏览器本地存储已满或被禁用。先删几篇旧草稿再试', 'error')
          }
        } else {
          saveFailedRef.current = false
          lastSnapRef.current = snap
        }
      })
    }, 800)

    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
    }
  }, [doc, articleKey, sourceText, fileName, tone, themeId, platform, digest, platformStates, metaLab, sections.length, toast])

  /** 从草稿箱显式打开：这次连 meta 一起还原，用户要的就是「回到当时那一刻」 */
  const restoreDraft = useCallback(
    (key: string) => {
      const d = readDraft(key)
      if (!d) {
        toast('草稿不见了，可能已被清空', 'error')
        setDrafts(listDrafts())
        return
      }
      const parsed = parseArticle({ source: d.source, fileName: d.fileName })
      setDoc({ ...parsed, meta: d.meta })
      setFileName(d.fileName)
      setSourceText(d.source)
      setArticleKey(d.key)
      setDigest(d.digest)
      setPlatformStates(d.platformStates)
      setMetaLab(d.metaLab)
      setTone(d.tone)
      setThemeId(d.themeId)
      if (d.platform) setPlatform(d.platform)
      // 打开草稿不该算「修改」：记下它，紧接着那次自动保存会判定内容没变而跳过
      lastSnapRef.current = d
      setDraftsOpen(false)
      toast(`已打开草稿「${d.meta.title}」`, 'success')
    },
    [toast, setThemeId],
  )

  const removeDraft = useCallback(
    (key: string) => {
      const { drafts: next, persisted } = deleteDraft(key)
      setDrafts(next)
      if (!persisted) {
        toast('删除没写进本地存储，刷新后这篇草稿还会回来', 'error')
        return
      }
      toast('已删除这篇草稿')
    },
    [toast],
  )

  const wipeDrafts = useCallback(() => {
    if (!clearDrafts()) {
      toast('清空失败：浏览器拒绝访问本地存储', 'error')
      return
    }
    setDrafts([])
    toast('草稿箱已清空')
  }, [toast])

  /* ---------------- AI 编排 ---------------- */

  const providerReady = useMemo(
    () => resolveProvider().provider !== null,
    // settingsVersion 在保存设置后 +1，用于强制重算
    [settingsVersion, settingsOpen],
  )

  /**
   * 本帧的 AI 状态快照。
   *
   * 中断时流水线返回的是「空状态」，直接 setState 会让用户按一下「停止」
   * 就把已经花钱生成好的摘要 / 文案一起抹掉 —— 所以取消时要用它还原上一版。
   */
  const aiSnapshot = useRef({ digest, platformStates, metaLab })
  aiSnapshot.current = { digest, platformStates, metaLab }

  const startJob = useCallback(() => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    return controller
  }, [])

  /**
   * 这次中断是不是「用户按了停止」。
   *
   * 被新任务顶掉时 abortRef 已经指向新任务，那种情况不能还原 ——
   * 否则旧任务收尾时会把新任务刚写进去的「生成中」状态盖回去。
   */
  const isUserAbort = useCallback((controller: AbortController) => {
    return controller.signal.aborted && abortRef.current === controller
  }, [])

  /**
   * 意料之外的异常兜底。
   *
   * 流水线内部已经把能处理的错误都转成状态了，走到这里说明是真没料到的
   * （prompt 拼装抛错、浏览器扩展拦截之类）。必须把 running 收掉，
   * 否则按钮永远停在「生成中」，用户只能刷新页面。
   */
  const failJob = useCallback(
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      setDigest((p) => (p.status === 'running' ? { ...p, status: 'error', error: msg } : p))
      setPlatformStates((prev) => {
        let touched = false
        const next = { ...prev }
        for (const id of rewriteIds) {
          if (next[id].status === 'running') {
            next[id] = { ...next[id], status: 'error', error: msg }
            touched = true
          }
        }
        return touched ? next : prev
      })
      setMetaLab((p) => (p.status === 'running' ? { ...p, status: 'error', error: msg } : p))
      toast(`生成失败：${msg}`, 'error')
    },
    [toast],
  )

  /**
   * Stage 1 本身。取消时返回 null 并且不写状态 ——
   * 「被取消」和「失败」是两件完全不同的事，不能都弹一条红字。
   */
  const runDigestStage = useCallback(
    async (controller: AbortController): Promise<DigestState | null> => {
      if (!doc) return null
      const prev = aiSnapshot.current.digest
      setDigest({ ...emptyDigestState, status: 'running' })

      const out = await runDigest(doc, sections, tone, controller.signal, {
        onStream: (text) => setDigest((p) => ({ ...p, status: 'running', streaming: text })),
      })

      if (controller.signal.aborted) {
        if (isUserAbort(controller)) setDigest(prev)
        return null
      }

      setDigest(out.state)
      return out.state
    },
    [doc, sections, tone, isUserAbort],
  )

  /** Stage 1：逐节摘要（用户显式点「生成摘要 / 重新摘要」） */
  const generateDigest = useCallback(async () => {
    if (!doc || sections.length === 0) {
      toast('没有可切分的正文', 'error')
      return
    }
    const controller = startJob()
    try {
      const state = await runDigestStage(controller)
      if (!state) return
      if (state.error) {
        toast(state.error, state.fallback ? 'info' : 'error')
      } else {
        toast(`已生成 ${state.digest?.sections.length ?? 0} 节摘要`, 'success')
      }
    } catch (err) {
      failJob(err)
    }
  }, [doc, sections, tone, startJob, runDigestStage, failJob, toast])

  /** 有摘要就直接用，没有才跑 Stage 1。返回 null 表示被取消或失败（已提示过） */
  const ensureDigest = useCallback(
    async (controller: AbortController): Promise<DigestSet | null> => {
      if (digest.digest) return digest.digest
      const state = await runDigestStage(controller)
      // 取消不是失败，别在这里再补一条「摘要生成失败」
      if (controller.signal.aborted) return null
      if (!state?.digest) {
        toast(state?.error ?? '摘要生成失败', 'error')
        return null
      }
      return state.digest
    },
    [digest.digest, runDigestStage, toast],
  )

  const setOnePlatform = useCallback((id: RewriteId, state: AIState) => {
    setPlatformStates((prev) => ({ ...prev, [id]: state }))
  }, [])

  /** Stage 2：单个平台。取消时把上一版文案放回去，并返回 null */
  const runOnePlatform = useCallback(
    async (id: RewriteId, dg: DigestSet, controller: AbortController): Promise<AIState | null> => {
      if (!doc) return null
      const prev = aiSnapshot.current.platformStates[id]
      setOnePlatform(id, { ...emptyAIState, status: 'running' })

      const out = await runPlatform(id, doc, dg, tone, controller.signal, {
        onStream: (text) =>
          setPlatformStates((p) => ({ ...p, [id]: { ...p[id], status: 'running', streaming: text } })),
      })

      if (controller.signal.aborted) {
        // 「重新生成」跑到一半点停止，原来的那版不该跟着消失
        if (isUserAbort(controller)) setOnePlatform(id, prev)
        return null
      }

      setOnePlatform(id, out.state)
      return out.state
    },
    [doc, tone, setOnePlatform, isUserAbort],
  )

  /** 生成当前平台：缺摘要就先跑 Stage 1 */
  const generateCurrent = useCallback(async () => {
    if (!doc || !isRewriteId(platform)) return
    const controller = startJob()
    try {
      const dg = await ensureDigest(controller)
      if (!dg) return

      const state = await runOnePlatform(platform, dg, controller)
      if (!state) return
      if (state.error) toast(state.error, state.fallback ? 'info' : 'error')
      else if (state.fallback) toast('已用本地组装生成（未调用大模型）')
      else toast('生成好了', 'success')
    } catch (err) {
      failJob(err)
    }
  }, [doc, platform, startJob, ensureDigest, runOnePlatform, failJob, toast])

  /** 生成四个平台 */
  const generateAll = useCallback(async () => {
    if (!doc) return
    const controller = startJob()

    try {
      const dg = await ensureDigest(controller)
      if (!dg) return

      // 并发 2。四个平台串行是 4 × 30s ≈ 2 分钟，并发能砍掉一半；
      // 但不敢开满 —— 同一个 Key 同时打四个请求很容易撞限流。
      // 一旦有人撞上 429，剩下的立刻退回串行，别把「限流」打成「封禁」。
      const queue = [...rewriteIds]
      let cursor = 0
      let throttled = false

      const worker = async () => {
        for (;;) {
          if (controller.signal.aborted || throttled) return
          const i = cursor++
          if (i >= queue.length) return
          const st = await runOnePlatform(queue[i], dg, controller)
          if (st?.error && /429|限流/.test(st.error)) throttled = true
        }
      }

      await Promise.all([worker(), worker()])

      // 撞了限流：把没跑的串行收尾
      if (throttled && !controller.signal.aborted) {
        while (cursor < queue.length) {
          await runOnePlatform(queue[cursor++], dg, controller)
          if (controller.signal.aborted) return
        }
      }

      if (controller.signal.aborted) return
      toast('四个平台的文案都生成好了', 'success')
    } catch (err) {
      failJob(err)
    }
  }, [doc, startJob, ensureDigest, runOnePlatform, failJob, toast])

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

  /* ---------------- 标题与标签 ---------------- */

  const generateMetaLab = useCallback(async () => {
    if (!doc) return
    const controller = startJob()
    const prev = aiSnapshot.current.metaLab
    setMetaLab({ ...emptyMetaLabState, status: 'running' })

    try {
      const out = await runMetaLab(doc, digest.digest, sections, controller.signal, {
        onStream: (text) => setMetaLab((p) => ({ ...p, status: 'running', streaming: text })),
      })

      if (controller.signal.aborted) {
        if (isUserAbort(controller)) setMetaLab(prev)
        return
      }

      setMetaLab(out.state)
      if (out.state.error) toast(out.state.error, out.state.fallback ? 'info' : 'error')
      else toast(`已生成 ${out.state.result?.titles.length ?? 0} 个标题候选`, 'success')
    } catch (err) {
      failJob(err)
    }
  }, [doc, digest.digest, sections, startJob, isUserAbort, failJob, toast])

  const cancelMetaLab = useCallback(() => {
    abortRef.current?.abort()
    setMetaLab((prev) => (prev.status === 'running' ? { ...prev, status: 'idle', streaming: '' } : prev))
  }, [])

  const applyTitle = useCallback(
    (title: string) => {
      updateMeta({ title })
      // 卡片不跟着变是刻意的：CardStudio 只在重新导入时重建，
      // 否则每改一次元信息就把用户手工调过的卡片文字冲掉
      toast('已换标题 · 配图里点「重新生成」封面才会跟着变', 'success')
    },
    [updateMeta, toast],
  )

  const applyTags = useCallback(
    (tags: string[]) => {
      if (!doc) return
      const merged = [...doc.meta.tags]
      for (const t of tags) if (!merged.includes(t)) merged.push(t)
      updateMeta({ tags: merged })
      toast(`已写入标签，现有 ${merged.length} 个`, 'success')
    },
    [doc, updateMeta, toast],
  )

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

  /**
   * 写一段纯文本进剪贴板。
   *
   * 先走同步通道：execCommand 在用户手势里一次就落地，不 await、不受焦点影响。
   * 只有同步通道不可用时才退到异步的 clipboard API。
   */
  const writePlain = useCallback(async (text: string): Promise<boolean> => {
    if (copySync('plain', { text })) return true
    try {
      await copyPlain(text)
      return true
    } catch {
      return false
    }
  }, [])

  const copyPlainText = useCallback(
    async (text: string, label: string) => {
      if (!(await writePlain(text))) {
        toast(COPY_FAILED, 'error')
        return
      }
      // 改写平台复制成功也算发过了；第一次会顺带提示，避免用户以为只是复制
      let tail = ''
      if (articleKey && isRewriteId(platform)) {
        const persisted = applyLedger(markRecord(articleKey, platform))
        // 没写进去就别在成功提示里说「已记为已发」——上面已经报过错了
        if (persisted && !ledger[platform]) tail = ' · 已记为已发'
      }
      toast(`已复制${label}${tail}`, 'success')
    },
    [toast, articleKey, platform, ledger, applyLedger, writePlain],
  )

  /**
   * 只复制、不记台账。
   * 标题和标签是从「标题/标签」弹层里复制的，跟当前停在哪个平台无关 ——
   * 在小红书标签页里复制一个标题，不该被记成「小红书已发布」。
   */
  const copyTextOnly = useCallback(
    async (text: string, label: string) => {
      if (!(await writePlain(text))) {
        toast(COPY_FAILED, 'error')
        return
      }
      toast(`已复制${label}`, 'success')
    },
    [toast, writePlain],
  )

  /**
   * 复制成功后打开发布页。
   *
   * 必须在用户手势里同步开标签（见 core/publish.ts 的 preopenTab）：
   * 等复制这个 await 回来再 window.open 会被弹窗拦截。
   *
   * 连点两下复制时不再开第二个 —— 3 秒内同一个平台只开一次。
   */
  const openPublishFor = useCallback(
    (platformId: string): ReturnType<typeof preopenTab> => {
      if (!openOnCopy) return null
      const target = publishUrlOf(platformId)
      if (!target) return null
      const now = Date.now()
      if (now - lastOpenRef.current < 3000) return null
      lastOpenRef.current = now
      return preopenTab(target.url)
    },
    [openOnCopy],
  )

  /**
   * 复制当前平台的产物。
   *
   * 顺序是这段代码的全部要点：**先同步复制，再开标签**。
   * 反过来（先 preopenTab 再 await 复制）会让新标签把本页的焦点抢走，
   * 剪贴板 API 抛 NotAllowedError: Document is not focused，
   * execCommand 也返回 false —— 三个通道一起废掉，用户看到「复制失败」，
   * 而剪贴板里还留着上一次的内容，粘出来就是「复制不完全、丢了后面新加的部分」。
   */
  const doCopyPrimary = useCallback(() => {
    if (!output) return

    const payload = { html: output.html, text: output.text }
    const finish = (channel: 'rich' | 'plain') => {
      const persisted = articleKey ? applyLedger(markRecord(articleKey, platform)) : false
      const tail = persisted && !ledger[platform] ? ' · 已记为已发' : ''
      if (output.copyMode === 'rich') {
        toast(
          channel === 'rich'
            ? `已复制富文本，直接粘进编辑器即可${tail}`
            : `浏览器不支持富文本复制，已改为复制纯文本${tail}`,
          channel === 'rich' ? 'success' : 'info',
        )
      } else {
        toast(`已复制${tail}`, 'success')
      }
    }

    // 1) 同步通道：还在用户手势里、本页也还有焦点，一次写完
    const channel = copySync(output.copyMode, payload)
    if (channel) {
      // 2) 复制已经落地，这时候再开标签，焦点被抢走也无所谓了
      openPublishFor(platform)?.commit()
      finish(channel)
      return
    }

    // 3) 同步通道不可用（极老浏览器 / execCommand 被禁用）才走异步。
    //    这里同样不能先开标签，否则异步复制也会因为失焦而失败。
    //    代价是此时 window.open 已经不在用户激活窗口里了，可能被当成弹窗拦掉 ——
    //    拦了就只复制、不开页面，用户点旁边的「打开发布页」按钮一样能到。
    void (async () => {
      try {
        const mode = await copyByMode(output.copyMode, payload)
        finish(mode)
        openPublishFor(platform)?.commit()
      } catch {
        toast(COPY_FAILED, 'error')
      }
    })()
  }, [output, toast, articleKey, platform, ledger, applyLedger, openPublishFor])

  const doCopySource = useCallback(() => {
    if (!output) return
    const finish = () => {
      const persisted = articleKey ? applyLedger(markRecord(articleKey, platform)) : false
      const tail = persisted && !ledger[platform] ? ' · 已记为已发' : ''
      toast(`已复制源码${tail}`, 'success')
    }
    if (copySync('plain', { text: output.primary })) {
      finish()
      return
    }
    void (async () => {
      try {
        await copyPlain(output.primary)
        finish()
      } catch {
        toast(COPY_FAILED, 'error')
      }
    })()
  }, [output, toast, articleKey, platform, ledger, applyLedger])

  const doDownload = useCallback(() => {
    if (!output) return
    downloadText(output.primary, output.fileName ?? 'article.md', mimeFor(output.format))
  }, [output])

  /**
   * 把这篇文章在全部「转换」平台上的产物打成一个 zip。
   *
   * 逐个点「下载」会被浏览器拦（多个文件要授权一次），也麻烦。这里一次渲染
   * 7 个平台，文件名带序号，解压后按名称排序就是侧栏的顺序。
   *
   * 只导转换平台：AI 改写的 4 个平台没有确定性产物（要先调模型），
   * 配图是 PNG，走各自的导出入口。隐藏的平台不导 —— 隐藏本来就表示「我不发这家」。
   */
  const doExportAllPlatforms = useCallback(async () => {
    if (!doc) return
    const list = convertPlatforms.filter((p) => !hidden.has(p.id))
    if (list.length === 0) {
      toast('没有可导出的平台', 'error')
      return
    }
    setZipping(true)
    try {
      const { default: JSZip } = await import('jszip')
      const zip = new JSZip()
      const slug = safeFileName(doc.meta.slug || doc.meta.title || 'article')

      for (const [i, p] of list.entries()) {
        const out = p.render(doc, { wechatThemeId: themeId, tail, account })
        const ext = out.format === 'markdown' ? 'md' : 'html'
        // 平台名放在文件名里，解压后一眼知道哪个文件给哪家
        zip.file(`${String(i + 1).padStart(2, '0')}-${safeFileName(p.name)}-${slug}.${ext}`, out.primary)
      }

      const blob = await zip.generateAsync({ type: 'blob' })
      downloadBlob(blob, `${slug}-全平台.zip`)
      toast(`已导出 ${list.length} 个平台的产物`, 'success')
    } catch (e) {
      toast(`打包失败：${e instanceof Error ? e.message : String(e)}`, 'error')
    } finally {
      setZipping(false)
    }
  }, [doc, hidden, themeId, tail, account, toast])

  /** 手动打开发布页（不复制）。改写平台分段复制完再点这个 */
  const openPublishNow = useCallback(() => {
    const target = publishUrlOf(platform)
    if (!target) {
      toast('这个平台还没配发布页地址', 'info')
      return
    }
    window.open(target.url, '_blank', 'noopener,noreferrer')
  }, [platform, toast])

  const doSplitExport = useCallback(() => {
    if (!doc) return
    const parts = splitByH2(doc)
    const p = getConvertPlatform('wechat')
    if (!p) return
    parts.forEach((part, i) => {
      const out = p.render(part, { wechatThemeId: themeId, tail, account })
      setTimeout(() => {
        downloadText(
          out.primary,
          `${out.fileName?.replace(/\.html$/, '') ?? `part-${i + 1}`}.html`,
          'text/html',
        )
      }, i * 300)
    })
    toast(`已拆成 ${parts.length} 篇并开始下载`, 'success')
  }, [doc, themeId, tail, account, toast])

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

        {doc ? (
          <button
            className="btn btn-sm btn-quiet review-entry"
            onClick={() => setReviewOpen(true)}
            title="复盘：手填各平台的阅读 / 点赞 / 评论 / 收藏，看互动率与跨篇对比"
          >
            复盘
          </button>
        ) : null}

        <button
          className={`btn btn-sm btn-quiet drafts-entry ${drafts.length > 0 ? 'has' : ''}`}
          onClick={() => {
            setDrafts(listDrafts())
            setDraftsOpen(true)
          }}
          title="草稿箱：自动保存正文、摘要与 AI 文案，关掉页面也不会丢"
        >
          草稿{drafts.length > 0 ? ` ${drafts.length}` : ''}
        </button>

        <button className="btn btn-sm btn-quiet" onClick={() => setSettingsOpen(true)}>
          设置
        </button>
      </header>

      <div className="app-body">
        {/* ================= 侧栏 ================= */}
        <aside className="sidebar">
          <ImportPanel
            currentName={fileName}
            onLoad={load}
            onError={(m) => toast(m, 'error')}
            onNotice={(m) => toast(m, 'info')}
          />
          {doc ? <MetaEditor meta={doc.meta} onChange={updateMeta} /> : null}
          <PlatformNav
            active={platform}
            onSelect={setPlatform}
            platformStatus={navStatus}
            published={ledger}
            hidden={hidden}
            onOpenFilter={() => setFilterOpen(true)}
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
                {doc ? (
                  <button
                    className="head-chip meta-entry"
                    onClick={() => setMetaOpen(true)}
                    title="一次生成 8 个不同角度的标题，其中至少 3 条在 20 字内；另附标签建议"
                  >
                    {metaLab.result ? `标题 ${metaLab.result.titles.length}` : '标题 / 标签'}
                  </button>
                ) : null}
                {doc ? (
                  <button
                    className="head-chip cover-entry"
                    onClick={() => setCoverOpen(true)}
                    title="按文章内容从 Unsplash 搜 3 张封面图，挑一张下载"
                  >
                    封面
                  </button>
                ) : null}
                {platform === 'wechat' && doc ? (
                  <button
                    className="head-chip tail-entry"
                    onClick={() => setTailOpen(true)}
                    title="文末三块：关注引导 / 往期推荐 / 版权声明"
                  >
                    文末 {activeBlocks(tail)}/3
                  </button>
                ) : null}
                {doc && kind !== 'card' && checkContent.length > 0 ? (
                  <ComplianceChip hits={complianceHits} scopeLabel={scopeLabel} />
                ) : null}
                {doc && kind !== 'card' && images.length > 0 ? (
                  <button
                    className="head-chip img-entry"
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
                  <button
                    className="btn"
                    onClick={doExportAllPlatforms}
                    disabled={zipping}
                    title="把这篇文章在全部转换平台上的产物打成一个 zip（AI 改写的平台与配图不在这里）"
                  >
                    {zipping ? <span className="spinner" /> : null}
                    {zipping ? '打包中…' : '导出全平台'}
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

              {/* 发布页入口：只负责打开页面，登录与发布仍由人完成 */}
              {kind !== 'card' ? (
                <div className="publish-open">
                  <label
                    className="check-row publish-toggle"
                    title="复制成功后自动打开该平台的发布页。只打开页面，不自动登录、不自动发布。"
                  >
                    <input
                      type="checkbox"
                      checked={openOnCopy}
                      onChange={(e) => {
                        setOpenOnCopy(e.target.checked)
                        saveOpenOnCopy(e.target.checked)
                      }}
                    />
                    <span>复制后打开发布页</span>
                  </label>
                  <button
                    className="btn btn-sm btn-quiet publish-now"
                    onClick={openPublishNow}
                    title={publishTarget?.note ?? '在浏览器里打开该平台的发布页'}
                  >
                    打开发布页
                  </button>
                </div>
              ) : null}

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
        onSaved={(m, kind = 'success') => {
          setSettingsVersion((v) => v + 1)
          toast(m, kind)
        }}
      />

      {doc ? (
        <PublishLedger
          open={ledgerOpen}
          onClose={() => setLedgerOpen(false)}
          title={doc.meta.title}
          ledger={ledger}
          onMark={(id) => applyLedger(markRecord(articleKey, id))}
          onUnmark={(id) => applyLedger(unmark(articleKey, id))}
          onSetUrl={(id, url) => applyLedger(setLedgerUrl(articleKey, id, url))}
          onClear={() => {
            // 失败时 applyLedger 已经报过错，别再补一条「已清空」
            if (applyLedger(clearArticle(articleKey))) toast('已清空这篇的台账')
          }}
        />
      ) : null}

      <ImageList
        open={imagesOpen}
        onClose={() => setImagesOpen(false)}
        images={images}
        title={doc?.meta.title ?? '文章'}
        assets={assets}
        onUploaded={applyHostUrls}
        onAddAssets={addAssets}
        onOpenSettings={() => {
          setImagesOpen(false)
          setSettingsOpen(true)
        }}
        onToast={toast}
      />

      <CoverSheet
        open={coverOpen}
        onClose={() => setCoverOpen(false)}
        doc={doc}
        onToast={toast}
        onOpenSettings={() => {
          setCoverOpen(false)
          setSettingsOpen(true)
        }}
      />

      {doc ? (
        <MetaLab
          open={metaOpen}
          onClose={() => setMetaOpen(false)}
          state={metaLab}
          currentTitle={doc.meta.title}
          currentTags={doc.meta.tags}
          onRun={generateMetaLab}
          onCancel={cancelMetaLab}
          onApplyTitle={applyTitle}
          onApplyTags={applyTags}
          onCopy={copyTextOnly}
          providerReady={providerReady}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      ) : null}

      <TailSheet
        open={tailOpen}
        onClose={() => setTailOpen(false)}
        cfg={tail}
        account={account}
        themeId={themeId}
        onChange={changeTail}
        onAccountChange={changeAccount}
      />

      <DraftsSheet
        open={draftsOpen}
        onClose={() => setDraftsOpen(false)}
        drafts={drafts}
        currentKey={articleKey}
        onOpen={restoreDraft}
        onDelete={removeDraft}
        onClearAll={wipeDrafts}
      />

      <ReviewSheet
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        articleTitle={doc?.meta.title ?? ''}
        ledger={ledger}
        summaries={summaries}
        onSetStats={changeStats}
      />

      <PlatformFilterSheet
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        hidden={hidden}
        onToggle={togglePlatform}
        onReset={resetHidden}
      />

      <ToastLayer items={toasts} />
    </div>
  )
}
