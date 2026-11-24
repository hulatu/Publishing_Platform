/**
 * 设置面板 —— 自带 Key 是主路径
 *
 * 这个工具没有后端，Key 只写进本机 localStorage，请求从浏览器直接发往
 * 使用者选择的服务商。所以任何人打开这个网页，填自己的 Key 就能用 AI。
 */

import { useEffect, useRef, useState } from 'react'
import { isCloudConfigured } from '../cloud/config'
import {
  PROVIDER_PRESETS,
  byokConfigured,
  clearByok,
  emptyByok,
  fetchCloudModels,
  loadByok,
  loadCloudModel,
  loadRememberKey,
  pingByok,
  presetById,
  saveByok,
  saveCloudModel,
  saveRememberKey,
  type ByokSettings,
  type PingResult,
} from '../ai/provider'
import { backupFileName, backupText, collectBackup, describeBackup, restoreBackup } from '../core/backup'
import { downloadText } from '../core/copy'
import { loadUnsplashKey, saveUnsplashKey } from '../core/unsplash'
import { Modal } from './Modal'

interface Props {
  open: boolean
  onClose: () => void
  onSaved: (message: string, kind?: 'success' | 'error') => void
}

export function SettingsSheet({ open, onClose, onSaved }: Props) {
  const [byok, setByok] = useState<ByokSettings>(emptyByok)
  const [cloudModels, setCloudModels] = useState<{ id: string; name: string }[]>([])
  const [cloudModel, setCloudModel] = useState('')
  const [loadingModels, setLoadingModels] = useState(false)
  const [modelError, setModelError] = useState('')
  const [pinging, setPinging] = useState(false)
  const [ping, setPing] = useState<PingResult | null>(null)
  const [showKey, setShowKey] = useState(false)
  /** 关掉时不写 localStorage，只写 sessionStorage：公用电脑上更稳妥 */
  const [rememberKey, setRememberKey] = useState(true)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  /** Unsplash 的 Access Key：和 AI Key 一样只存本机，但两者用途不同，各存各的 */
  const [unsplashKey, setUnsplashKey] = useState('')
  const [showUnsplash, setShowUnsplash] = useState(false)
  /** 清空 Key 不可撤销，和草稿箱/台账一样要点两次才真的清 */
  const [confirmClearKey, setConfirmClearKey] = useState(false)
  /** 本地数据：打开面板时算一次，别每次渲染都去遍历 localStorage */
  const [dataSummary, setDataSummary] = useState('')
  /** 导出 / 导入的结果提示。成功和失败都要说出来，尤其「有几项没写进去」 */
  const [dataNote, setDataNote] = useState<{ text: string; kind: 'ok' | 'err' } | null>(null)
  const importRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    const stored = loadByok()
    setByok(stored)
    setAdvancedOpen(stored.presetId === 'custom')
    setCloudModel(loadCloudModel())
    setUnsplashKey(loadUnsplashKey())
    setPing(null)
    setShowKey(false)
    setShowUnsplash(false)
    setRememberKey(loadRememberKey())
    setDataNote(null)
    setConfirmClearKey(false)
    setDataSummary(describeBackup(collectBackup()))
  }, [open])

  useEffect(() => {
    if (!open || !isCloudConfigured()) return
    setLoadingModels(true)
    setModelError('')
    fetchCloudModels()
      .then((list) => {
        setCloudModels(list)
        if (list.length === 0) {
          setModelError('云服务没有返回可用模型。当前域名可能未发布，或云服务未开通。')
        }
      })
      .catch((e) => setModelError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoadingModels(false))
  }, [open])

  if (!open) return null

  const preset = presetById(byok.presetId)
  const ready = byokConfigured(byok)
  const endpointId = 'settings-endpoint'
  const apiKeyId = 'settings-api-key'
  const modelId = 'settings-model'
  const unsplashKeyId = 'settings-unsplash-key'
  const cloudModelId = 'settings-cloud-model'

  const applyPreset = (id: string) => {
    const p = presetById(id)
    if (!p) return
    setByok((prev) => ({
      ...prev,
      presetId: id,
      endpoint: p.endpoint || prev.endpoint,
      model: p.model || prev.model,
      jsonMode: p.jsonMode,
    }))
    setAdvancedOpen(id === 'custom')
    setPing(null)
  }

  const runPing = async () => {
    setPinging(true)
    setPing(null)
    try {
      const r = await pingByok(byok)
      setPing(r)
    } finally {
      setPinging(false)
    }
  }

  const save = () => {
    // 先落偏好再落 Key：saveByok 要根据「记不记住」决定写哪个 storage
    saveRememberKey(rememberKey)
    // 写盘可能失败（隐私模式 / 配额满）。失败要说出来，不能假装存好了
    const stored = saveByok(byok)
    saveCloudModel(cloudModel)
    // Unsplash Key 单独存：没填就是清空，不该影响 AI Key 的保存结果
    const unsplashStored = saveUnsplashKey(unsplashKey)
    onSaved(
      stored && unsplashStored
        ? ready
          ? `已保存，使用 ${byok.model}`
          : '已保存'
        : '浏览器拒绝写入本地存储（隐私模式？），Key 只在本次会话有效',
      stored && unsplashStored ? 'success' : 'error',
    )
    onClose()
  }

  const exportLocal = () => {
    const snapshot = collectBackup()
    downloadText(backupText(), backupFileName(), 'application/json')
    setDataNote({ text: `已导出 ${describeBackup(snapshot)}。文件里含 API Key，别分享出去。`, kind: 'ok' })
  }

  const importLocal = async (file: File) => {
    // 读不出来（文件被占用、不是文本）也要给一句话，而不是静默什么都不发生
    const text = await file.text().catch(() => '')
    const result = restoreBackup(text)
    if (result.error) {
      setDataNote({ text: result.error, kind: 'err' })
      return
    }
    if (result.keys === 0) {
      setDataNote({ text: '这个备份里没有可恢复的项', kind: 'err' })
      return
    }
    const failed = result.failed ? `，另有 ${result.failed} 项没写进去（浏览器存储已满）` : ''
    setDataNote({
      text: `已恢复 ${result.keys} 项${failed}。刷新页面后生效。`,
      kind: result.failed ? 'err' : 'ok',
    })
    setDataSummary(describeBackup(collectBackup()))
  }

  return (
    <Modal open={open} onClose={onClose} label="设置">
        <div className="modal-head">
          {/* 标题只写「设置」：这个弹窗不只管大模型，下面还有 Unsplash 封面图 Key。
              写「接入大模型」会让人以为它只管 Key，找封面设置时想不到来这里 */}
          <span className="modal-title">设置</span>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        <div className="modal-body">
          <p className="settings-privacy">Key 只保存在这台浏览器，不经过本工具的服务器。</p>

          {/* ---------- 服务商 ---------- */}
          <div className="side-title settings-block">
            <span>选择服务商</span>
            <span className="count">{ready ? '已配置' : '未配置'}</span>
          </div>

          <div className="preset-row">
            {PROVIDER_PRESETS.map((p) => (
              <button
                key={p.id}
                className={`preset-chip ${byok.presetId === p.id ? 'active' : ''}`}
                onClick={() => applyPreset(p.id)}
              >
                {p.name}
              </button>
            ))}
          </div>

          <div className="field mt-4">
            <label className="field-label" htmlFor={apiKeyId}>
              API Key
              {preset?.consoleUrl ? (
                <a className="link-btn" href={preset.consoleUrl} target="_blank" rel="noreferrer">
                  去申请
                </a>
              ) : null}
            </label>
            {/* 用 form 包住密码框：否则 Chrome 每打开一次都提示
                「Password field is not contained in a form」，密码管理器也无从判断这是哪一项 */}
            <form className="key-row" onSubmit={(e) => e.preventDefault()}>
              <input
                id={apiKeyId}
                className="field-input"
                type={showKey ? 'text' : 'password'}
                value={byok.apiKey}
                onChange={(e) => {
                  setByok({ ...byok, apiKey: e.target.value })
                  setPing(null)
                }}
                placeholder="sk-..."
                spellCheck={false}
                autoComplete="off"
              />
              <button type="button" className="btn btn-sm" onClick={() => setShowKey((v) => !v)}>
                {showKey ? '隐藏' : '显示'}
              </button>
            </form>
            <label className="check-row mt-2">
              <input
                type="checkbox"
                checked={rememberKey}
                onChange={(e) => setRememberKey(e.target.checked)}
              />
              <span>在这台设备上记住 Key</span>
            </label>
            <div className="field-hint">
              {rememberKey
                ? '关掉浏览器再打开也不用重填。公用电脑上建议取消勾选。'
                : '只存在本次会话：关掉这个标签页就要重新填。'}
            </div>
          </div>

          {/* ---------- 测试 ---------- */}
          <div className="ping-row">
            <button className="btn btn-sm btn-primary" onClick={runPing} disabled={pinging || !ready}>
              {pinging ? '测试中…' : '测试连接'}
            </button>
          </div>

          {ping ? (
            <div className={`notice ${ping.ok ? 'notice-info' : 'notice-error'}`}>
              <span className="notice-mark">{ping.ok ? '✓' : '!'}</span>
              <span>{ping.message}</span>
            </div>
          ) : null}

          <details
            className="settings-advanced"
            open={advancedOpen}
            onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
          >
            <summary>
              <span>高级设置</span>
              <span>接口地址 / 模型名 / JSON 模式</span>
            </summary>
            <div className="settings-advanced-body">
              <div className="field">
                <label className="field-label" htmlFor={endpointId}>
                  接口地址
                </label>
                <input
                  id={endpointId}
                  className="field-input"
                  value={byok.endpoint}
                  onChange={(e) => {
                    setByok({ ...byok, endpoint: e.target.value, presetId: 'custom' })
                    setPing(null)
                  }}
                  placeholder="https://api.deepseek.com/v1"
                  spellCheck={false}
                />
                <div className="field-hint">要以 /v1 结尾（或服务文档给出的兼容地址）</div>
              </div>

              <div className="field">
                <label className="field-label" htmlFor={modelId}>
                  模型名
                </label>
                <input
                  id={modelId}
                  className="field-input"
                  value={byok.model}
                  onChange={(e) => {
                    setByok({ ...byok, model: e.target.value })
                    setPing(null)
                  }}
                  placeholder="deepseek-chat"
                  spellCheck={false}
                  list="model-suggestions"
                />
                <datalist id="model-suggestions">
                  {preset?.models.map((m) => <option key={m} value={m} />)}
                </datalist>
              </div>

              <label className="check-row">
                <input
                  type="checkbox"
                  checked={byok.jsonMode}
                  onChange={(e) => setByok({ ...byok, jsonMode: e.target.checked })}
                />
                支持 response_format: json_object
              </label>
            </div>
          </details>

          {/* ---------- 云服务（可选） ---------- */}
          {isCloudConfigured() ? (
            <>
              <div className="side-title settings-block">
                <span>WorkBuddy 云服务（免密钥）</span>
              </div>
              {loadingModels ? <div className="muted field-hint">正在拉取模型…</div> : null}
              {modelError ? (
                <div className="notice notice-warn">
                  <span className="notice-mark">!</span>
                  <span>{modelError}</span>
                </div>
              ) : null}
              {cloudModels.length > 0 ? (
                <div className="field">
                  <label className="field-label" htmlFor={cloudModelId}>
                    使用的模型
                  </label>
                  <select
                    id={cloudModelId}
                    className="field-input"
                    value={cloudModel}
                    onChange={(e) => setCloudModel(e.target.value)}
                  >
                    <option value="">不使用云服务</option>
                    {cloudModels.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                  <div className="field-hint">自带 Key 优先；没填 Key 时才会用云服务</div>
                </div>
              ) : null}
            </>
          ) : null}

          {/* ---------- Unsplash（可选） ---------- */}
          <details className="settings-unsplash">
            <summary>
              <span>Unsplash 封面图</span>
              <span className="count">{unsplashKey.trim() ? '已配置' : '未配置'}</span>
            </summary>
            <div className="settings-unsplash-body">
              <div className="field-hint mb-2">
                按文章搜索封面图。免费申请后复制 <b>Access Key</b>（不是 Secret Key）。
              </div>
              <label className="field-label" htmlFor={unsplashKeyId}>
                Access Key
              </label>
              <form className="key-row" onSubmit={(e) => e.preventDefault()}>
                <input
                  id={unsplashKeyId}
                  className="field-input"
                  type={showUnsplash ? 'text' : 'password'}
                  value={unsplashKey}
                  onChange={(e) => setUnsplashKey(e.target.value)}
                  placeholder="Access Key"
                  spellCheck={false}
                  autoComplete="off"
                />
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setShowUnsplash((v) => !v)}
                >
                  {showUnsplash ? '隐藏' : '显示'}
                </button>
              </form>
            </div>
          </details>

          {/* ---------- 本地数据（备份 / 恢复） ----------
              这个工具没有后端，草稿和台账丢了就是丢了，所以必须有个出口。 */}
          <details className="settings-data">
            <summary>
              <span>本地数据</span>
              <span>{dataSummary}</span>
            </summary>
            <div className="settings-data-body">
              <div className="field-hint mb-3">
                草稿、发布台账、文末模板、Key 都只存在这台浏览器里。换电脑、清缓存之前先导出一份。
              </div>
              <div className="settings-data-actions">
                <button className="btn btn-sm" onClick={exportLocal} disabled={!dataSummary}>
                  导出备份
                </button>
                <button className="btn btn-sm" onClick={() => importRef.current?.click()}>
                  从备份恢复
                </button>
                <input
                  ref={importRef}
                  type="file"
                  accept=".json,application/json"
                  hidden
                  aria-label="选择备份文件"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    // 清空 value：同一个文件连选两次也要能触发 change
                    e.target.value = ''
                    if (file) void importLocal(file)
                  }}
                />
              </div>
              {dataNote ? (
                <div className={`notice ${dataNote.kind === 'err' ? 'notice-warn' : 'notice-info'} mt-3`}>
                  <span className="notice-mark" aria-hidden>
                    {dataNote.kind === 'err' ? '!' : '·'}
                  </span>
                  <span>{dataNote.text}</span>
                </div>
              ) : null}
            </div>
          </details>

          {/* 这里不提供图床设置：图片归作者自己的图床管，这个工具只读 md 里的链接 */}
          <div className="settings-block">
            <button
              className={`btn btn-sm ${confirmClearKey ? 'btn-danger' : ''}`}
              onClick={() => {
                // 和草稿箱 / 台账同一套「再点一次」确认：清掉就得重新申请 Key
                if (!confirmClearKey) {
                  setConfirmClearKey(true)
                  return
                }
                const ok = clearByok()
                setByok({ ...emptyByok })
                setPing(null)
                setConfirmClearKey(false)
                onSaved(
                  ok ? '已清空自带 Key' : '没能清掉：浏览器拒绝访问本地存储',
                  ok ? 'success' : 'error',
                )
              }}
              onBlur={() => setConfirmClearKey(false)}
            >
              {confirmClearKey ? '再点一次，清空 Key' : '清空 Key'}
            </button>
          </div>
        </div>

        <div className="modal-foot">
          <button className="btn btn-primary" onClick={save}>
            保存
          </button>
        </div>
    </Modal>
  )
}
