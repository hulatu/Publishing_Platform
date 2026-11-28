/**
 * 草稿自动保存
 *
 * 从 App.tsx 里搬出来的。这段代码的每一行都在回答「什么时候**不**写盘」：
 * 没有正文不写、AI 正在流式输出不写、内容一个字没变不写。写盘本身挪到
 * requestIdleCallback 里，因为一篇带 AI 文案的草稿序列化出来 30–60KB。
 *
 * 失败必须说出来。草稿箱的全部价值就是「关掉页面也不会丢」，
 * localStorage 满了却假装保存成功，等于骗用户 —— 而且要只提醒一次，
 * 否则每 800ms 一条红字，比不提醒还烦。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Doc } from '../core/ir'
import {
  listDrafts,
  sameDraft,
  sanitizeForStore,
  takeEvicted,
  writeDraft,
  type DraftSnapshot,
} from '../core/drafts'
import { whenIdle } from '../core/async'
import type { DigestState, MetaLabState, PlatformAIStates, RewriteTone } from '../ai/types'

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'conflict'

type Notify = (text: string, kind?: 'info' | 'success' | 'error') => void

interface Options {
  doc: Doc | null
  /** 台账与草稿共用同一个 key（slug 优先），空串表示还没导入 */
  articleKey: string
  /** 完整原文（含 front matter），草稿要连正文一起存才恢复得回来 */
  sourceText: string
  fileName: string
  tone: RewriteTone
  themeId: string
  platform: string
  digest: DigestState
  platformStates: PlatformAIStates
  metaLab: MetaLabState
  /** 小节数进指纹：结构变了就不该套用旧文案 */
  sectionCount: number
  /** 存完后刷新草稿列表，侧栏和草稿箱要立刻看到新时间 */
  onDrafts: (list: DraftSnapshot[]) => void
  toast: Notify
}

export interface DraftAutosave {
  saveStatus: SaveStatus
  savedAt: number | null
  /**
   * 告诉它「这份快照已经是落盘过的那份」。
   *
   * 打开草稿时用：紧接着触发的那次自动保存会判定内容没变而跳过，
   * 不然「最后修改时间」会被改成「最后看了一眼的时间」。
   */
  adoptSnapshot: (snap: DraftSnapshot) => void
  /**
   * 立刻把当前内容同步落盘（不等 800ms 防抖）。
   *
   * 回到首页前用：清空工作区前必须确认最后一笔修改已经在草稿箱里。
   * 返回 false 表示写盘失败（存储满 / 被禁用），调用方应留在原地。
   * 生成中（流式输出不落盘）或本来就没有正文时返回 true —— 那是设计如此，不是失败。
   */
  flush: () => boolean
}

