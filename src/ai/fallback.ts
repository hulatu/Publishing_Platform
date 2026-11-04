/**
 * 本地兜底：不调用大模型时的「抽取式」摘要与组装
 *
 * 定位：保证「AI 不可用」时工具仍然产出结构正确的内容，而不是空白。
 * 明确不追求文笔 —— 但它必须保持和 AI 版本**同样的结构**：
 * 逐节摘要 → 小红书「· 小标题：说明」/ 推特一条一节 / 微博一句话。
 *
 * 所以 UI 上必须标注「本地抽取，非 AI 改写」。
 */

import type { Doc } from '../core/ir'
import type { ArticleSection } from '../core/sections'
import { charCount, splitSentences, truncateByChars, truncateByWeight } from '../core/cjk'
import { LIMITS, type AIResultSet, type DigestSet, type RewriteId, type SectionDigest } from './types'

/* ------------------------------------------------------------------ */
/* 抽句                                                                 */
/* ------------------------------------------------------------------ */

const NOISE_PREFIX = /^(注|注：|提示|说明|参考|来源|延伸阅读|相关阅读)[:：]?/

/** 以标点开头的残句（上一句在引号/冒号处被切断留下的尾巴） */
const LEADING_PUNCT = /^[，。、；：！？）」』】…—,.;:!?)\]】]/

/**
 * 抽句候选。
 * 必须先按行切、再按句切：正文里的换行本身就是语义边界，
 * 整段丢给 splitSentences 会把两行粘成一句超长「句子」。
 */
