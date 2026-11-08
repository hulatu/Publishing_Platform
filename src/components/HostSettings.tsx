/**
 * 图床配置表单
 *
 * 四种图床的字段完全不同，硬塞进一个表单会让每种情况都显得很复杂。
 * 这里按 kind 切换字段组：选了哪个就只显示哪个的字段，其余的藏起来 ——
 * 「填了一堆用不上的框」比「少一个框」更劝退。
 *
 * 测试按钮传一张 1×1 的 PNG 走完整链路，不是发个 HEAD 就算通：
 * Key 对不对、字段名对不对、返回结构对不对，只有真传一次才知道。
 */

import { useState } from 'react'
import {
  HostError,
  emptyHostConfig,
  hostLabels,
  hostReady,
  missingHint,
  testHost,
  type HostConfig,
  type HostKind,
} from '../core/image-host'

interface Props {
  cfg: HostConfig
  onChange: (cfg: HostConfig) => void
}

const KINDS: HostKind[] = ['imgbb', 'github', 'r2', 'custom']

const BLURB: Record<HostKind, string> = {
  imgbb: '填个免费 API Key 就能用，零部署。图片存在 imgbb 的服务器上，国内访问可能不稳。',
  github: '把图传到你的 GitHub 仓库，走 jsDelivr 加速。免费、可控，国内时快时慢。',
  r2: '跟着这个项目部署：加一个 Pages Function + R2 bucket。免费 10GB，不收出口流量费，可以绑自己的域名。',
  custom: '你自建或现成的图床：填上传地址、口令、文件字段名，再告诉我从响应哪个字段取 URL。',
}

