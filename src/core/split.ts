/**
 * 按 H2 拆篇
 *
 * 用途：把一个长主题按二级标题拆成系列，或按平台后台提示自行拆分。
 * 工具不再做字数上限判定，这个功能只作为通用的导出方式保留。
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
