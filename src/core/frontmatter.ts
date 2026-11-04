/**
 * Front matter 解析
 *
 * 刻意不用 js-yaml / gray-matter：博客里 110 篇文章的 front matter 是人手写的，
 * 存在「结束 --- 前有空行」「数组用 flow 写法 ["a", "b"]」「值里有冒号」等情况。
 * 用通用 YAML 解析器会因为个别格式问题整篇解析失败，而我们只需要取出十来个已知字段。
 * 这里按行提取 + 支持 YAML 子集，坏行直接跳过并记 warning，绝不让整篇文章导入失败。
 */

import type { DocMeta } from './ir'

export interface SplitResult {
  /** front matter 原文（不含两侧 ---），无 front matter 时为空串 */
  raw: string
  /** 正文（已去掉 front matter） */
  body: string
  /** front matter 占用的行数，用于把 token.map 映射回正文行 */
  bodyLineOffset: number
  found: boolean
}

const FM_OPEN = /^---\s*$/
const FM_CLOSE = /^(---|\.\.\.)\s*$/

/** 拆出 front matter 与正文 */
export function splitFrontMatter(src: string): SplitResult {
  // 去掉 BOM
  const text = src.charCodeAt(0) === 0xfeff ? src.slice(1) : src
  const lines = text.split(/\r?\n/)

  // 跳过开头空行找 ---
  let start = 0
  while (start < lines.length && lines[start].trim() === '') start++
  if (start >= lines.length || !FM_OPEN.test(lines[start])) {
    return { raw: '', body: text, bodyLineOffset: 0, found: false }
  }

  // 找结束标记
  let end = -1
  for (let i = start + 1; i < lines.length; i++) {
    if (FM_CLOSE.test(lines[i])) {
      end = i
      break
    }
  }
  if (end === -1) {
    // 只有开头没有结尾：当作没有 front matter，整体都是正文
    return { raw: '', body: text, bodyLineOffset: 0, found: false }
  }

  const raw = lines.slice(start + 1, end).join('\n')
  const body = lines.slice(end + 1).join('\n')
  return { raw, body, bodyLineOffset: end + 1, found: true }
}

/* ------------------------------------------------------------------ */
/* YAML 子集解析                                                        */
/* ------------------------------------------------------------------ */

type YamlValue = string | string[] | boolean

function stripQuotes(input: string): string {
  const s = input.trim()
  if (s.length < 2) return s
  const q = s[0]
  const last = s[s.length - 1]
  if (q === '"' && last === '"') {
    return s
      .slice(1, -1)
      .replace(/\\"/g, '"')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\\\/g, '\\')
  }
  if (q === "'" && last === "'") {
    return s.slice(1, -1).replace(/''/g, "'")
  }
  return s
}

/** 按逗号切分 flow 数组内容，忽略引号与嵌套括号内的逗号 */
function splitFlow(inner: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote: string | null = null
  let depth = 0
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]
    if (quote) {
      cur += ch
      if (ch === quote && inner[i - 1] !== '\\') quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      cur += ch
      continue
    }
    if (ch === '[' || ch === '{') depth++
    if (ch === ']' || ch === '}') depth--
    if (ch === ',' && depth === 0) {
      out.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  if (cur.trim()) out.push(cur)
  return out.map((s) => stripQuotes(s)).filter((s) => s !== '')
}

function parseScalar(input: string): YamlValue {
  const s = input.trim()
  if (!s) return ''
  // 引号包裹 → 一定是字符串（避免 "false" 被转成布尔）
  if ((s[0] === '"' && s.endsWith('"')) || (s[0] === "'" && s.endsWith("'"))) {
    return stripQuotes(s)
  }
  if (s === 'true' || s === 'True' || s === 'TRUE') return true
  if (s === 'false' || s === 'False' || s === 'FALSE') return false
  if (s === '~' || s === 'null' || s === 'Null' || s === 'NULL') return ''
  // flow 数组
  if (s.startsWith('[') && s.endsWith(']')) {
    return splitFlow(s.slice(1, -1))
  }
  // 其它一律当字符串：日期、数字都不做类型转换，渲染时按原文输出更安全
  return s
}

/** 找到 key 后面第一个不在引号内的冒号 */
function findColon(line: string): number {
  let quote: string | null = null
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quote) {
      if (ch === quote && line[i - 1] !== '\\') quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === ':') return i
  }
  return -1
}

export interface ParsedFrontMatter {
  data: Record<string, YamlValue>
  warnings: string[]
}

