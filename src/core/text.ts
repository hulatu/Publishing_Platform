/**
 * 文本解码
 *
 * `File.text()` 永远按 UTF-8 解，而且**不报错**：一份 GBK 的 .md
 * 会被解成「æ–‡ç« å†…å®¹」这种乱码，然后被当成正常正文解析下去 ——
 * 用户看到的是满屏乱码，却完全不知道问题出在编码上。
 *
 * 中文用户的 .md 来源很杂：Windows 记事本（ANSI = GBK）、
 * 老版 Typora、某些博客导出、微信/QQ 传文件时转过码。所以要先嗅探再解。
 *
 * 判定顺序：
 * 1. UTF-8 BOM → 确定是 UTF-8
 * 2. 严格 UTF-8 解码（fatal: true）→ 成功就是 UTF-8
 * 3. 失败 → 按 GB18030（GBK 的超集）解
 *
 * 独立成文件是为了能在 node 里断言，不用起浏览器。
 */

export type TextEncoding = 'utf-8' | 'gb18030'

export interface DecodeResult {
  text: string
  encoding: TextEncoding
  /** 原文带 UTF-8 BOM。留着它会把 front matter 的 `---` 顶成 `\uFEFF---`，必须去掉 */
  hadBom: boolean
}

const BOM = [0xef, 0xbb, 0xbf]

function hasUtf8Bom(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && BOM.every((b, i) => bytes[i] === b)
}

export function decodeText(bytes: Uint8Array): DecodeResult {
  const bom = hasUtf8Bom(bytes)
  const body = bom ? bytes.subarray(3) : bytes

  try {
    return {
      text: new TextDecoder('utf-8', { fatal: true }).decode(body),
      encoding: 'utf-8',
      hadBom: bom,
    }
  } catch {
    // 不是合法 UTF-8，按中文 Windows 的默认编码再试一次
  }

  try {
    return {
      text: new TextDecoder('gb18030').decode(body),
      encoding: 'gb18030',
      hadBom: bom,
    }
  } catch {
    // 运行环境不支持 gb18030（极少见）：退回宽松 UTF-8，
    // 有乱码但至少不丢内容，也不让导入直接失败
    return {
      text: new TextDecoder('utf-8').decode(body),
      encoding: 'utf-8',
      hadBom: bom,
    }
  }
}

/**
 * 粗略判断一段文本像不像「被错当成 UTF-8 解的 GBK」。
 *
 * 备用信号：某些浏览器 / 旧环境没有 gb18030 解码器，
 * 或者文件本身是 UTF-8 但混了几行 GBK（复制粘贴拼出来的）。
 * 特征是大量 U+FFFD 替换符，或连续出现拉丁扩展区字母（æ å ç）。
 */
export function looksMojibake(text: string): boolean {
  if (!text) return false
  const sample = text.slice(0, 4000)
  const bad = (sample.match(/\uFFFD/g) ?? []).length
  if (bad > 0) return true
  const latin = (sample.match(/[ÃÂåæçèéêëìíîïðñòóôõöøùúûüýþ]/g) ?? []).length
  // 中文文章里正常不会出现成片的西欧重音字母
  return latin > sample.length * 0.05
}