function sentenceCandidates(bodyText: string): string[] {
  const out: string[] = []
  for (const line of bodyText.split(/\n+/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    for (const raw of splitSentences(trimmed)) {
      const t = raw.replace(/\s+/g, ' ').trim()
      if (charCount(t) < 10) continue
      if (LEADING_PUNCT.test(t)) continue
      if (NOISE_PREFIX.test(t)) continue
      out.push(t)
    }
  }
  return out
}

/** 句子打分：信息密度高的优先 */
function scoreSentence(s: string, order: number): number {
  const c = charCount(s)
  let score = 0

  if (c >= 24 && c <= 80) score += 4
  else if (c > 80 && c <= 120) score += 2
  else if (c < 16) score -= 3
  else if (c > 120) score -= 1

  if (/\d/.test(s)) score += 2
  if (/[：:]/.test(s)) score += 1
  if (/「[^」]+」/.test(s)) score += 1
  if (/^[（(]/.test(s)) score -= 2

  // 首句更可能是本节主旨
  score += Math.max(0, 2.5 - order * 0.5)
  return score
}

/**
 * 从一节正文里抽出 1–2 句组成摘要。
 * 优先取信息量最高的一句；若还不足 40 字，再补一句最近的。
 */
function summarizeSection(section: ArticleSection): string {
  const sentences = sentenceCandidates(section.bodyText)

  if (sentences.length === 0) {
    const plain = section.bodyText.replace(/\s+/g, ' ').trim()
    return truncateByChars(plain, 90, '…')
  }

  const ranked = sentences
    .map((text, i) => ({ text, i, score: scoreSentence(text, i) }))
    .sort((a, b) => b.score - a.score)

  const first = ranked[0]
  let out = first.text

  // 不足 40 字就按原文顺序继续补最近的句子，最多 3 句 —— 否则会出现「最喜欢的餐点，嗯……」这种残句
  const nearby = sentences
    .map((text, i) => ({ text, i }))
    .filter((x) => x.i !== first.i)
    .sort((a, b) => Math.abs(a.i - first.i) - Math.abs(b.i - first.i))

  let used = 1
  for (const cand of nearby) {
    if (charCount(out) >= 40 || used >= 3) break
    const joined = `${out}${/[。！？；]$/.test(out) ? '' : '。'}${cand.text}`
    if (charCount(joined) > LIMITS.digestMax) continue
    // 已经有点东西了就别再吞一个长句，摘要会失控
    if (charCount(out) >= 25 && charCount(joined) > 95) continue
    out = joined
    used++
  }

  out = out.replace(/\s+/g, ' ').trim()
  if (charCount(out) > LIMITS.digestMax) out = truncateByChars(out, LIMITS.digestMax, '…')
  return out
}

/** 本地生成逐节摘要（结构与 AI 版本完全一致，便于直接替换） */
export function localDigest(sections: ArticleSection[]): DigestSet {
  const list: SectionDigest[] = sections.map((s) => ({
    index: s.index,
    heading: s.heading,
    summary: summarizeSection(s),
  }))

  // 全篇一句话：取第一节摘要的第一句，去掉句末标点后压到 60 字内
  const first = list[0]?.summary ?? ''
  const firstSentence = (splitSentences(first)[0] ?? first).replace(/\s+/g, ' ').trim()
  const oneLiner = truncateByChars(firstSentence.replace(/[。！？；]$/, ''), LIMITS.oneLinerMax, '')

  return { sections: list, oneLiner }
}

/** 补齐缺失的小节（AI 漏节时用本地摘要填空，不让整条链路失败） */
export function fillMissingDigest(digest: DigestSet, sections: ArticleSection[]): { data: DigestSet; filled: number[] } {
  const local = localDigest(sections)
  const filled: number[] = []
  const merged = digest.sections.map((s) => {
    if (s.summary) return s
    const fb = local.sections.find((x) => x.index === s.index)
    if (fb?.summary) {
      filled.push(s.index)
      return { ...s, summary: fb.summary }
    }
    return s
  })
  return { data: { sections: merged, oneLiner: digest.oneLiner || local.oneLiner }, filled }
}

/* ------------------------------------------------------------------ */
/* 小标题与收尾                                                         */
/* ------------------------------------------------------------------ */

const HEADING_NOISE = /^[\d\s.、,，:：\-—_·•#*【】\[\]（）()]+/

/** 把 ## 标题压成 4–8 字的小标题 */
export function shortLabel(heading: string): string {
  let s = heading.replace(HEADING_NOISE, '').trim()
  s = s.replace(/[，,。；;：:！!？?].*$/, '').trim()
  if (charCount(s) > 8) s = truncateByChars(s, 8, '')
  return s || truncateByChars(heading, 8, '')
}

function pickTopics(doc: Doc, max: number): string[] {
  const out: string[] = []
  for (const t of [...doc.meta.tags, ...doc.meta.categories]) {
    const clean = t.trim().replace(/^#+/, '')
    if (clean && !out.includes(clean)) out.push(clean)
    if (out.length >= max) break
  }
  return out
}

/** 收尾：用最后一节的标题造一个具体问题，比通用问句更像人话 */
function buildOutro(digest: DigestSet): string {
  const last = digest.sections[digest.sections.length - 1]
  if (!last) return ''
  return `关于「${shortLabel(last.heading)}」，你是怎么想的？`
}

/* ------------------------------------------------------------------ */
/* 平台组装                                                             */
/* ------------------------------------------------------------------ */

/** 开篇小节不进要点列表：它的内容已经当开场钩子用了，重复列一遍很蠢 */
function bulletSections(digest: DigestSet): SectionDigest[] {
  return digest.sections.filter((s) => s.summary && s.heading !== '开篇')
}

/** 「小标题：说明」，说明里已经以标签开头时不再重复加冒号 */
function bulletLine(s: SectionDigest, limit = 45): string {
  const label = shortLabel(s.heading)
  const body = truncateByChars(s.summary, limit, '…')
  if (body.startsWith(label)) return `· ${body}`
  return `· ${label}：${body}`
}

function buildXhs(digest: DigestSet, doc: Doc): AIResultSet['xhs'] {
  const title = truncateByChars(doc.meta.title.replace(/[!！]+$/, ''), LIMITS.xhsTitle, '')
  const bullets = bulletSections(digest).slice(0, 5).map((s) => bulletLine(s))

  const parts = [digest.oneLiner, bullets.join('\n'), buildOutro(digest)].filter(Boolean)
  return {
    title,
    body: truncateByChars(parts.join('\n\n'), LIMITS.xhsBody),
    tags: pickTopics(doc, 5),
  }
}

function buildTwitter(digest: DigestSet): AIResultSet['twitter'] {
  const head = truncateByWeight(digest.oneLiner, LIMITS.twitterBudget)
  const thread = [head]

  for (const s of bulletSections(digest)) {
    thread.push(truncateByWeight(bulletLine(s, 90).replace(/^· /, ''), LIMITS.twitterBudget))
    if (thread.length >= 7) break
  }

  const outro = buildOutro(digest)
  if (outro) thread.push(truncateByWeight(outro, LIMITS.twitterBudget))

  return { thread: thread.slice(0, 8) }
}

function buildJike(digest: DigestSet): AIResultSet['jike'] {
  const body = [digest.oneLiner, ...bulletSections(digest).slice(0, 3).map((s) => s.summary)]
    .filter(Boolean)
    .join('\n\n')
  return { body: truncateByChars(body, LIMITS.jikeBody) }
}

function buildWeibo(digest: DigestSet, doc: Doc): AIResultSet['weibo'] {
  return {
    text: truncateByChars(digest.oneLiner || doc.meta.title, LIMITS.weiboText),
    topics: pickTopics(doc, LIMITS.weiboTopics),
  }
}

/** 只组装某一个平台（新流水线用） */
export function buildPlatformFromDigest(platform: RewriteId, digest: DigestSet, doc: Doc): AIResultSet {
  if (platform === 'xiaohongshu') return { xhs: buildXhs(digest, doc) }
  if (platform === 'twitter') return { twitter: buildTwitter(digest) }
  if (platform === 'jike') return { jike: buildJike(digest) }
  return { weibo: buildWeibo(digest, doc) }
}

/** 四个平台一起（兼容旧调用） */
export function buildAllFromDigest(digest: DigestSet, doc: Doc): AIResultSet {
  return {
    ...buildPlatformFromDigest('xiaohongshu', digest, doc),
    ...buildPlatformFromDigest('twitter', digest, doc),
    ...buildPlatformFromDigest('jike', digest, doc),
    ...buildPlatformFromDigest('weibo', digest, doc),
  }
}
