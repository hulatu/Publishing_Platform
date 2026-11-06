/**
 * 两段式改写流水线
 *
 *   Stage 1  runDigest   全文 → 逐节 1–2 句摘要（中间产物，用户可改）
 *   Stage 2  runPlatform 摘要 → 某个平台的成品文案
 *
 * 每一段都走同一套「调用 → 解析 → 校验 → 带错误重试 → 硬裁兜底」。
 * 拆成两段的好处不只是质量：单次输出短了，超长文章不再被截断；
 * 换平台时只需要重跑 Stage 2，摘要可以复用。
 */

import type { Doc } from '../core/ir'
import type { ArticleSection } from '../core/sections'
import {
  buildDigestPrompt,
  buildPlatformPrompt,
  buildRetryPrompt,
  type PromptBuildResult,
} from './prompts'
import { parseAIJson, parseDigestJson, repairDigest, repairSet, validateDigest, validatePlatform } from './schemas'
import { completeWithRetry, describeAIError, resolveProvider, type AIProvider } from './provider'
import { buildAllFromDigest, buildPlatformFromDigest, fillMissingDigest, localDigest } from './fallback'
import {
  emptyAIState,
  emptyDigestState,
  type AIResultSet,
  type AIState,
  type DigestSet,
  type DigestState,
  type RewriteId,
  type RewriteTone,
} from './types'

const MAX_ATTEMPTS = 3

export interface PipelineCallbacks {
  onStream?: (accumulated: string) => void
  onAttempt?: (attempt: number) => void
}

export interface JsonRunOptions<T> {
  provider: AIProvider
  base: PromptBuildResult
  parse: (raw: string) => { data: T | null; error: string | null }
  validate: (data: T) => string[]
  repair: (data: T) => { data: T; notes: string[] }
  signal?: AbortSignal
  cb?: PipelineCallbacks
}

export interface JsonRunResult<T> {
  data: T | null
  /** 最终仍然存在的错误（null 表示完全成功） */
  error: string | null
  retries: number
  notes: string[]
  aborted: boolean
  /** 致命错误（鉴权/网络），重试无意义 */
  fatal: boolean
}

/** 通用的「带校验重试的 JSON 调用」。标题/标签这一路也复用它。 */
export async function runJson<T>(opts: JsonRunOptions<T>): Promise<JsonRunResult<T>> {
  const { provider, base, parse, validate, repair, signal, cb } = opts
  const notes: string[] = []
  let user = base.user
  let lastRaw = ''
  let lastError = ''
  let attempt = 0

  while (attempt < MAX_ATTEMPTS) {
    attempt++
    cb?.onAttempt?.(attempt)

    let text = ''
    let truncated = false

    try {
      const result = await completeWithRetry(
        provider,
        {
          system: base.system,
          user,
          signal,
          onDelta: (delta) => {
            text += delta
            cb?.onStream?.(text)
          },
        },
        () => {
          // 重试是拿原始 prompt 从头来，界面上的半截文案必须清掉，
          // 否则用户会看到「上次的残文 + 这次的正文」拼在一起
          text = ''
          cb?.onStream?.('')
        },
      )
      text = result.text || text
      truncated = result.truncated
    } catch (err) {
      if (signal?.aborted) {
        return { data: null, error: null, retries: attempt - 1, notes, aborted: true, fatal: false }
      }
      const msg = describeAIError(err)
      return { data: null, error: msg, retries: attempt - 1, notes: [...notes, msg], aborted: false, fatal: true }
    }

    lastRaw = text

    if (truncated) {
      lastError = '上一次输出因长度上限被截断，JSON 不完整。请压缩每条内容后重新输出完整 JSON。'
      user = buildRetryPrompt(base.user, text, [lastError])
      continue
    }

    const parsed = parse(text)
    if (!parsed.data) {
      lastError = parsed.error ?? 'JSON 解析失败'
      user = buildRetryPrompt(base.user, text, [lastError])
      continue
    }

    const errors = validate(parsed.data)
    if (errors.length > 0) {
      lastError = errors.join('；')
      user = buildRetryPrompt(base.user, text, errors)
      continue
    }

    return { data: parsed.data, error: null, retries: attempt - 1, notes, aborted: false, fatal: false }
  }

  // 重试耗尽：尽量用最后一次能解析出的数据硬裁
  const parsed = parse(lastRaw)
  if (parsed.data) {
    const repaired = repair(parsed.data)
    return {
      data: repaired.data,
      error: `模型连续 ${MAX_ATTEMPTS} 次输出未通过校验：${lastError}`,
      retries: MAX_ATTEMPTS - 1,
      notes: [...notes, ...repaired.notes],
      aborted: false,
      fatal: false,
    }
  }

  return {
    data: null,
    error: `模型连续 ${MAX_ATTEMPTS} 次输出都无法解析：${lastError}`,
    retries: MAX_ATTEMPTS - 1,
    notes,
    aborted: false,
    fatal: false,
  }
}

/* ------------------------------------------------------------------ */
/* Stage 1：章节摘要                                                    */
/* ------------------------------------------------------------------ */

export interface DigestOutcome {
  state: DigestState
  notes: string[]
}

