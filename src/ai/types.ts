/** AI 改写的任务与数据结构 */

export type RewriteId = 'xiaohongshu' | 'twitter' | 'jike' | 'weibo'

export const rewriteIds: RewriteId[] = ['xiaohongshu', 'twitter', 'jike', 'weibo']

/* ------------------------------------------------------------------ */
/* 第一段：章节摘要                                                     */
/* ------------------------------------------------------------------ */

export interface SectionDigest {
  /** 对应 ArticleSection.index */
  index: number
  /** 小节标题原文 */
  heading: string
  /** 1–2 句内容总结，40–90 字 */
  summary: string
}

export interface DigestSet {
  sections: SectionDigest[]
  /** 全篇一句话，用于微博正文与各平台开场钩子 */
  oneLiner: string
}

export type JobStatus = 'idle' | 'running' | 'done' | 'error'

export interface DigestState {
  status: JobStatus
  /** 流式原始文本，仅用于「正在生成」的反馈 */
  streaming: string
  digest: DigestSet | null
  error: string | null
  /** 是否走了本地启发式（未调用大模型） */
  fallback: boolean
  retries: number
  /** 走的是哪个 provider，展示用 */
  providerLabel: string
}

export const emptyDigestState: DigestState = {
  status: 'idle',
  streaming: '',
  digest: null,
  error: null,
  fallback: false,
  retries: 0,
  providerLabel: '',
}

/* ------------------------------------------------------------------ */
/* 第二段：平台组装                                                     */
/* ------------------------------------------------------------------ */

export interface XhsData {
  title: string
  body: string
  tags: string[]
}

export interface TwitterData {
  /** 每条推文正文，不含 1/n 编号（编号在渲染时拼，不占字符预算） */
  thread: string[]
}

export interface JikeData {
  body: string
}

export interface WeiboData {
  text: string
  /** 话题名，不带 # 号 */
  topics: string[]
}

export interface AIResultSet {
  xhs?: XhsData
  twitter?: TwitterData
  jike?: JikeData
  weibo?: WeiboData
}

export interface AIState {
  status: JobStatus
  streaming: string
  result: AIResultSet | null
  error: string | null
  fallback: boolean
  retries: number
  providerLabel: string
}

export const emptyAIState: AIState = {
  status: 'idle',
  streaming: '',
  result: null,
  error: null,
  fallback: false,
  retries: 0,
  providerLabel: '',
}

/** 按平台 id 存各自的生成状态，切换 tab 不丢结果 */
export type PlatformAIStates = Record<RewriteId, AIState>

export function emptyPlatformStates(): PlatformAIStates {
  return {
    xiaohongshu: { ...emptyAIState },
    twitter: { ...emptyAIState },
    jike: { ...emptyAIState },
    weibo: { ...emptyAIState },
  }
}

/* ------------------------------------------------------------------ */
/* 标题与标签                                                           */
/* ------------------------------------------------------------------ */

/** 标题的角度。不是分类学，是给用户看「这 8 个为什么不一样」 */
export type TitleStyle = 'statement' | 'number' | 'question' | 'contrast' | 'howto' | 'judgement'

export const titleStyleLabels: Record<TitleStyle, string> = {
  statement: '陈述',
  number: '数字',
  question: '疑问',
  contrast: '对比',
  howto: '做法',
  judgement: '判断',
}

export interface TitleCandidate {
  text: string
  style: TitleStyle
  /** 选填：一句话说明这条的角度，AI 有时会给 */
  note?: string
}

export interface TagSuggestion {
  name: string
  /** 选填：为什么推这个标签 */
  why?: string
}

export interface MetaLabSet {
  titles: TitleCandidate[]
  tags: TagSuggestion[]
}

export interface MetaLabState {
  status: JobStatus
  streaming: string
  result: MetaLabSet | null
  error: string | null
  fallback: boolean
  retries: number
  providerLabel: string
}

export const emptyMetaLabState: MetaLabState = {
  status: 'idle',
  streaming: '',
  result: null,
  error: null,
  fallback: false,
  retries: 0,
  providerLabel: '',
}

/* ------------------------------------------------------------------ */
/* 平台限制（UI 与校验共用）                                            */
/* ------------------------------------------------------------------ */

export const LIMITS = {
  xhsTitle: 20,
  xhsBody: 1000,
  xhsTags: 10,
  twitterWeighted: 280,
  twitterBudget: 275,
  jikeBody: 500,
  weiboText: 140,
  weiboTopics: 3,
  /** 单节摘要的字数区间 */
  digestMin: 18,
  digestMax: 130,
  oneLinerMax: 60,
  /** 标题候选：一次给 8 个，其中至少 3 个要能塞进小红书 20 字标题 */
  titleCount: 8,
  titleMax: 40,
  titleShort: 20,
  titleMinShort: 3,
  /** 标签建议条数 */
  tagCount: 14,
  tagMin: 8,
  tagMaxChars: 10,
} as const

/** 改写强度：影响各平台 prompt 的「像不像平台原生」程度 */
export type RewriteTone = 'original' | 'light' | 'native'

export const toneLabels: Record<RewriteTone, string> = {
  original: '保持原声',
  light: '轻度改造',
  native: '平台原生',
}

export const toneHints: Record<RewriteTone, string> = {
  original: '沿用博客原句与语气，只做结构重组与压缩，不改写措辞',
  light: '保留第一人称与克制语气，可以调整语序、合并句子、换成更口语的说法',
  native: '按平台原生生态重写：短句、情绪化开场、更强的互动引导，但仍不得编造事实',
}
