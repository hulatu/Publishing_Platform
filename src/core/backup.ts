/**
 * 本地数据的整包备份
 *
 * 这个工具没有后端：草稿、发布台账、公众号文末模板、Key、界面偏好全在
 * 这一台浏览器里。浏览器清一次缓存、换一台电脑、开个无痕窗口，这些就都没了 ——
 * 而草稿里躺着的是花过 token 生成的文案。
 *
 * 所以给一个「导出成一个 JSON / 从 JSON 恢复」的口子。几个取舍：
 * - 按 key 前缀收，而不是写死一张清单：新增存储项时不用回来改这里，
 *   漏改的代价是「备份里少了新数据」，比「备份里有别人的数据」糟得多。
 * - 导出包含 Key。没有 Key 的备份恢复后还得重新填，失去了「换机」的意义；
 *   但 UI 上必须写明「这个文件含密钥，别分享」。
 * - 恢复只写不删：文件里没有的项保持原样，避免「导入一份旧备份顺手清掉新草稿」。
 * - 不校验内容结构，只校验外层信封。各模块自己读的时候本来就做了防御
 *   （解析失败就当空），没必要在这里再实现一遍。
 */

import { formatBytes } from './num'

const APP = 'article-dispatch'
const VERSION = 1

/** 本项目用到的两个命名空间。`dispatch.` 是早期 AI 相关模块留下来的 */
const PREFIXES = ['ad.', 'dispatch.']
/** 读写探针，不该进备份 */
const SKIP = new Set(['ad.recovery-probe'])

export interface Backup {
  app: string
  version: number
  exportedAt: string
  data: Record<string, string>
}

function isOurs(key: string): boolean {
  return !SKIP.has(key) && PREFIXES.some((prefix) => key.startsWith(prefix))
}

/** 收集当前浏览器里的全部相关数据 */
export function collectBackup(): Backup {
  const data: Record<string, string> = {}
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key || !isOurs(key)) continue
      const value = localStorage.getItem(key)
      if (value !== null) data[key] = value
    }
  } catch {
    // 隐私模式下连 length 都可能抛异常；当作空处理，导出空文件也比崩掉好
  }
  return { app: APP, version: VERSION, exportedAt: new Date().toISOString(), data }
}

export function backupText(): string {
  return JSON.stringify(collectBackup(), null, 2)
}

/** `文章分发台-本地数据-20261115.json`，同一天导两次会覆盖（浏览器自己加 (1)） */
export function backupFileName(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `文章分发台-本地数据-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.json`
}

/** 备份里有多少项、多大，用于给用户一句确切的反馈 */
export function describeBackup(b: Backup): string {
  const keys = Object.keys(b.data).length
  const bytes = Object.values(b.data).reduce((n, v) => n + v.length, 0)
  return `${keys} 项 · ${formatBytes(bytes)}`
}

export interface RestoreResult {
  keys: number
  failed: number
  error: string | null
}

/** 从备份文件恢复。只写不删；写不进去（配额满）要如实报出来 */
export function restoreBackup(text: string): RestoreResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { keys: 0, failed: 0, error: '这个文件不是 JSON' }
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { keys: 0, failed: 0, error: '这个文件不是备份文件' }
  }

  const obj = parsed as Partial<Backup>
  if (obj.app !== APP) {
    return { keys: 0, failed: 0, error: '这不是「文章分发台」导出的备份' }
  }
  if (obj.version !== VERSION) {
    return {
      keys: 0,
      failed: 0,
      error: `备份版本是 ${String(obj.version)}，当前版本是 ${VERSION}，不认这个格式`,
    }
  }
  if (typeof obj.data !== 'object' || obj.data === null) {
    return { keys: 0, failed: 0, error: '备份里没有数据' }
  }

  let keys = 0
  let failed = 0
  for (const [key, value] of Object.entries(obj.data)) {
    // 只认自己的 key：别人塞进来的键不该被写进这个域
    if (!isOurs(key) || typeof value !== 'string') continue
    try {
      localStorage.setItem(key, value)
      keys++
    } catch {
      failed++
    }
  }
  return { keys, failed, error: null }
}

/**
 * 清空本项目的全部本地数据（只在「界面已经崩了」的逃生口里用）。
 *
 * 返回清掉了多少项；任何一项删不掉都算失败 —— 这种情况谎报成功更糟。
 */
export function clearAllLocal(): { keys: number; ok: boolean } {
  const doomed: string[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && isOurs(key)) doomed.push(key)
    }
  } catch {
    return { keys: 0, ok: false }
  }
  let keys = 0
  let ok = true
  for (const key of doomed) {
    try {
      localStorage.removeItem(key)
      keys++
    } catch {
      ok = false
    }
  }
  return { keys, ok }
}
