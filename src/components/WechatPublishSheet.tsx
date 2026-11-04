/**
 * 直发公众号草稿箱
 *
 * 这个弹层有一个很不寻常的设计前提：**它默认是不可用的**。
 *
 * 公众号没有能从浏览器直接调的接口（AppSecret 会暴露、IP 不在白名单、还有跨域），
 * 所以必须先自己部署一个中转服务。与其做一个「点了就报错」的按钮，
 * 不如把这个前提摊开讲清楚，让用户知道要做什么、以及为什么。
 *
 * 三种状态：
 * - 未配置：讲清楚为什么必须有中转，给出配置入口
 * - 已配置：发前自检（正文 20000 字符 / 1MB、标题 64 字、封面必填），列出问题
 * - 已发送：给出 media_id 与草稿箱链接
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  WECHAT_LIMITS,
  blockedBy,
  normalizeRelayUrl,
  pingRelay,
  preflight,
  readRelayConfig,
  relayConfigured,
  sendDraft,
  writeRelayConfig,
  type DraftOutcome,
  type RelayConfig,
} from '../cloud/wechat-relay'

interface Props {
  open: boolean
  onClose: () => void
  title: string
  digest: string
  /** 已经渲染好的全内联 HTML（含文末组件） */
  content: string
  author: string
  /** 正文里的图片，可一键拿第一张当封面 */
  images: string[]
  onSent: (mediaId: string) => void
  onToast: (msg: string, kind?: 'success' | 'error' | 'info') => void
}

type Phase = 'idle' | 'sending' | 'ok' | 'error'