export function HostSettings({ cfg, onChange }: Props) {
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  const set = (patch: Partial<HostConfig>) => {
    onChange({ ...cfg, ...patch })
    setResult(null)
  }

  const run = async () => {
    setTesting(true)
    setResult(null)
    try {
      const url = await testHost(cfg)
      setResult({ ok: true, message: `通了。测试图地址：${url}` })
    } catch (e) {
      const msg = e instanceof HostError ? e.message : e instanceof Error ? e.message : String(e)
      setResult({ ok: false, message: msg })
    } finally {
      setTesting(false)
    }
  }

  const ready = hostReady(cfg)

  return (
    <>
      <div className="preset-row">
        {KINDS.map((k) => (
          <button
            key={k}
            className={`preset-chip ${cfg.kind === k ? 'active' : ''}`}
            onClick={() => set({ kind: k })}
          >
            {hostLabels[k]}
          </button>
        ))}
      </div>

      <div className="preset-note">{BLURB[cfg.kind]}</div>

      {cfg.kind === 'imgbb' ? (
        <>
          <div className="field" style={{ marginTop: 14 }}>
            <label className="field-label">
              API Key
              <a className="link-btn" href="https://api.imgbb.com/" target="_blank" rel="noreferrer">
                去申请
              </a>
            </label>
            <input
              className="field-input"
              value={cfg.imgbbKey}
              onChange={(e) => set({ imgbbKey: e.target.value })}
              placeholder="一串 32 位的十六进制"
              spellCheck={false}
            />
          </div>
        </>
      ) : null}

      {cfg.kind === 'github' ? (
        <>
          <div className="field" style={{ marginTop: 14 }}>
            <label className="field-label">
              Personal access token
              <a
                className="link-btn"
                href="https://github.com/settings/tokens/new?scopes=repo&description=article-dispatch"
                target="_blank"
                rel="noreferrer"
              >
                去申请
              </a>
            </label>
            <input
              className="field-input"
              value={cfg.ghToken}
              onChange={(e) => set({ ghToken: e.target.value })}
              placeholder="ghp_...（要勾 repo 权限）"
              spellCheck={false}
            />
            <div className="field-hint">只需要 repo 这一项权限，别勾别的</div>
          </div>

          <div className="field-row">
            <div className="field">
              <label className="field-label">仓库</label>
              <input
                className="field-input"
                value={cfg.ghRepo}
                onChange={(e) => set({ ghRepo: e.target.value })}
                placeholder="hulatu/blog-images"
                spellCheck={false}
              />
            </div>
            <div className="field">
              <label className="field-label">分支</label>
              <input
                className="field-input"
                value={cfg.ghBranch}
                onChange={(e) => set({ ghBranch: e.target.value })}
                placeholder="main"
                spellCheck={false}
              />
            </div>
          </div>

          <div className="field">
            <label className="field-label">目录</label>
            <input
              className="field-input"
              value={cfg.ghDir}
              onChange={(e) => set({ ghDir: e.target.value })}
              placeholder="images"
              spellCheck={false}
            />
            <div className="field-hint">图片会放在仓库的这个目录下，留空就是根目录</div>
          </div>

          <div className="field">
            <label className="field-label">地址用哪条 CDN</label>
            <select
              className="field-input"
              value={cfg.ghCdn}
              onChange={(e) => set({ ghCdn: e.target.value as HostConfig['ghCdn'] })}
            >
              <option value="jsdelivr">jsDelivr（国内一般更快，有缓存）</option>
              <option value="raw">raw.githubusercontent.com（源站，稳定但慢）</option>
            </select>
          </div>
        </>
      ) : null}

      {cfg.kind === 'r2' ? (
        <>
          <div className="field" style={{ marginTop: 14 }}>
            <label className="field-label">上传地址</label>
            <input
              className="field-input"
              value={cfg.r2Base}
              onChange={(e) => set({ r2Base: e.target.value })}
              placeholder="/api/upload"
              spellCheck={false}
            />
            <div className="field-hint">
              默认走同源 <code>/api/upload</code>，由 functions/api/upload.ts 处理
            </div>
          </div>

          <div className="field">
            <label className="field-label">上传口令</label>
            <input
              className="field-input"
              value={cfg.r2Token}
              onChange={(e) => set({ r2Token: e.target.value })}
              placeholder="和 Cloudflare 环境变量 UPLOAD_TOKEN 一致"
              spellCheck={false}
              autoComplete="off"
            />
            <div className="field-hint">
              不设的话接口等于公开图床，所以服务端强制要求这一项
            </div>
          </div>

          <div className="field-hint" style={{ marginTop: 4 }}>
            部署要做的三件事：① 建 R2 bucket ② Pages 项目里加名为 <code>IMAGES</code> 的绑定
            ③ 环境变量加 <code>UPLOAD_TOKEN</code>（和上面一致）。想用自己域名再加
            <code>UPLOAD_PUBLIC_BASE</code>，不配的话图片地址会走 <code>/api/upload?key=</code>。
          </div>
        </>
      ) : null}

      {cfg.kind === 'custom' ? (
        <>
          <div className="field" style={{ marginTop: 14 }}>
            <label className="field-label">上传接口</label>
            <input
              className="field-input"
              value={cfg.customUrl}
              onChange={(e) => set({ customUrl: e.target.value })}
              placeholder="https://img.example.com/api/upload"
              spellCheck={false}
            />
            <div className="field-hint">用 POST + multipart/form-data 发过去</div>
          </div>

          <div className="field">
            <label className="field-label">口令（可选）</label>
            <input
              className="field-input"
              value={cfg.customToken}
              onChange={(e) => set({ customToken: e.target.value })}
              placeholder="会作为 Authorization: Bearer ... 发出"
              spellCheck={false}
              autoComplete="off"
            />
          </div>

          <div className="field-row">
            <div className="field">
              <label className="field-label">文件字段名</label>
              <input
                className="field-input"
                value={cfg.customField}
                onChange={(e) => set({ customField: e.target.value })}
                placeholder="file"
                spellCheck={false}
              />
            </div>
            <div className="field">
              <label className="field-label">响应里 URL 的路径</label>
              <input
                className="field-input"
                value={cfg.customJsonPath}
                onChange={(e) => set({ customJsonPath: e.target.value })}
                placeholder="data.url"
                spellCheck={false}
              />
            </div>
          </div>

          <div className="field-hint">
            支持点路径，比如 <code>data.url</code> 或 <code>result.url</code>。暂不支持数组下标。
          </div>
        </>
      ) : null}

      <div className="ping-row">
        <button className="btn btn-sm btn-primary" onClick={() => void run()} disabled={testing || !ready}>
          {testing ? '上传测试图…' : '测试上传'}
        </button>
        {!ready ? <span className="muted" style={{ fontSize: 12 }}>{missingHint(cfg)}</span> : null}
      </div>

      {result ? (
        <div className={`notice ${result.ok ? 'notice-info' : 'notice-error'}`}>
          <span className="notice-mark">{result.ok ? '✓' : '!'}</span>
          <span style={{ wordBreak: 'break-all' }}>{result.message}</span>
        </div>
      ) : null}
    </>
  )
}

/** 设置面板「清空」时用得上 */
export function blankHostConfig(): HostConfig {
  return { ...emptyHostConfig }
}
