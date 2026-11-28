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
 * - 默认不导出 Key：备份文件常被放进网盘或发给自己，带 Key 等于把额度交出去；
 *   换机要 Key 时在设置里显式勾选「包含 API Key」，UI 同时提示别分享。
 * - 恢复只写不删：文件里没有的项保持原样，避免「导入一份旧备份顺手清掉新草稿」。
 * - 导入前先预览项数和是否含密钥，确认后才写。
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
/** 默认不进备份的密钥；要换机时由用户显式勾选「包含 Key」 */
export const SECRET_KEYS = new Set(['dispatch.byok.v1', 'dispatch.unsplash.v1'])

export interface Backup {
  app: string
  version: number
  exportedAt: string
  data: Record<string, string>
}

export interface BackupOptions {
  /**
   * 是否把 API Key 一起导出。
   *
   * 默认**不导**：备份文件经常被随手放进网盘 / 发给自己，一旦带 Key
   * 就等于把账号额度交出去。换机时想要 Key，在设置里显式勾选。
   */
  includeSecrets?: boolean
}

function isOurs(key: string): boolean {
  return !SKIP.has(key) && PREFIXES.some((prefix) => key.startsWith(prefix))
}

/** 收集当前浏览器里的全部相关数据 */
export function collectBackup(opts: BackupOptions = {}): Backup {
  const includeSecrets = opts.includeSecrets === true
  const data: Record<string, string> = {}
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key || !isOurs(key)) continue
      if (!includeSecrets && SECRET_KEYS.has(key)) continue
      const value = localStorage.getItem(key)
      if (value !== null) data[key] = value
    }
  } catch {
    // 隐私模式下连 length 都可能抛异常；当作空处理，导出空文件也比崩掉好
  }
  return { app: APP, version: VERSION, exportedAt: new Date().toISOString(), data }
}

export function backupText(opts: BackupOptions = {}): string {
  return JSON.stringify(collectBackup(opts), null, 2)
}

/** `文章分发台-本地数据-20261115-不含密钥.json`；同一天导两次会覆盖（浏览器自己加 (1)） */
export function backupFileName(opts: BackupOptions = {}): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const suffix = opts.includeSecrets === true ? '含密钥' : '不含密钥'
  return `文章分发台-本地数据-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${suffix}.json`
}

/** 备份里有多少项、多大，用于给用户一句确切的反馈 */
export function describeBackup(b: Backup): string {
  const keys = Object.keys(b.data).length
  const bytes = Object.values(b.data).reduce((n, v) => n + v.length, 0)
  return `${keys} 项 · ${formatBytes(bytes)}`
}

/** 备份里包含几个密钥（默认导出应为 0） */
export function countSecrets(b: Backup): number {
  return Object.keys(b.data).filter((key) => SECRET_KEYS.has(key)).length
}

export interface BackupPreview {
  backup: Backup | null
  error: string | null
  keys: number
  secrets: number
}

/** 只解析、不写盘；导入前给用户确认用 */
export function previewBackup(text: string): BackupPreview {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { backup: null, error: '这个文件不是 JSON', keys: 0, secrets: 0 }
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { backup: null, error: '这个文件不是备份文件', keys: 0, secrets: 0 }
  }

  const obj = parsed as Partial<Backup>
  if (obj.app !== APP) {
    return { backup: null, error: '这不是「文章分发台」导出的备份', keys: 0, secrets: 0 }
  }
  if (obj.version !== VERSION) {
    return {
      backup: null,
      error: `备份版本是 ${String(obj.version)}，当前版本是 ${VERSION}，不认这个格式`,
      keys: 0,
      secrets: 0,
    }
  }
  if (typeof obj.data !== 'object' || obj.data === null) {
    return { backup: null, error: '备份里没有数据', keys: 0, secrets: 0 }
  }

  const backup = obj as Backup
  return {
    backup,
    error: null,
    keys: Object.keys(backup.data).length,
    secrets: countSecrets(backup),
  }
}

export interface RestoreResult {
  keys: number
  failed: number
  error: string | null
}

/** 从备份文件恢复。只写不删；写不进去（配额满）要如实报出来 */
export function restoreBackup(text: string): RestoreResult {
  const preview = previewBackup(text)
  if (!preview.backup || preview.error) {
    return { keys: 0, failed: 0, error: preview.error ?? '这个文件不是备份文件' }
  }

  let keys = 0
  let failed = 0
  for (const [key, value] of Object.entries(preview.backup.data)) {
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
