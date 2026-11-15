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

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

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

  const adoptSnapshot = useCallback((snap: DraftSnapshot) => {
    lastSnapRef.current = snap
  }, [])

  useEffect(() => {
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
        sectionCount,
      })
      // 写盘挪到空闲时段：一篇文章带正文 30–60KB，同步写会卡主线程十几毫秒，
      // 而 800ms 的防抖窗口正好是用户还在打字的时候
      whenIdle(() => {
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
    digest, platformStates, metaLab, sectionCount, onDrafts, toast,
  ])

  return { saveStatus, savedAt, adoptSnapshot }
}
