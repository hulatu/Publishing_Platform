/**
 * AI 编排
 *
 * 从 App.tsx 里整段搬出来的：三段流水线的状态、并发控制、取消语义、异常兜底。
 * 搬出来不是为了「文件短一点」，而是因为这一段是**唯一没有测试覆盖的付费逻辑** ——
 * 每次点「生成」都要花 token，而「取消后不该抹掉上一版」「限流后该退回串行」
 * 这些都只靠人读代码保证。抽成 hook 之后，传进去假的 pipeline 就能测。
 *
 * 几个仍然留在代码里的判断，都是踩过坑的：
 * - 取消 ≠ 失败：流水线取消时返回空状态，直接 setState 会把用户已经花钱生成的
 *   摘要 / 文案抹掉，所以取消要还原上一版快照。
 * - 被新任务顶掉不算「用户取消」：abortRef 已经不指向自己时不能还原，
 *   否则旧任务收尾会盖掉新任务刚写进去的「生成中」。
 * - 并发 2，撞 429 立刻退回串行：同一个 Key 打四个请求容易限流，
 *   但把「限流」打成「封禁」的代价大得多。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Doc } from '../core/ir'
import type { ArticleSection } from '../core/sections'
import { runDigest, runPlatform } from '../ai/pipeline'
import { runMetaLab } from '../ai/meta-lab'
import {
  emptyAIState,
  emptyDigestState,
  emptyMetaLabState,
  emptyPlatformStates,
  isRewriteId,
  rewriteIds,
  type AIState,
  type DigestSet,
  type DigestState,
  type MetaLabState,
  type PlatformAIStates,
  type RewriteId,
  type RewriteTone,
} from '../ai/types'

type Notify = (text: string, kind?: 'info' | 'success' | 'error') => void

interface Options {
  doc: Doc | null
  sections: ArticleSection[]
  /** 当前停在哪个平台。generateCurrent 只生成这一个 */
  platform: string
  toast: Notify
}

/** 一次「接着上次继续」时整包恢复的东西 */
export interface AIAdopted {
  digest: DigestState
  platformStates: PlatformAIStates
  metaLab: MetaLabState
  tone: RewriteTone
}

export interface AIJobs {
  tone: RewriteTone
  digest: DigestState
  platformStates: PlatformAIStates
  metaLab: MetaLabState
  setTone: (tone: RewriteTone) => void

  /** 导入 / 打开草稿时整包接手（四件套总是一起换，分开设容易漏一个） */
  adopt: (next: AIAdopted) => void
  /** 换了一篇正文结构对不上的文章：清空 AI 产物，不动 tone */
  reset: () => void

  generateDigest: () => Promise<void>
  generateCurrent: () => Promise<void>
  generateAll: () => Promise<void>
  cancelGenerate: () => void
  generateMetaLab: () => Promise<void>
  cancelMetaLab: () => void

  /** 摘要里的两条手动修改。改完要重新落盘，所以走 state 而不是就地改对象 */
  editSummary: (index: number, summary: string) => void
  editOneLiner: (oneLiner: string) => void
}

export function useAIJobs({ doc, sections, platform, toast }: Options): AIJobs {
  const [tone, setTone] = useState<RewriteTone>('original')
  const [digest, setDigest] = useState<DigestState>(emptyDigestState)
  const [platformStates, setPlatformStates] = useState<PlatformAIStates>(emptyPlatformStates())
  const [metaLab, setMetaLab] = useState<MetaLabState>(emptyMetaLabState)

  const abortRef = useRef<AbortController | null>(null)

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
      }
    } catch (err) {
      failJob(err)
    }
  }, [doc, sections.length, startJob, runDigestStage, failJob, toast])

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
    } catch (err) {
      failJob(err)
    }
  }, [doc, startJob, ensureDigest, runOnePlatform, failJob])

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
  }, [])

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
    } catch (err) {
      failJob(err)
    }
  }, [doc, digest.digest, sections, startJob, isUserAbort, failJob, toast])

  const cancelMetaLab = useCallback(() => {
    abortRef.current?.abort()
    setMetaLab((prev) => (prev.status === 'running' ? { ...prev, status: 'idle', streaming: '' } : prev))
  }, [])

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

  const adopt = useCallback((next: AIAdopted) => {
    setDigest(next.digest)
    setPlatformStates(next.platformStates)
    setMetaLab(next.metaLab)
    setTone(next.tone)
  }, [])

  const reset = useCallback(() => {
    setDigest(emptyDigestState)
    setPlatformStates(emptyPlatformStates())
    setMetaLab(emptyMetaLabState)
  }, [])

  // 关掉页面 / 卸载时把在跑的请求掐掉，别让它在后台继续烧 token
  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  return {
    tone,
    digest,
    platformStates,
    metaLab,
    setTone,
    adopt,
    reset,
    generateDigest,
    generateCurrent,
    generateAll,
    cancelGenerate,
    generateMetaLab,
    cancelMetaLab,
    editSummary,
    editOneLiner,
  }
}