export function WechatPublishSheet({
  open,
  onClose,
  title,
  digest,
  content,
  author,
  images,
  onSent,
  onToast,
}: Props) {
  const [cfg, setCfg] = useState<RelayConfig>(readRelayConfig)
  const [coverUrl, setCoverUrl] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [outcome, setOutcome] = useState<DraftOutcome | null>(null)
  const [pinging, setPinging] = useState(false)
  const [ping, setPing] = useState<string>('')

  // 每次打开重置发送态 —— 上次的错误留着只会误导
  useEffect(() => {
    if (open) {
      setPhase('idle')
      setOutcome(null)
      setPing('')
    }
  }, [open])

  const configured = relayConfigured(cfg)

  const changeCfg = useCallback((patch: Partial<RelayConfig>) => {
    setCfg((prev) => {
      const next = { ...prev, ...patch }
      writeRelayConfig(next)
      return next
    })
  }, [])

  const payload = useMemo(
    () => ({
      title: title.trim(),
      author: author.trim() || undefined,
      digest: digest.trim() || undefined,
      content,
      coverUrl: coverUrl.trim() || undefined,
    }),
    [title, author, digest, content, coverUrl],
  )

  const issues = useMemo(() => preflight(payload, cfg), [payload, cfg])
  const blocked = blockedBy(issues)
  const chars = [...content].length

  if (!open) return null

  const doPing = async () => {
    setPinging(true)
    setPing('')
    const r = await pingRelay(cfg)
    setPinging(false)
    if (r.ok) {
      setPing(
        `连接正常${r.appIdMasked ? ` · AppID ${r.appIdMasked}` : ''}${r.hasDefaultCover ? ' · 已配默认封面' : ' · 未配默认封面'}`,
      )
    } else {
      setPing(`${r.title}：${r.hint}`)
    }
  }

  const doSend = async () => {
    if (blocked) return
    setPhase('sending')
    setOutcome(null)
    const r = await sendDraft(cfg, payload)
    setOutcome(r)
    if (r.ok) {
      setPhase('ok')
      onSent(r.mediaId)
      onToast('已发到公众号草稿箱', 'success')
    } else {
      setPhase('error')
      onToast(r.title, 'error')
    }
  }

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal wpub-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="modal-title">直发公众号草稿箱</div>
            <div className="ledger-sub">
              通过你自己的中转服务调微信接口 · 只建草稿，不会直接群发
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        <div className="modal-body wpub-body">
          {/* ---------- 为什么要中转 ---------- */}
          <div className={`wpub-why ${configured ? 'compact' : ''}`}>
            <div className="wpub-why-title">为什么必须有中转服务</div>
            <ul className="wpub-why-list">
              <li>
                <b>AppSecret 不能进前端</b> —— 打包后的 JS 谁都能读，泄露等于把公众号交出去
              </li>
              <li>
                <b>access_token 要缓存统一刷新</b> —— 2 小时过期，多端各自刷新会互相顶掉
              </li>
              <li>
                <b>IP 白名单</b> —— 微信要求调用方 IP 固定，浏览器没有固定出口 IP
              </li>
              <li>
                <b>跨域</b> —— api.weixin.qq.com 不返回 CORS 头，浏览器读不到响应
              </li>
            </ul>
            {configured ? null : (
              <div className="wpub-why-foot">
                仓库里的 <code>docs/wechat-draft-relay.md</code> 有完整契约，<code>relay/wechat-relay.mjs</code>
                是一份零依赖的参考实现（Node 18+，单文件）。注意中转机必须有固定出口 IP ——
                Cloudflare Worker 的出口 IP 不固定，通常过不了微信白名单。部署完把地址和口令填在下面。
              </div>
            )}
          </div>

          {/* ---------- 中转服务配置 ---------- */}
          <div className="wpub-cfg">
            <div className="field">
              <label className="field-label">中转服务地址</label>
              <input
                className="field-input"
                value={cfg.url}
                onChange={(e) => changeCfg({ url: e.target.value })}
                placeholder="https://wechat-relay.你的账号.workers.dev"
                spellCheck={false}
              />
            </div>
            <div className="field">
              <label className="field-label">访问口令</label>
              <input
                className="field-input"
                type="password"
                value={cfg.token}
                onChange={(e) => changeCfg({ token: e.target.value })}
                placeholder="部署时设置的 RELAY_TOKEN"
                spellCheck={false}
              />
            </div>
            <div className="wpub-cfg-actions">
              <button className="btn btn-sm" onClick={doPing} disabled={!configured || pinging}>
                {pinging ? <span className="spinner dark" /> : null}
                测试连接
              </button>
              {ping ? (
                <span className={`wpub-ping ${ping.startsWith('连接正常') ? 'ok' : 'bad'}`}>{ping}</span>
              ) : null}
            </div>
          </div>

          {/* ---------- 发送内容 ---------- */}
          <div className="wpub-target">
            <div className="wpub-target-row">
              <span className="wpub-label">标题</span>
              <span className="wpub-value">{title || '（空）'}</span>
              <span className={`wpub-num ${[...title].length > WECHAT_LIMITS.titleMax ? 'bad' : ''}`}>
                {[...title].length}/{WECHAT_LIMITS.titleMax}
              </span>
            </div>
            <div className="wpub-target-row">
              <span className="wpub-label">正文</span>
              <span className="wpub-value muted">
                {chars.toLocaleString()} 字符 · 含文末组件
              </span>
              <span className={`wpub-num ${chars > WECHAT_LIMITS.contentMax ? 'bad' : ''}`}>
                {chars > WECHAT_LIMITS.contentMax ? `超 ${chars - WECHAT_LIMITS.contentMax}` : '在限内'}
              </span>
            </div>
            <div className="wpub-target-row">
              <span className="wpub-label">封面</span>
              <input
                className="field-input wpub-cover"
                value={coverUrl}
                onChange={(e) => setCoverUrl(e.target.value)}
                placeholder="封面图地址（微信新建草稿必填，中转服务可配默认封面）"
                spellCheck={false}
              />
              {images.length > 0 ? (
                <button className="btn btn-sm" onClick={() => setCoverUrl(images[0])} title={images[0]}>
                  用正文首图
                </button>
              ) : null}
            </div>
          </div>

          {/* ---------- 自检 ---------- */}
          {issues.length > 0 ? (
            <div className="wpub-issues">
              {issues.map((it, i) => (
                <div className={`wpub-issue ${it.level}`} key={i}>
                  <span className="wpub-issue-dot" aria-hidden>
                    {it.level === 'block' ? '✕' : '!'}
                  </span>
                  {it.text}
                </div>
              ))}
            </div>
          ) : (
            <div className="wpub-issues">
              <div className="wpub-issue ok">
                <span className="wpub-issue-dot" aria-hidden>
                  ✓
                </span>
                自检通过：标题、正文长度、封面都齐了
              </div>
            </div>
          )}

          {/* ---------- 结果 ---------- */}
          {phase === 'ok' && outcome?.ok ? (
            <div className="wpub-result ok">
              <div className="wpub-result-title">已创建草稿</div>
              <div className="wpub-result-body">
                media_id：<code>{outcome.mediaId}</code>
              </div>
              <div className="wpub-result-body muted">
                去公众号后台「草稿箱」就能看到它，预览、改封面、群发都在那边做。
              </div>
              {outcome.url ? (
                <a className="wpub-result-link" href={outcome.url} target="_blank" rel="noreferrer">
                  打开草稿箱编辑页 →
                </a>
              ) : null}
            </div>
          ) : null}

          {phase === 'error' && outcome && !outcome.ok ? (
            <div className="wpub-result bad">
              <div className="wpub-result-title">{outcome.title}</div>
              <div className="wpub-result-body">{outcome.hint}</div>
              {outcome.detail ? (
                <details className="details details-inline">
                  <summary>原始信息</summary>
                  <div className="details-body">
                    <code>{outcome.detail}</code>
                  </div>
                </details>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="modal-foot">
          <span className="muted" style={{ fontSize: 11 }}>
            {configured ? normalizeRelayUrl(cfg.url) : '未配置中转服务，暂时不能直发'}
          </span>
          <div className="row">
            <button className="btn btn-sm" onClick={onClose}>
              关闭
            </button>
            <button
              className="btn btn-primary btn-sm"
              onClick={doSend}
              disabled={!configured || blocked || phase === 'sending'}
              title={
                !configured
                  ? '先配置中转服务'
                  : blocked
                    ? '自检有阻塞项，先处理上面标红的问题'
                    : '只建草稿，不会群发'
              }
            >
              {phase === 'sending' ? <span className="spinner" /> : null}
              {phase === 'sending' ? '发送中…' : phase === 'ok' ? '再发一次' : '发到草稿箱'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