export async function runDigest(
  doc: Doc,
  sections: ArticleSection[],
  tone: RewriteTone,
  signal?: AbortSignal,
  cb?: PipelineCallbacks,
): Promise<DigestOutcome> {
  const { provider, reason } = resolveProvider()
  const notes: string[] = []

  if (sections.length === 0) {
    return {
      state: { ...emptyDigestState, status: 'error', error: '这篇文章没有可切分的正文，无法做逐节摘要。' },
      notes: [],
    }
  }

  // 没有 provider → 本地抽取摘要（结构与 AI 版本一致）
  if (!provider || !provider.available()) {
    return {
      state: {
        ...emptyDigestState,
        status: 'done',
        digest: localDigest(sections),
        fallback: true,
        error: reason,
        providerLabel: '本地抽取',
      },
      notes: [reason],
    }
  }

  const base = buildDigestPrompt(doc, sections, tone)
  if (base.compressed) notes.push('原文较长，超出部分的小节只截取了前段送入模型')

  const run = await runJson<DigestSet>({
    provider,
    base,
    parse: (raw) => parseDigestJson(raw, sections),
    validate: (d) => validateDigest(d, sections),
    repair: (d) => repairDigest(d),
    signal,
    cb,
  })

  if (run.aborted) {
    return { state: { ...emptyDigestState }, notes }
  }

  // 拿不到任何摘要 → 用本地摘要顶上，不让流程断掉
  if (!run.data) {
    return {
      state: {
        ...emptyDigestState,
        status: 'done',
        digest: localDigest(sections),
        fallback: true,
        error: run.error,
        retries: run.retries,
        providerLabel: provider.label,
      },
      notes: [...notes, ...run.notes],
    }
  }

  // 漏节补齐：模型少给了几节，用本地摘要填，保证节数与原文一致
  const { data: filled, filled: filledIdx } = fillMissingDigest(run.data, sections)
  if (filledIdx.length) notes.push(`第 ${filledIdx.join('、')} 节模型没给摘要，已用本地抽取补齐`)

  return {
    state: {
      ...emptyDigestState,
      status: 'done',
      digest: filled,
      fallback: false,
      error: run.error,
      retries: run.retries,
      providerLabel: provider.label,
    },
    notes: [...notes, ...run.notes],
  }
}

/* ------------------------------------------------------------------ */
/* Stage 2：平台组装                                                    */
/* ------------------------------------------------------------------ */

export interface PlatformOutcome {
  state: AIState
  notes: string[]
}

export async function runPlatform(
  platform: RewriteId,
  doc: Doc,
  digest: DigestSet,
  tone: RewriteTone,
  signal?: AbortSignal,
  cb?: PipelineCallbacks,
): Promise<PlatformOutcome> {
  const { provider, reason } = resolveProvider()
  const notes: string[] = []

  const localState = (error: string | null, fallback: boolean, retries = 0, providerLabel = '本地组装'): AIState => ({
    ...emptyAIState,
    status: 'done',
    result: buildPlatformFromDigest(platform, digest, doc),
    error,
    fallback,
    retries,
    providerLabel,
  })

  if (!provider || !provider.available()) {
    return { state: localState(reason, true), notes: [reason] }
  }

  const base = buildPlatformPrompt(platform, doc, digest, tone)

  const run = await runJson<AIResultSet>({
    provider,
    base,
    parse: (raw) => {
      const r = parseAIJson(raw)
      return { data: r.data, error: r.error }
    },
    validate: (d) => validatePlatform(d, platform),
    repair: (d) => repairSet(d),
    signal,
    cb,
  })

  if (run.aborted) return { state: { ...emptyAIState }, notes }

  if (!run.data) {
    return { state: localState(run.error, true, run.retries, provider.label), notes: [...notes, ...run.notes] }
  }

  return {
    state: {
      ...emptyAIState,
      status: 'done',
      result: run.data,
      error: run.error,
      fallback: false,
      retries: run.retries,
      providerLabel: provider.label,
    },
    notes: [...notes, ...run.notes],
  }
}

/* ------------------------------------------------------------------ */
/* 兼容：一次跑完四平台（旧入口）                                        */
/* ------------------------------------------------------------------ */

export async function runAllPlatforms(
  doc: Doc,
  sections: ArticleSection[],
  tone: RewriteTone,
  signal?: AbortSignal,
  cb?: PipelineCallbacks,
): Promise<{ digest: DigestState; states: Record<RewriteId, AIState>; notes: string[] }> {
  const notes: string[] = []
  const digestOutcome = await runDigest(doc, sections, tone, signal, cb)
  notes.push(...digestOutcome.notes)

  const digest = digestOutcome.state.digest ?? localDigest(sections)
  const states = {} as Record<RewriteId, AIState>

  const ids: RewriteId[] = ['xiaohongshu', 'twitter', 'jike', 'weibo']
  for (const id of ids) {
    if (signal?.aborted) break
    const outcome = await runPlatform(id, doc, digest, tone, signal, cb)
    states[id] = outcome.state
    notes.push(...outcome.notes)
  }

  return { digest: digestOutcome.state, states, notes }
}

/** 没有摘要时的整篇兜底（导出用） */
export function fallbackAll(doc: Doc, sections: ArticleSection[]): AIResultSet {
  return buildAllFromDigest(localDigest(sections), doc)
}
