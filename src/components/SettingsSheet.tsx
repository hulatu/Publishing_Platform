/**
 * 设置面板 —— 自带 Key 是主路径
 *
 * 这个工具没有后端，Key 只写进本机 localStorage，请求从浏览器直接发往
 * 使用者选择的服务商。所以任何人打开这个网页，填自己的 Key 就能用 AI。
 */

import { useEffect, useState } from 'react'
import { isCloudConfigured } from '../cloud/config'
import {
  PROVIDER_PRESETS,
  byokConfigured,
  clearByok,
  emptyByok,
  fetchCloudModels,
  loadByok,
  loadCloudModel,
  pingByok,
  presetById,
  saveByok,
  saveCloudModel,
  type ByokSettings,
  type PingResult,
} from '../ai/provider'

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

  useEffect(() => {
    if (!open) return
    setByok(loadByok())
    setCloudModel(loadCloudModel())
    setPing(null)
    setShowKey(false)
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
    // 写盘可能失败（隐私模式 / 配额满）。失败要说出来，不能假装存好了
    const stored = saveByok(byok)
    saveCloudModel(cloudModel)
    onSaved(
      stored
        ? ready
          ? `已保存，使用 ${byok.model}`
          : '已保存'
        : '浏览器拒绝写入本地存储（隐私模式？），Key 只在本次会话有效',
      stored ? 'success' : 'error',
    )
    onClose()
  }

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">设置 · 接入大模型</span>
          <button className="icon-btn" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="modal-body">
          <div className="notice notice-info">
            <span className="notice-mark">i</span>
            <span>
              这个工具没有服务器。Key 只保存在<b>这台浏览器</b>的 localStorage 里，
              请求从浏览器直接发往你选的服务商，不经过任何中转。
            </span>
          </div>

          {/* ---------- 服务商 ---------- */}
          <div className="side-title" style={{ marginTop: 18, marginBottom: 10 }}>
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

          {preset?.note ? <div className="preset-note">{preset.note}</div> : null}

          {/* ---------- 三项 ---------- */}
          <div className="field" style={{ marginTop: 14 }}>
            <label className="field-label">接口地址</label>
            <input
              className="field-input"
              value={byok.endpoint}
              onChange={(e) => {
                setByok({ ...byok, endpoint: e.target.value, presetId: 'custom' })
                setPing(null)
              }}
              placeholder="https://api.deepseek.com/v1"
              spellCheck={false}
            />
            <div className="field-hint">要以 /v1 结尾（或该服务文档给出的兼容地址）</div>
          </div>

          <div className="field">
            <label className="field-label">
              API Key
              {preset?.consoleUrl ? (
                <a className="link-btn" href={preset.consoleUrl} target="_blank" rel="noreferrer">
                  去申请
                </a>
              ) : null}
            </label>
            <div className="key-row">
              <input
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
              <button className="btn btn-sm" onClick={() => setShowKey((v) => !v)}>
                {showKey ? '隐藏' : '显示'}
              </button>
            </div>
          </div>

          <div className="field">
            <label className="field-label">模型名</label>
            <input
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
            {preset?.models.length ? (
              <div className="field-hint">常用：{preset.models.join(' / ')}</div>
            ) : null}
          </div>

          <label className="check-row">
            <input
              type="checkbox"
              checked={byok.jsonMode}
              onChange={(e) => setByok({ ...byok, jsonMode: e.target.checked })}
            />
            支持 response_format: json_object（输出更稳；不支持就取消勾选）
          </label>

          {/* ---------- 测试 ---------- */}
          <div className="ping-row">
            <button className="btn btn-sm btn-primary" onClick={runPing} disabled={pinging || !ready}>
              {pinging ? '测试中…' : '测试连接'}
            </button>
            {!ready ? <span className="muted" style={{ fontSize: 12 }}>三项都填好才能测</span> : null}
          </div>

          {ping ? (
            <div className={`notice ${ping.ok ? 'notice-info' : 'notice-error'}`}>
              <span className="notice-mark">{ping.ok ? '✓' : '!'}</span>
              <span>{ping.message}</span>
            </div>
          ) : null}

          {/* ---------- 云服务（可选） ---------- */}
          {isCloudConfigured() ? (
            <>
              <div className="side-title" style={{ marginTop: 24, marginBottom: 10 }}>
                <span>WorkBuddy 云服务（免密钥）</span>
              </div>
              {loadingModels ? <div className="muted" style={{ fontSize: 12 }}>正在拉取模型…</div> : null}
              {modelError ? (
                <div className="notice notice-warn">
                  <span className="notice-mark">!</span>
                  <span>{modelError}</span>
                </div>
              ) : null}
              {cloudModels.length > 0 ? (
                <div className="field">
                  <label className="field-label">使用的模型</label>
                  <select className="field-input" value={cloudModel} onChange={(e) => setCloudModel(e.target.value)}>
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

          <div style={{ marginTop: 18 }}>
            <button
              className="btn btn-sm"
              onClick={() => {
                const ok = clearByok()
                setByok({ ...emptyByok })
                setPing(null)
                onSaved(
                  ok ? '已清空自带 Key' : '没能清掉：浏览器拒绝访问本地存储',
                  ok ? 'success' : 'error',
                )
              }}
            >
              清空 Key
            </button>
          </div>
        </div>

        <div className="modal-foot">
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" onClick={save}>
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
