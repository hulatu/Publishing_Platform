/**
 * 中文社媒的字数计算与切分
 *
 * 各平台规则不同，必须分开处理：
 * - Twitter/X：280「加权字符」，CJK 每字算 2 → 实际约 140 汉字
 * - 微博：140 汉字（每个汉字算 1）
 * - 即刻：500 字
 * - 小红书：正文 1000 字、标题 20 字
 */

/** 判断是否为宽字符（CJK、全角标点、假名、韩文等） */
export function isWide(ch: string): boolean {
  const cp = ch.codePointAt(0)
  if (cp === undefined) return false
  return (
    (cp >= 0x1100 && cp <= 0x115f) || // 韩文字母
    (cp >= 0x2e80 && cp <= 0x303e) || // CJK 部首、标点
    (cp >= 0x3041 && cp <= 0x33ff) || // 假名、CJK 兼容
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK 扩展 A
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK 基本区
    (cp >= 0xa000 && cp <= 0xa4cf) || // 彝文
    (cp >= 0xac00 && cp <= 0xd7a3) || // 韩文音节
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK 兼容表意
    (cp >= 0xfe30 && cp <= 0xfe4f) || // CJK 兼容形式
    (cp >= 0xff00 && cp <= 0xff60) || // 全角 ASCII
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1f9ff) || // emoji
    (cp >= 0x20000 && cp <= 0x3fffd) // CJK 扩展 B 及以上
  )
}

/** 按码点计字数（emoji 算 1 个） */
export function charCount(s: string): number {
  return [...s].length
}

/** Twitter 式加权长度：宽字符算 2，其余算 1 */
export function weightedLength(s: string): number {
  let n = 0
  for (const ch of s) n += isWide(ch) ? 2 : 1
  return n
}

/** 按加权长度截断，超出时补省略号 */
export function truncateByWeight(s: string, max: number, ellipsis = '…'): string {
  if (weightedLength(s) <= max) return s
  const budget = max - weightedLength(ellipsis)
  let out = ''
  let used = 0
  for (const ch of s) {
    const w = isWide(ch) ? 2 : 1
    if (used + w > budget) break
    out += ch
    used += w
  }
  return out + ellipsis
}

/** 按字数截断 */
export function truncateByChars(s: string, max: number, ellipsis = '…'): string {
  const chars = [...s]
  if (chars.length <= max) return s
  return chars.slice(0, Math.max(0, max - 1)).join('') + ellipsis
}

/* ------------------------------------------------------------------ */
/* 句子切分                                                            */
/* ------------------------------------------------------------------ */

const SENTENCE_END = /[。！？；…!?;]/

/** 把长文本切成句子（中文按句末标点，英文按句点+空格） */
export function splitSentences(text: string): string[] {
  const out: string[] = []
  let buf = ''

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    buf += ch

    if (SENTENCE_END.test(ch)) {
      // 吃掉连续句末标点，以及紧跟的右引号/右括号
      while (i + 1 < text.length && /[。！？；…!?;」』”’)）]/.test(text[i + 1])) {
        buf += text[++i]
      }
      if (buf.trim()) out.push(buf.trim())
      buf = ''
      continue
    }

    // 英文句点：后面是空格且前一位是字母
    if (ch === '.' && i + 1 < text.length && text[i + 1] === ' ') {
      if (buf.trim()) out.push(buf.trim())
      buf = ''
    }
  }

  if (buf.trim()) out.push(buf.trim())
  return out
}

/* ------------------------------------------------------------------ */
/* Twitter thread 切分                                                 */
/* ------------------------------------------------------------------ */

/** 推特单条上限 280 加权字符；留 5 的余量：编号前缀 "1/7 " 在渲染时才拼，但仍留冗余防边界 */
const TWITTER_BUDGET = 275

export interface ThreadResult {
  tweets: string[]
  /** 是否有内容因为超长被硬切 */
  hardSplit: boolean
}

/**
 * 把正文切成 thread。
 * 先按段落，再按句子，贪心装填；单句仍超长则按加权长度硬切。
 */
export function splitThread(body: string, budget = TWITTER_BUDGET): ThreadResult {
  const paragraphs = body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)

  const units: string[] = []
  for (const para of paragraphs) {
    const sentences = splitSentences(para)
    if (sentences.length === 0) {
      units.push(para)
      continue
    }
    units.push(...sentences)
  }

  const tweets: string[] = []
  let current = ''
  let hardSplit = false

  const flush = () => {
    if (current.trim()) tweets.push(current.trim())
    current = ''
  }

  for (const unit of units) {
    const joined = current ? `${current}\n${unit}` : unit

    if (weightedLength(joined) <= budget) {
      current = joined
      continue
    }

    flush()

    // 单句本身就超长 → 硬切
    if (weightedLength(unit) > budget) {
      hardSplit = true
      let rest = unit
      while (weightedLength(rest) > budget) {
        const head = truncateByWeight(rest, budget, '')
        tweets.push(head)
        rest = rest.slice(head.length)
      }
      current = rest
      continue
    }

    current = unit
  }

  flush()
  return { tweets: tweets.length > 0 ? tweets : [''], hardSplit }
}

/* ------------------------------------------------------------------ */
/* emoji 计数（用于校验 AI 输出是否 emoji 泛滥）                          */
/* ------------------------------------------------------------------ */

const EMOJI_RE = /\p{Extended_Pictographic}/gu

export function countEmoji(s: string): number {
  return (s.match(EMOJI_RE) ?? []).length
}

/** 中文社媒常见的营销腔黑名单 */
export const MARKETING_BLACKLIST = [
  '姐妹们',
  '家人们',
  '宝子',
  '绝了',
  'yyds',
  'YYDS',
  '爆肝',
  '干货满满',
  '码住',
  '冲鸭',
  '狠狠',
  '谁懂啊',
  '我不允许',
  '必看',
  '速速',
  '真的会谢',
  '哭死',
  '上头',
]

export function findBlacklisted(s: string): string[] {
  return MARKETING_BLACKLIST.filter((w) => s.includes(w))
}
