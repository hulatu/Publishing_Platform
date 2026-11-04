/**
 * 按 H2 拆篇
 *
 * 用途：公众号 content 字段上限 20000 字符。长文（最长 15.5k 字）加上 inline style
 * 后可能超限，此时按二级标题切成多篇，是唯一不损失内容又不改排版的解法。
 */

import type { Block, Doc } from './ir'

/** 按 level=2 的标题把文章切成多篇；首段（第一个 H2 之前的内容）并入第一篇 */
export function splitByH2(doc: Doc): Doc[] {
  const parts: Block[][] = []
  let current: Block[] = []

  for (const block of doc.blocks) {
    if (block.t === 'heading' && block.level === 2 && current.length > 0) {
      parts.push(current)
      current = [block]
      continue
    }
    current.push(block)
  }
  if (current.length > 0) parts.push(current)

  if (parts.length <= 1) return [doc]

  return parts.map((blocks, i) => ({
    ...doc,
    meta: {
      ...doc.meta,
      title: `${doc.meta.title}（${i + 1}/${parts.length}）`,
      slug: doc.meta.slug ? `${doc.meta.slug}-${i + 1}` : undefined,
    },
    blocks,
    warnings: [...doc.warnings],
  }))
}

/** 估算拆成几篇后每篇的标题，用于 UI 预览 */
export function previewSplitTitles(doc: Doc): string[] {
  return splitByH2(doc).map((d) => d.meta.title)
}
