/**
 * 发布检查清单
 *
 * 「发布检查」那个 chip 里展开的几条：标题与标签、正文与排版、合规检查、
 * 发布素材、封面图，公众号还多一条文末。原来是 App.tsx 里 150 行 useMemo，
 * 混着四种平台的判断和五种语气（ok / note / warn / error）。
 *
 * 抽出来纯属因为它只做数据组装：输入是「当前平台 + 产物 + 命中」，输出是一个数组，
 * 里面每个 onAction 只是打开某个弹层。放这儿之后，改文案不用在 1700 行的
 * 组件里翻。
 */

import { useMemo } from 'react'
import type { Doc } from '../core/ir'
import type { ComplianceHit } from '../core/compliance'
import { charCount } from '../core/cjk'
import { activeBlocks, type TailConfig } from '../core/tail'
import type { RenderOutput } from '../renderers'
import type { SheetId } from '../components/Sheet'
import type { ReadinessItem, ReadinessTone } from '../components/ReadinessSheet'

export type ReadinessKind = 'convert' | 'rewrite' | 'card'

interface Options {
  doc: Doc | null
  kind: ReadinessKind
  output: RenderOutput | null
  platform: string
  tail: TailConfig
  /** 当前平台的显示名，用来给「已生成」那句补主语 */
  platformName?: string
  /** 当前平台有 AI 文案了 —— 它决定「平台文案」这一条是 note 还是 ok */
  hasAIResult: boolean
  /** 「小红书全文 / 完整 thread」这类标签 */
  rewriteLabel: string | null
  complianceHits: ComplianceHit[]
  scopeLabel: string
  /** 合规检查用的纯文本；空串表示「还没东西可查」 */
  checkContent: string
  imageCount: number

  openSheet: (id: SheetId) => void
  closeSheet: () => void
  /** 「去生成」把清单收起来并滚回顶部 */
  scrollToTop: () => void
}

export interface Readiness {
  items: ReadinessItem[]
  /** 不计可选项的那几条 */
  required: ReadinessItem[]
  done: number
  tone: ReadinessTone
}

export function useReadiness(opts: Options): Readiness {
  const {
    doc, kind, output, platform, tail, platformName, hasAIResult, rewriteLabel,
    complianceHits, scopeLabel, checkContent, imageCount,
    openSheet, closeSheet, scrollToTop,
  } = opts

  const items = useMemo<ReadinessItem[]>(() => {
    if (!doc) return []

    const title = doc.meta.title.trim()
    const tagCount = doc.meta.tags.length
    const titleTone: ReadinessTone = !title ? 'error' : tagCount > 0 ? 'ok' : 'note'
    const list: ReadinessItem[] = [
      {
        id: 'meta',
        label: '标题与标签',
        summary: !title ? '标题为空，平台产物无法命名' : tagCount > 0 ? `${tagCount} 个标签` : '还没有标签',
        tone: titleTone,
        actionLabel: '标题候选',
        onAction: () => openSheet('meta'),
      },
    ]

    if (kind === 'convert') {
      const words = output ? charCount(output.text) : 0
      list.push({
        id: 'body',
        label: '正文与排版',
        summary: !output
          ? '正在生成当前平台的产物'
          : platform === 'wechat'
            ? `${words.toLocaleString()} 字`
            : `${words.toLocaleString()} 字符`,
        tone: output ? 'ok' : 'note',
      })
    } else if (kind === 'rewrite') {
      list.push({
        id: 'body',
        label: '平台文案',
        summary: hasAIResult
          ? `${rewriteLabel ?? platformName ?? '平台文案'}已生成`
          : '还没有生成文案；本地组装也可用',
        tone: hasAIResult ? 'ok' : 'note',
        actionLabel: hasAIResult ? undefined : '去生成',
        onAction: hasAIResult
          ? undefined
          : () => {
              closeSheet()
              scrollToTop()
            },
      })
    } else {
      list.push({
        id: 'body',
        label: '配图卡片',
        summary: '卡片工坊已就绪 · 导出前确认文字与比例',
        tone: 'ok',
      })
    }

    const highHits = complianceHits.filter((hit) => hit.severity === 'high').length
    list.push({
      id: 'compliance',
      label: '合规检查',
      summary:
        kind === 'card'
          ? '配图导出不走正文词表检查'
          : !checkContent
            ? '生成正文或文案后再检查'
            : complianceHits.length === 0
              ? `${scopeLabel}未发现明显风险`
              : `${scopeLabel}命中 ${complianceHits.length} 处`,
      tone:
        kind === 'card'
          ? 'ok'
          : !checkContent
            ? 'note'
            : complianceHits.length === 0
              ? 'ok'
              : highHits > 0
                ? 'error'
                : 'warn',
      details: complianceHits.slice(0, 6).map((hit) => ({
        label: `${hit.severity === 'high' ? '高' : '中'} · ${hit.label}`,
        text: `${hit.match}：${hit.hint}`,
        tone: hit.severity === 'high' ? 'error' : 'warn',
      })),
    })

    list.push({
      id: 'assets',
      label: '发布素材',
      summary:
        imageCount === 0
          ? '正文没有图片依赖'
          : `${imageCount} 张图片 · 可打开体检与按平台导出`,
      tone: 'ok',
      actionLabel: imageCount > 0 ? '图片体检' : '找封面',
      onAction: () => openSheet(imageCount > 0 ? 'images' : 'cover'),
    })

    list.push({
      id: 'cover',
      label: '封面图',
      summary: '从 Unsplash 搜三张，挑一张下载或复制地址',
      tone: 'note',
      optional: true,
      actionLabel: '找封面',
      onAction: () => openSheet('cover'),
    })

    if (platform === 'wechat') {
      const enabled = activeBlocks(tail)
      list.push({
        id: 'tail',
        label: '公众号文末',
        summary:
          enabled > 0 ? `已启用 ${enabled}/3 块` : '关注引导、往期推荐、版权声明',
        tone: 'note',
        optional: true,
        actionLabel: '编辑文末',
        onAction: () => openSheet('tail'),
      })
    }

    return list
  }, [
    doc, kind, output, platform, tail, platformName, hasAIResult, rewriteLabel,
    complianceHits, scopeLabel, checkContent, imageCount,
    openSheet, closeSheet, scrollToTop,
  ])

  const required = useMemo(() => items.filter((item) => !item.optional), [items])
  const done = required.filter((item) => item.tone === 'ok').length
  const tone: ReadinessTone = required.some((item) => item.tone === 'error')
    ? 'error'
    : required.some((item) => item.tone === 'warn' || item.tone === 'note')
      ? 'warn'
      : 'ok'

  return { items, required, done, tone }
}
