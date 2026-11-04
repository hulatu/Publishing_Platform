/**
 * 草稿箱
 *
 * 解决一个具体的痛：花两次大模型调用把四个平台的文案都生成好了，
 * 手一滑关掉标签页 —— 全没了，得重新导入、重新花 token。
 *
 * 所以这里存的不是「正文」，而是**正文之外那些重新生成很贵的东西**：
 * 摘要、四平台文案、标题候选。正文（原始 markdown）也一起存，
 * 否则下次打开只剩一堆没有正文的 AI 文案，一样没用。
 *
 * 几个刻意的取舍：
 *
 * 1. **自动保存，没有保存按钮**。用户会忘。改一个字就落盘，延迟 800ms。
 * 2. **key 和发布台账共用 slug**。同一篇文章的草稿和「发到哪了」能对上，
 *    也避免出现「台账里有、草稿箱里没有」这种两份记录各说各话的局面。
 * 3. **流式文本不落盘**。`streaming` 在生成过程中每 100ms 涨一次，
 *    存它既没意义又会把 localStorage 撑爆，写入前统一清空。
 * 4. **容量满了淘汰最旧的**，而不是报错让用户自己去清。localStorage 只有 5MB，
 *    一篇带 AI 文案的草稿约 30–60KB，20 篇是安全线。
 */

import type { Doc, DocMeta } from './ir'
import { blocksToText } from './ir'
import { charCount } from './cjk'
import type { DigestState, MetaLabState, PlatformAIStates, RewriteTone } from '../ai/types'

const KEY = 'ad.drafts.v1'
/** 最多留几篇草稿。超了按最后编辑时间淘汰最旧的 */
export const MAX_DRAFTS = 20

export interface DraftSnapshot {
  /** 与发布台账同源的 key（slug 优先） */
  key: string
  title: string
  fileName: string
  /** 完整原文（含 front matter），恢复时重新解析 */
  source: string
  /** 正文指纹，用来判断草稿还配不配得上现在的正文 */
  fingerprint: string
  /** 用户在 MetaEditor 里改过的元信息 */
  meta: DocMeta
  tone: RewriteTone
  themeId: string
  platform: string
  digest: DigestState
  platformStates: PlatformAIStates
  metaLab: MetaLabState
  updatedAt: string
}

type Store = Record<string, DraftSnapshot>

/* ------------------------------------------------------------------ */
/* 指纹                                                                */
/* ------------------------------------------------------------------ */

/**
 * 正文指纹：小节数 + 正文字数。
 *
 * 不用哈希是因为目的不是「判断是否同一字节」——用户改个错别字、
 * 加一句解释，旧草稿里的 AI 文案其实还能用。只有**结构变了**
 * （增删小节、大段增删）才让旧文案彻底对不上。
 */
export function fingerprintOf(doc: Doc, sectionCount: number): string {
  return `${sectionCount}:${charCount(blocksToText(doc.blocks))}`
}

/* ------------------------------------------------------------------ */
/* 读写                                                                */
/* ------------------------------------------------------------------ */

function readStore(): Store {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed as Store
  } catch {
    // 隐私模式 / 手改坏了，都当成空草稿箱
    return {}
  }
}

/** 写入成功返回 true；容量不足时淘汰最旧的再试，全试完还不行就 false */
function writeStore(store: Store): boolean {
  for (let attempt = 0; attempt <= MAX_DRAFTS; attempt++) {
    try {
      localStorage.setItem(KEY, JSON.stringify(prune(store)))
      return true
    } catch {
      const keys = Object.keys(store)
      if (keys.length <= 1) return false
      // 淘汰最旧的一篇再试
      const oldest = keys.reduce((a, b) => (store[a].updatedAt <= store[b].updatedAt ? a : b))
      delete store[oldest]
    }
  }
  return false
}

function prune(store: Store): Store {
  const keys = Object.keys(store)
  if (keys.length <= MAX_DRAFTS) return store

  const sorted = keys.sort((a, b) => store[b].updatedAt.localeCompare(store[a].updatedAt))
  const kept: Store = {}
  for (const k of sorted.slice(0, MAX_DRAFTS)) kept[k] = store[k]
  return kept
}