export function useDraftAutosave(opts: Options): DraftAutosave {
  const {
    doc, articleKey, sourceText, fileName, tone, themeId, platform,
    digest, platformStates, metaLab, sectionCount, onDrafts, toast,
  } = opts

  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const saveTimer = useRef<number | null>(null)
  /** 草稿存盘失败只提醒一次，别每 800ms 弹一条 */
  const saveFailedRef = useRef(false)
  /** 上次真正落盘的那份快照，用来跳过「内容没变」的重复写入 */
  const lastSnapRef = useRef<DraftSnapshot | null>(null)
  /** 快照序号：pagehide 的同步写盘要让旧的 idle 回调失效，避免旧快照覆盖新快照 */
  const snapSeq = useRef(0)
  /** 多标签页冲突：另一标签页改过这篇草稿后暂停自动保存，避免互相覆盖 */
  const conflictRef = useRef(false)
  /** 关闭页面时也要能拿到最新参数；effect 的闭包不一定是最新的 */
  const optsRef = useRef(opts)
  optsRef.current = opts

  const buildSnapshot = useCallback((): DraftSnapshot | null => {
    const o = optsRef.current
    if (conflictRef.current) return null
    if (!o.doc || !o.articleKey || !o.sourceText) return null
    const busy =
      o.digest.status === 'running' ||
      o.metaLab.status === 'running' ||
      Object.values(o.platformStates).some((s) => s.status === 'running')
    if (busy) return null
    const snap = sanitizeForStore({
      key: o.articleKey,
      doc: o.doc,
      source: o.sourceText,
      fileName: o.fileName,
      tone: o.tone,
      themeId: o.themeId,
      platform: o.platform,
      digest: o.digest,
      platformStates: o.platformStates,
      metaLab: o.metaLab,
      sectionCount: o.sectionCount,
    })
    snapSeq.current += 1
    return snap
  }, [])

  const adoptSnapshot = useCallback((snap: DraftSnapshot) => {
    lastSnapRef.current = snap
  }, [])

  const flush = useCallback((): boolean => {
    const snap = buildSnapshot()
    if (!snap) return true
    if (sameDraft(lastSnapRef.current, snap)) return true
    const ok = writeDraft(snap)
    if (!ok) {
      setSaveStatus('error')
      if (!saveFailedRef.current) {
        saveFailedRef.current = true
        optsRef.current.toast('草稿没存上：浏览器本地存储已满或被禁用。先删几篇旧草稿再试', 'error')
      }
      return false
    }
    saveFailedRef.current = false
    lastSnapRef.current = snap
    setSavedAt(Date.now())
    setSaveStatus('saved')
    optsRef.current.onDrafts(listDrafts())
    return true
  }, [buildSnapshot])

  /**
   * 关页 / 切到后台时立刻补一次盘。
   *
   * 正常路径是 800ms 防抖 + whenIdle，用户改完最后一个字马上关标签页时，
   * idle 回调可能根本没机会跑 —— 最后一段就丢了。这里同步写一次
   * localStorage（几十 KB 的写入，页面已经在走，可以接受）。
   */
  useEffect(() => {
    const flush = () => {
      const snap = buildSnapshot()
      if (!snap || sameDraft(lastSnapRef.current, snap)) return
      if (writeDraft(snap)) {
        lastSnapRef.current = snap
        // 从 bfcache 回来时侧栏时间也应该是新的
        optsRef.current.onDrafts(listDrafts())
      }
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [buildSnapshot])

  // 切到另一篇时解除冲突；上一篇文章的冲突不该拦住这一篇的自动保存。
  useEffect(() => {
    conflictRef.current = false
    setSaveStatus('idle')
  }, [articleKey])

  /**
   * 多标签页冲突：storage 事件只在「别的标签页」写 localStorage 时触发，
   * 本页自己的写入不会回调。另一页保存了同一篇且内容不同，就暂停本页自动保存，
   * 避免两边每 800ms 互相覆盖。
   */
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== 'ad.drafts.v1') return
      if (event.storageArea && event.storageArea !== localStorage) return
      const key = optsRef.current.articleKey
      if (!key) return

      let incoming: DraftSnapshot | undefined
      try {
        const store = JSON.parse(event.newValue ?? '{}') as Record<string, DraftSnapshot>
        incoming = store[key]
      } catch {
        return
      }

      if (!incoming) {
        if (!lastSnapRef.current) return
        conflictRef.current = true
        setSaveStatus('conflict')
        optsRef.current.toast(
          '另一个标签页删除了这篇草稿。请刷新页面后再继续，避免覆盖。',
          'error',
        )
        return
      }

      if (sameDraft(lastSnapRef.current, incoming)) return
      conflictRef.current = true
      setSaveStatus('conflict')
      optsRef.current.toast(
        '另一个标签页修改了这篇草稿。请刷新页面后再继续，避免覆盖。',
        'error',
      )
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  useEffect(() => {
    if (conflictRef.current) return
    if (!doc || !articleKey || !sourceText) {
      setSaveStatus('idle')
      return
    }
    const busy =
      digest.status === 'running' ||
      metaLab.status === 'running' ||
      Object.values(platformStates).some((s) => s.status === 'running')
    if (busy) return

    setSaveStatus('saving')
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      const snap = buildSnapshot()
      if (!snap) return
      const seq = snapSeq.current
      // 写盘挪到空闲时段：一篇文章带正文 30–60KB，同步写会卡主线程十几毫秒，
      // 而 800ms 的防抖窗口正好是用户还在打字的时候
      whenIdle(() => {
        // 排队期间 pagehide 已经写过更新的快照，旧快照不要再覆盖它
        if (seq !== snapSeq.current) return
        // 内容一个字没变（只是打开草稿 / 切了标签）就别写，
        // 否则「最后修改时间」会变成「最后看了一眼的时间」
        if (sameDraft(lastSnapRef.current, snap)) {
          setSaveStatus('saved')
          return
        }
        const ok = writeDraft(snap)
        onDrafts(listDrafts())
        if (!ok) {
          setSaveStatus('error')
          if (!saveFailedRef.current) {
            saveFailedRef.current = true
            toast('草稿没存上：浏览器本地存储已满或被禁用。先删几篇旧草稿再试', 'error')
          }
        } else {
          saveFailedRef.current = false
          lastSnapRef.current = snap
          setSavedAt(Date.now())
          setSaveStatus('saved')
          // 淘汰是静默的，得说出来 —— 被清掉的那篇可能有刚生成的文案
          const evicted = takeEvicted()
          if (evicted.length > 0) {
            const names = evicted.map((d) => `「${d.title || d.fileName || '未命名'}」`).join('、')
            toast(`草稿箱满了，已清理${names}`, 'info')
          }
        }
      })
    }, 800)

    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
    }
  }, [
    doc, articleKey, sourceText, fileName, tone, themeId, platform,
    digest, platformStates, metaLab, sectionCount, onDrafts, toast, buildSnapshot,
  ])

  return { saveStatus, savedAt, adoptSnapshot, flush }
}