/** 解析 front matter 原文为键值对 */
export function parseFrontMatter(raw: string): ParsedFrontMatter {
  const data: Record<string, YamlValue> = {}
  const warnings: string[] = []
  if (!raw.trim()) return { data, warnings }

  const lines = raw.split(/\r?\n/)
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    // 跳过空行、注释、缩进行（缩进行由上面的 key 消费）
    if (!line.trim() || line.trim().startsWith('#')) {
      i++
      continue
    }
    if (/^\s/.test(line)) {
      // 孤立的缩进行，说明上一行不是合法 key，跳过
      warnings.push(`忽略无法归属的缩进行：${line.trim().slice(0, 40)}`)
      i++
      continue
    }

    const colon = findColon(line)
    if (colon <= 0) {
      warnings.push(`忽略无法解析的行：${line.trim().slice(0, 40)}`)
      i++
      continue
    }

    const key = line.slice(0, colon).trim()
    const rest = line.slice(colon + 1).trim()
    i++

    // 情形一：key: 后面为空 → 可能是块数组（- item）或跨行标量
    if (rest === '') {
      // 先看紧邻的下一行属于哪种形态
      const first = lines[i]
      const isDash = first !== undefined && /^\s*-\s/.test(first)
      const isIndented = first !== undefined && /^\s+\S/.test(first)

      if (!isDash && !isIndented) {
        data[key] = ''
        continue
      }

      const items: string[] = []
      const scalarLines: string[] = []

      while (i < lines.length) {
        const next = lines[i]
        if (!next.trim()) break
        if (!/^\s/.test(next)) break // 回到顶格 → 下一个 key

        if (isDash) {
          if (/^\s*-\s/.test(next)) {
            items.push(stripQuotes(next.replace(/^\s*-\s?/, '')))
            i++
            continue
          }
          // 数组项内部的续行，拼到上一项
          if (items.length) {
            items[items.length - 1] = `${items[items.length - 1]} ${next.trim()}`.trim()
            i++
            continue
          }
          break
        }

        scalarLines.push(next.trim())
        i++
      }

      if (isDash) {
        data[key] = items
      } else {
        data[key] = scalarLines.join(' ')
      }
      continue
    }

    // 情形二：块标量 | 或 >
    if (rest === '|' || rest === '>' || rest === '|-' || rest === '>-' || rest === '|+' || rest === '>+') {
      const buf: string[] = []
      const sep = rest.startsWith('>') ? ' ' : '\n'
      while (i < lines.length && (/^\s+\S/.test(lines[i]) || lines[i].trim() === '')) {
        buf.push(lines[i].trim())
        i++
      }
      data[key] = buf.join(sep).trim()
      continue
    }

    // 情形三：普通标量 / flow 数组
    data[key] = parseScalar(rest)
  }

  return { data, warnings }
}

/* ------------------------------------------------------------------ */
/* 组装 DocMeta                                                         */
/* ------------------------------------------------------------------ */

const KNOWN_KEYS = new Set([
  'title',
  'categories',
  'tags',
  'date',
  'lastmod',
  'summary',
  'description',
  'slug',
  'series',
  'draft',
  'comments',
])

function asString(v: YamlValue | undefined): string {
  if (v === undefined) return ''
  if (Array.isArray(v)) return v.join('、')
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return v
}

function asStringArray(v: YamlValue | undefined): string[] {
  if (v === undefined) return []
  if (Array.isArray(v)) return v.filter(Boolean)
  if (typeof v === 'boolean') return []
  const s = v.trim()
  if (!s) return []
  // 容忍 categories: 思考,随笔 这种逗号分隔写法
  if (s.includes(',')) return s.split(',').map((x) => x.trim()).filter(Boolean)
  return [s]
}

export interface BuildMetaResult {
  meta: DocMeta
  warnings: string[]
}

/** 由 front matter 键值对组装 DocMeta；缺字段时用正文做兜底推断 */
export function buildMeta(
  data: Record<string, YamlValue>,
  fallbackTitle: string,
  bodyText: string,
): BuildMetaResult {
  const warnings: string[] = []

  let title = asString(data.title).trim()
  if (!title) {
    title = fallbackTitle.trim()
    if (title) warnings.push('front matter 缺少 title，已从文件名推断')
  }

  const extra: Record<string, string | string[] | boolean> = {}
  for (const [k, v] of Object.entries(data)) {
    if (!KNOWN_KEYS.has(k)) extra[k] = v
  }

  let summary = asString(data.summary).trim()
  if (!summary) summary = asString(data.description).trim()
  if (!summary) {
    // 用正文第一段兜底，截到 80 字
    const firstPara = bodyText.split(/\n\s*\n/).map((p) => p.trim()).find((p) => p && !p.startsWith('#') && !p.startsWith('!'))
    if (firstPara) {
      const plain = firstPara.replace(/[#>*_`\[\]]/g, '').replace(/\s+/g, ' ').trim()
      summary = plain.length > 80 ? `${plain.slice(0, 80)}…` : plain
    }
  }

  const meta: DocMeta = {
    title,
    categories: asStringArray(data.categories),
    tags: asStringArray(data.tags),
    date: asString(data.date).trim() || undefined,
    summary,
    description: asString(data.description).trim() || summary,
    slug: asString(data.slug).trim() || undefined,
    series: asStringArray(data.series),
    draft: typeof data.draft === 'boolean' ? data.draft : undefined,
    extra,
  }

  return { meta, warnings }
}
