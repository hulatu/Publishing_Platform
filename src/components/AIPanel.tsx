/**
 * 改写面板
 *
 * 结构固定为两段：
 *   ① 逐节摘要（可逐条修改，是所有平台文案的共同原料）
 *   ② 当前平台的成品
 *
 * 平台切换时 ① 保持不变、② 换内容 —— 这是把「摘要」和「组装」拆开的直接收益。
 */

import { charCount, weightedLength } from '../core/cjk'
import type { ArticleSection } from '../core/sections'
import { LIMITS, toneLabels, type AIState, type DigestState, type RewriteId, type RewriteTone } from '../ai/types'
import { SectionDigestView } from './SectionDigestView'
import { useElapsed } from './useElapsed'
import { formatElapsed } from '../core/time'

interface Props {
  platform: RewriteId
  ai: AIState
  digest: DigestState
  sections: ArticleSection[]
  tone: RewriteTone
  providerReady: boolean
  providerLabel: string
  onToneChange: (tone: RewriteTone) => void
  onGenerateDigest: () => void
  onCancel: () => void
  onCopy: (text: string, label: string) => void
  onEditSummary: (index: number, summary: string) => void
  onEditOneLiner: (oneLiner: string) => void
  onOpenSettings: () => void
}

const TONES: RewriteTone[] = ['original', 'light', 'native']

function LenBadge({ value, limit, unit }: { value: number; limit: number; unit: string }) {
  return (
    <span className={`thread-len ${value > limit ? 'over' : ''}`}>
      {value} / {limit} {unit}
    </span>
  )
}

const PLATFORM_NAME: Record<RewriteId, string> = {
  xiaohongshu: '小红书',
  twitter: '推特',
  jike: '即刻',
  weibo: '微博',
}

/**
 * 空态示例：没 Key、没生成时，先让用户看到「生成后会长这样」。
 * 文案是示例（借跑步长文的题材写了一句），不是真的生成结果。
 */
const PLATFORM_SAMPLES: Record<RewriteId, string> = {
  xiaohongshu: '跑了 3000 公里，我总结了 5 条新手最容易踩的坑，第一个就是别一上来堆跑量。',
  twitter: '跑了 3000 公里后的一点体会：最难的不是配速，是出门。1/',
  jike: '跑了 3000 公里之后，我发现跑步最难的不是配速，是出门。',
  weibo: '跑了 3000 公里，我发现最难的不是配速，是出门。#跑步 #胡拉图说',
}

