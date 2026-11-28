/**
 * 本地备份回归
 *
 * 默认导出不能带 API Key；预览和恢复只认自己的 key。
 * 这里用内存 localStorage 跑一遍，不碰浏览器。
 */

import { report, ok } from './harness'
import {
  backupFileName,
  collectBackup,
  countSecrets,
  previewBackup,
  restoreBackup,
} from '../src/core/backup'

class MemoryStorage {
  private data = new Map<string, string>()
  get length(): number { return this.data.size }
  key(i: number): string | null { return [...this.data.keys()][i] ?? null }
  getItem(key: string): string | null { return this.data.get(key) ?? null }
  setItem(key: string, value: string): void { this.data.set(key, String(value)) }
  removeItem(key: string): void { this.data.delete(key) }
  clear(): void { this.data.clear() }
}

Object.defineProperty(globalThis, 'localStorage', {
  value: new MemoryStorage(),
  configurable: true,
})

localStorage.setItem('ad.drafts.v1', '{"draft":1}')
localStorage.setItem('dispatch.byok.v1', '{"apiKey":"secret"}')
localStorage.setItem('dispatch.unsplash.v1', '{"key":"unsplash"}')
localStorage.setItem('other.app', 'not-ours')

console.log('本地备份：')

const safe = collectBackup()
ok('ad.drafts.v1' in safe.data, '默认备份包含草稿')
ok(!('dispatch.byok.v1' in safe.data), '默认备份不含 API Key')
ok(!('dispatch.unsplash.v1' in safe.data), '默认备份不含 Unsplash Key')
ok(!('other.app' in safe.data), '不导出其他站点的 key')
ok(countSecrets(safe) === 0, '默认备份的密钥数为 0')

const full = collectBackup({ includeSecrets: true })
ok('dispatch.byok.v1' in full.data, '显式勾选后包含 API Key')
ok(countSecrets(full) === 2, '显式勾选后统计到两个密钥')

ok(backupFileName().includes('不含密钥'), '默认文件名标明不含密钥')
ok(backupFileName({ includeSecrets: true }).includes('含密钥'), '含密钥文件名标明含密钥')

const preview = previewBackup(JSON.stringify(full))
ok(preview.error === null && preview.keys === 3, '预览统计到 3 项')
ok(preview.secrets === 2, '预览统计到 2 个密钥')
ok(previewBackup('not json').error === '这个文件不是 JSON', '非 JSON 备份被拒绝')
ok(previewBackup('{"app":"other"}').error !== null, '别的应用的备份被拒绝')

localStorage.removeItem('ad.drafts.v1')
const restored = restoreBackup(JSON.stringify(full))
ok(restored.error === null && restored.keys === 3, '恢复写入 3 项')
ok(localStorage.getItem('ad.drafts.v1') === '{"draft":1}', '恢复后草稿回到原值')

process.exit(report('本地备份'))