export function listDrafts(): DraftSnapshot[] {
  return Object.values(readStore()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function readDraft(key: string): DraftSnapshot | null {
  return readStore()[key] ?? null
}

export function writeDraft(snap: DraftSnapshot): boolean {
  const store = readStore()
  store[snap.key] = snap
  return writeStore(store)
}

export function deleteDraft(key: string): DraftSnapshot[] {
  const store = readStore()
  delete store[key]
  writeStore(store)
  return listDrafts()
}

export function clearDrafts(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // 清不掉也不影响本次使用
  }
}

/* ------------------------------------------------------------------ */
/* 组装                                                                */
/* ------------------------------------------------------------------ */

/**
 * 判断一份草稿值不值得留。
 *
 * 只有元信息改动的草稿没有存在意义 —— 那点东西重导一次就有。
 * 真正值得留的是「重新生成很贵」的部分：摘要、平台文案、标题候选。
 */
export function draftValue(snap: DraftSnapshot): { worth: boolean; marks: string[] } {
  const marks: string[] = []

  // 只有 oneLiner、没有小节摘要的，等于摘要没跑成 —— 不标，也不计入「值钱」
  const digestSections = snap.digest.digest?.sections.length ?? 0
  if (digestSections > 0) marks.push(`摘要 ${digestSections} 节`)

  const platforms = Object.values(snap.platformStates).filter((s) => s.result)
  if (platforms.length > 0) marks.push(`文案 ${platforms.length} 个平台`)

  if (snap.metaLab.result) marks.push(`标题 ${snap.metaLab.result.titles.length} 条`)

  return { worth: marks.length > 0, marks }
}

/** 存盘前统一清理：流式文本、运行中状态都不该进 localStorage */
export function sanitizeForStore(args: {
  key: string
  doc: Doc
  source: string
  fileName: string
  tone: RewriteTone
  themeId: string
  platform: string
  digest: DigestState
  platformStates: PlatformAIStates
  metaLab: MetaLabState
  sectionCount: number
}): DraftSnapshot {
  const { digest, platformStates, metaLab } = args

  const cleanDigest: DigestState = {
    ...digest,
    // 还在跑的活儿不落盘：streaming 是几万字的中间产物，status 下次也接不上
    status: digest.status === 'running' ? (digest.digest ? 'done' : 'idle') : digest.status,
    streaming: '',
  }

  const cleanStates = { ...platformStates }
  for (const id of Object.keys(cleanStates) as (keyof typeof cleanStates)[]) {
    const s = cleanStates[id]
    cleanStates[id] = {
      ...s,
      status: s.status === 'running' ? (s.result ? 'done' : 'idle') : s.status,
      streaming: '',
    }
  }

  return {
    key: args.key,
    title: args.doc.meta.title,
    fileName: args.fileName,
    source: args.source,
    fingerprint: fingerprintOf(args.doc, args.sectionCount),
    meta: args.doc.meta,
    tone: args.tone,
    themeId: args.themeId,
    platform: args.platform,
    digest: cleanDigest,
    platformStates: cleanStates,
    metaLab: { ...metaLab, status: metaLab.status === 'running' ? (metaLab.result ? 'done' : 'idle') : metaLab.status, streaming: '' },
    updatedAt: new Date().toISOString(),
  }
}

/* ------------------------------------------------------------------ */
/* 展示                                                                */
/* ------------------------------------------------------------------ */

/** 刚刚 / 12 分钟前 / 3 小时前 / 昨天 14:03 / 10-28 */
export function formatAgo(iso: string): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const diff = Date.now() - t
  const min = Math.floor(diff / 60_000)

  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`

  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour} 小时前`

  const d = new Date(t)
  const pad = (n: number) => String(n).padStart(2, '0')
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`

  const dayDiff = Math.floor(hour / 24)
  if (dayDiff === 1) return `昨天 ${hm}`
  if (dayDiff < 7) return `${dayDiff} 天前`
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