export function AIPanel({
  platform,
  ai,
  digest,
  sections,
  tone,
  providerReady,
  providerLabel,
  onToneChange,
  onGenerateDigest,
  onCancel,
  onCopy,
  onEditSummary,
  onEditOneLiner,
  onOpenSettings,
}: Props) {
  const result = ai.result
  const running = ai.status === 'running'
  const digestReady = Boolean(digest.digest)
  const elapsed = useElapsed(running)

  return (
    <div className="ai-panel">
      {/* ---------- 未接入模型：全局面板一条提示，不要在下面重复 ---------- */}
      {!providerReady ? (
        <div className="connect-banner">
          <div className="connect-banner-text">
            <div className="connect-banner-title">还没有接入大模型</div>
            <div className="connect-banner-sub">
              填入自己的 API Key 即可获得 AI 加持。Key 只存在这台浏览器里，请求直接发往你选的服务商，
              不经过任何中转。没有 Key 时可以用本地抽取，结构一样，但措辞会生硬。
            </div>
          </div>
          <button className="btn btn-sm btn-primary" onClick={onOpenSettings}>
            填入 API Key
          </button>
        </div>
      ) : null}

      {/* ---------- 顶部：强度 + 当前模型 ---------- */}
      <div className="ai-toolbar">
        <div className="ai-toolbar-left">
          <span className="ai-toolbar-label">改写强度</span>
          <span className="segmented">
            {TONES.map((t) => (
              <button key={t} className={tone === t ? 'active' : ''} onClick={() => onToneChange(t)}>
                {toneLabels[t]}
              </button>
            ))}
          </span>
        </div>
        <span className="ai-toolbar-model">
          {providerReady ? providerLabel || '已配置模型' : '未配置模型'}
        </span>
      </div>

      {/* ---------- 第一段：逐节摘要 ---------- */}
      <SectionDigestView
        sections={sections}
        digest={digest}
        providerReady={providerReady}
        onEditSummary={onEditSummary}
        onEditOneLiner={onEditOneLiner}
        onRegenerate={onGenerateDigest}
        onCancel={onCancel}
      />

      {/* ---------- 第二段：平台文案 ---------- */}
      {/* 这里原本有个 ② 角标，但上面那段「逐节摘要」并没有 ① —— 一个从 2 开始的编号，
          看着像掉了东西。两段的头部本来就长得不一样（上一段是可折叠的条，这一段是纯标题），
          与其补一个 ① 再为它俩对齐 12px 内边距打架，不如把编号去掉。 */}
      <div className="ai-stage">
        <div className="ai-stage-head">
          <span className="ai-stage-title">{PLATFORM_NAME[platform]}文案</span>
          {running ? (
            <span className="ai-stage-status">
              <span className="spinner dark" />
              {ai.streaming ? `已生成 ${ai.streaming.length} 字符` : '生成中…'}
              <span className="ai-elapsed">{formatElapsed(elapsed)}</span>
            </span>
          ) : result ? (
            <span className="ai-stage-status done">{ai.fallback ? '本地组装' : 'AI 生成'}</span>
          ) : null}
          {running ? (
            <button className="btn btn-sm" onClick={onCancel}>
              停止
            </button>
          ) : null}
        </div>

        {/* 生成中但还没有结果 */}
        {running && !result ? (
          <div className="ai-stream mono">{ai.streaming.slice(-1200) || '正在读摘要…'}</div>
        ) : null}

        {/* 还没有生成：不再放第二个主按钮，主按钮统一在底部操作条 */}
        {!running && !result ? (
          <div className="stage-empty">
            <div className="stage-empty-title">还没有{PLATFORM_NAME[platform]}文案</div>
            <div className="stage-empty-hint">
              {digestReady
                ? `会用上面 ${digest.digest?.sections.length ?? 0} 条摘要组装，一条对应一个要点。`
                : '会先按 ## 切节做摘要，再从摘要组装成平台文案。'}
            </div>
            <div className="stage-sample">
              <div className="stage-sample-label">示例 · 生成后会长这样</div>
              <div className="stage-sample-text">{PLATFORM_SAMPLES[platform]}</div>
            </div>
            <div className="stage-empty-arrow" aria-hidden>
              ↓ 用底部的「生成{PLATFORM_NAME[platform]}文案」
            </div>
          </div>
        ) : null}

        {/* 完成 */}
        {result ? (
          <>
            {ai.error ? (
              <div className="notice notice-warn">
                <span className="notice-mark">!</span>
                <span>{ai.error}</span>
              </div>
            ) : null}
            {ai.fallback ? (
              <div className="notice notice-warn">
                <span className="notice-mark">!</span>
                <span>
                  这是本地组装的版本（摘要直接拼成要点，没有经过语言模型）。结构是对的，措辞会偏生硬。
                  {providerReady ? '点「重新生成」再试一次。' : '配置模型后会好很多。'}
                </span>
              </div>
            ) : null}
            {ai.retries > 0 && !ai.error ? (
              <div className="notice notice-info">
                <span className="notice-mark">i</span>
                <span>模型前 {ai.retries} 次输出未通过校验，已自动重试</span>
              </div>
            ) : null}

            {platform === 'xiaohongshu' && result.xhs ? (
              <div className="ai-result">
                <div className="ai-result-head">
                  <span className="ai-result-title">标题</span>
                  <LenBadge value={charCount(result.xhs.title)} limit={LIMITS.xhsTitle} unit="字" />
                </div>
                <div className="ai-result-body" style={{ fontSize: 15, fontWeight: 600 }}>
                  {result.xhs.title}
                </div>

                <div className="ai-result-head">
                  <span className="ai-result-title">正文</span>
                  <LenBadge value={charCount(result.xhs.body)} limit={LIMITS.xhsBody} unit="字" />
                </div>
                <div className="ai-result-body" style={{ whiteSpace: 'pre-wrap' }}>
                  {result.xhs.body}
                </div>

                <div className="ai-result-head">
                  <span className="ai-result-title">话题</span>
                  <span className="thread-len">{result.xhs.tags.length} 个</span>
                </div>
                <div className="ai-result-body" style={{ color: 'var(--accent)' }}>
                  {result.xhs.tags.map((t) => `#${t}`).join('  ')}
                </div>

                <div className="ai-result-foot">
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={() =>
                      onCopy(
                        `${result.xhs!.title}\n\n${result.xhs!.body}\n\n${result.xhs!.tags.map((t) => `#${t}`).join(' ')}`,
                        '小红书全文',
                      )
                    }
                  >
                    复制标题 + 正文 + 话题
                  </button>
                  <button className="btn btn-sm" onClick={() => onCopy(result.xhs!.body, '小红书正文')}>
                    只复制正文
                  </button>
                </div>
              </div>
            ) : null}

            {platform === 'twitter' && result.twitter ? (
              <div className="ai-result">
                <div className="ai-result-head">
                  <span className="ai-result-title">Thread</span>
                  <span className="thread-len">{result.twitter.thread.length} 条</span>
                </div>
                {result.twitter.thread.map((t, i) => (
                  <div key={i} className="thread-item">
                    <div className="thread-head">
                      <span className="thread-no">
                        {i + 1}/{result.twitter!.thread.length}
                      </span>
                      <LenBadge value={weightedLength(t)} limit={LIMITS.twitterWeighted} unit="加权" />
                    </div>
                    <div style={{ fontSize: 13.5, lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>{t}</div>
                    <div style={{ marginTop: 8 }}>
                      <button
                        className="btn btn-sm"
                        onClick={() => onCopy(`${i + 1}/${result.twitter!.thread.length} ${t}`, `第 ${i + 1} 条`)}
                      >
                        复制这一条
                      </button>
                    </div>
                  </div>
                ))}
                <div className="ai-result-foot">
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={() =>
                      onCopy(
                        result.twitter!.thread.map((t, i) => `${i + 1}/${result.twitter!.thread.length} ${t}`).join('\n\n'),
                        '完整 thread',
                      )
                    }
                  >
                    复制完整 thread（带编号）
                  </button>
                  <button className="btn btn-sm" onClick={() => onCopy(result.twitter!.thread.join('\n\n'), 'thread 纯文本')}>
                    复制纯文本（不带编号）
                  </button>
                </div>
              </div>
            ) : null}

            {platform === 'jike' && result.jike ? (
              <div className="ai-result">
                <div className="ai-result-head">
                  <span className="ai-result-title">即刻正文</span>
                  <LenBadge value={charCount(result.jike.body)} limit={LIMITS.jikeBody} unit="字" />
                </div>
                <div className="ai-result-body" style={{ whiteSpace: 'pre-wrap' }}>
                  {result.jike.body}
                </div>
                <div className="ai-result-foot">
                  <button className="btn btn-sm btn-primary" onClick={() => onCopy(result.jike!.body, '即刻正文')}>
                    复制正文
                  </button>
                </div>
              </div>
            ) : null}

            {platform === 'weibo' && result.weibo ? (
              <div className="ai-result">
                <div className="ai-result-head">
                  <span className="ai-result-title">微博正文</span>
                  <LenBadge value={charCount(result.weibo.text)} limit={LIMITS.weiboText} unit="字" />
                </div>
                <div className="ai-result-body" style={{ whiteSpace: 'pre-wrap' }}>
                  {result.weibo.text}
                </div>
                <div className="ai-result-head">
                  <span className="ai-result-title">话题</span>
                  <span className="thread-len">{result.weibo.topics.length} 个</span>
                </div>
                <div className="ai-result-body" style={{ color: 'var(--accent)' }}>
                  {result.weibo.topics.map((t) => `#${t}#`).join('  ')}
                </div>
                <div className="ai-result-foot">
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={() =>
                      onCopy(`${result.weibo!.text} ${result.weibo!.topics.map((t) => `#${t}#`).join(' ')}`, '微博全文')
                    }
                  >
                    复制正文 + 话题
                  </button>
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  )
}
