/**
 * 卡片版式（极简杂志风）
 *
 * 约束（保证 html-to-image 导出可靠）：
 * - 只用纯色、linear-gradient、border-radius、box-shadow、position:absolute
 * - 禁用 backdrop-filter / filter:blur / mix-blend-mode / mask / position:fixed
 * - 不引用任何外部图片（外链图会污染 canvas，toPng 直接抛 SecurityError）
 * - 只用系统字体，不内嵌 webfont（跨域字体会让导出结果整张空白）
 *
 * 版式骨架（四张卡共用，保证一套图看起来是同一套东西）：
 *
 *   ┌──────────────────────────────┐
 *   │  ▬▬  ← 顶部强调短横            │
 *   │  KICKER                      │  ← padTop 起
 *   │                              │
 *   │  正文区（各版式自己排）        │
 *   │                              │
 *   │  ────────────────────────    │  ← 分隔线
 *   │  署名              日期       │  ← 页脚
 *   └──────────────────────────────┘
 *
 * 所有装饰元素都锚在「正文区之外」的边带上，永远不会压到文字上。
 *
 * 多尺寸：三种比例共用同一套骨架，度量由 metricsOf(format) 现算。
 * 不用「画一次再缩放」——16:9 的卡片如果整体缩到 540×720 再裁，
 * 文字会小一半、左右全是空边。这里按比例重排：横向边距随宽度放宽，
 * 纵向间距与字号随高度收紧，三种尺寸看起来才像同一套设计而不是同一张图的三种裁法。
 */

import type { CSSProperties, ReactNode } from 'react'
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  fitFontSize,
  getCardFormat,
  QUOTE_THRESHOLDS,
  TITLE_THRESHOLDS,
  type CardFormatId,
} from './types'
import type { CardSpec } from './types'
import type { CardTheme } from './themes'

const SERIF = '"Songti SC", "Source Han Serif SC", "Noto Serif CJK SC", Georgia, serif'
const SANS = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'
const MONO = '"SF Mono", Menlo, Consolas, monospace'

/* ------------------------------------------------------------------ */
/* 度量                                                                */
/* ------------------------------------------------------------------ */

interface Metrics {
  w: number
  h: number
  /** 左右边距 */
  padX: number
  /** 正文区上边界 */
  padTop: number
  /** 正文区下边界：给分隔线 + 页脚留位 */
  padBottom: number
  /** 页脚基线距底 */
  footBottom: number
  /** 正文与页脚之间的分隔线 */
  ruleBottom: number
  /** 字号/纵向间距的缩放系数（以 3:4 的 720 高为 1） */
  s: number
  /** 正文区净高度 */
  contentH: number
}

function metricsOf(format: CardFormatId): Metrics {
  const f = getCardFormat(format)
  const s = f.h / CARD_HEIGHT
  // 横向边距随宽度放宽，但设上限：16:9 的 960 宽如果按比例给 92px 边距，
  // 中间只剩 776，横图会显得又窄又长
  const padX = Math.round(52 * Math.min(1.55, f.w / CARD_WIDTH))
  const padTop = Math.round(56 * s)
  const padBottom = Math.round(104 * s)
  return {
    w: f.w,
    h: f.h,
    padX,
    padTop,
    padBottom,
    footBottom: Math.round(46 * s),
    ruleBottom: Math.round(82 * s),
    s,
    contentH: f.h - padTop - padBottom,
  }
}

/* ------------------------------------------------------------------ */
/* 装饰                                                               */
/* ------------------------------------------------------------------ */

function Ornament({ theme, m }: { theme: CardTheme; m: Metrics }) {
  if (theme.ornament === 'none') return null

  if (theme.ornament === 'band') {
    return (
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: Math.round(12 * m.s),
          background: theme.accent,
        }}
      />
    )
  }

  if (theme.ornament === 'corner') {
    // 右上角的大圆：往画布外推得足够远，只留一小片弧在角上，不进入文字行
    const d = Math.round(340 * m.s)
    return (
      <div
        style={{
          position: 'absolute',
          top: -Math.round(170 * m.s),
          right: -Math.round(170 * m.s),
          width: d,
          height: d,
          borderRadius: '50%',
          background: theme.ornamentColor,
          opacity: 0.42,
        }}
      />
    )
  }

  // rule：顶部一段强调短横 + 正文与页脚之间一条细线
  // 两者都落在正文区上下边界之外，不会压字
  return (
    <>
      <div
        style={{
          position: 'absolute',
          top: Math.round(34 * m.s),
          left: m.padX,
          width: Math.round(44 * m.s),
          height: Math.max(2, Math.round(3 * m.s)),
          borderRadius: 2,
          background: theme.ornamentColor,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: m.padX,
          right: m.padX,
          bottom: m.ruleBottom,
          height: 1,
          background: theme.line,
        }}
      />
    </>
  )
}

function Frame({ theme, m, children }: { theme: CardTheme; m: Metrics; children: ReactNode }) {
  return (
    <div
      style={{
        width: m.w,
        height: m.h,
        background: theme.bg,
        color: theme.ink,
        position: 'relative',
        overflow: 'hidden',
        fontFamily: SANS,
        boxSizing: 'border-box',
      }}
    >
      <Ornament theme={theme} m={m} />
      {children}
    </div>
  )
}

function Kicker({ text, theme, m }: { text: string; theme: CardTheme; m: Metrics }) {
  if (!text) return null
  return (
    <div
      style={{
        fontSize: Math.round(11 * m.s * 10) / 10,
        lineHeight: 1.2,
        letterSpacing: 3.5 * m.s,
        color: theme.accent,
        fontWeight: 600,
        textTransform: 'uppercase',
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
    >
      {text}
    </div>
  )
}

function Foot({ left, right, theme, m }: { left?: string; right?: string; theme: CardTheme; m: Metrics }) {
  if (!left && !right) return null
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 16,
        fontSize: Math.round(12 * m.s * 10) / 10,
        lineHeight: 1.2,
        color: theme.muted,
        letterSpacing: 0.8,
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ fontFamily: SANS, overflow: 'hidden', textOverflow: 'ellipsis' }}>{left}</span>
      <span style={{ fontFamily: MONO, fontSize: Math.round(11 * m.s * 10) / 10, flexShrink: 0 }}>{right}</span>
    </div>
  )
}

/**
 * 四张卡共用的骨架：顶部小标签 + 正文区 + 分隔线 + 页脚。
 * 页脚是绝对定位的，所以不管正文多长多短，四张卡的页脚永远在同一条基线上。
 * 顶栏用 flex 一行放「分类」和「页码」，两者共享基线，永远不会叠在一起。
 */
function Shell({
  spec,
  theme,
  m,
  children,
}: {
  spec: CardSpec
  theme: CardTheme
  m: Metrics
  children: ReactNode
}) {
  const hasTop = Boolean(spec.kicker || spec.mark)
  return (
    <Frame theme={theme} m={m}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          padding: `${m.padTop}px ${m.padX}px ${m.padBottom}px`,
          display: 'flex',
          flexDirection: 'column',
          boxSizing: 'border-box',
        }}
      >
        {hasTop ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: 14,
              marginBottom: Math.round(20 * m.s),
              flexShrink: 0,
            }}
          >
            <Kicker text={spec.kicker ?? ''} theme={theme} m={m} />
            {spec.mark ? (
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: Math.round(10.5 * m.s * 10) / 10,
                  lineHeight: 1.2,
                  letterSpacing: 1.2,
                  color: theme.muted,
                  flexShrink: 0,
                }}
              >
                {spec.mark}
              </span>
            ) : null}
          </div>
        ) : null}
        {children}
      </div>
      <div style={{ position: 'absolute', left: m.padX, right: m.padX, bottom: m.footBottom }}>
        <Foot left={spec.footer} right={spec.date} theme={theme} m={m} />
      </div>
    </Frame>
  )
}

/* ------------------------------------------------------------------ */
/* 封面                                                               */
/* ------------------------------------------------------------------ */

function CoverCard({ spec, theme, m }: { spec: CardSpec; theme: CardTheme; m: Metrics }) {
  const titleSize = fitFontSize(spec.title, Math.round(44 * m.s), Math.round(26 * m.s), TITLE_THRESHOLDS)
  return (
    <Shell spec={spec} theme={theme} m={m}>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            fontFamily: SERIF,
            fontSize: titleSize,
            lineHeight: 1.34,
            letterSpacing: 1,
            fontWeight: 700,
            color: theme.ink,
            textWrap: 'balance',
          }}
        >
          {spec.title}
        </div>
        {spec.subtitle ? (
          <div
            style={{
              marginTop: Math.round(20 * m.s),
              fontSize: Math.round(15 * m.s * 10) / 10,
              lineHeight: 1.78,
              color: theme.muted,
              letterSpacing: 0.4,
              maxHeight: Math.round(m.contentH * 0.24),
              overflow: 'hidden',
            }}
          >
            {spec.subtitle}
          </div>
        ) : null}
      </div>
    </Shell>
  )
}

/* ------------------------------------------------------------------ */
/* 金句                                                               */
/* ------------------------------------------------------------------ */

function QuoteCard({ spec, theme, m }: { spec: CardSpec; theme: CardTheme; m: Metrics }) {
  const size = fitFontSize(spec.title, Math.round(31 * m.s), Math.round(18 * m.s), QUOTE_THRESHOLDS)
  return (
    <Shell spec={spec} theme={theme} m={m}>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            fontFamily: SERIF,
            fontSize: Math.round(56 * m.s),
            lineHeight: 0.86,
            color: theme.accent,
            marginBottom: Math.round(14 * m.s),
            opacity: 0.9,
          }}
        >
          “
        </div>
        <div
          style={{
            fontFamily: SERIF,
            fontSize: size,
            lineHeight: 1.76,
            letterSpacing: 0.8,
            color: theme.ink,
            maxHeight: Math.round(m.contentH * 0.78),
            overflow: 'hidden',
            textWrap: 'balance',
          }}
        >
          {spec.title}
        </div>
        {spec.subtitle ? (
          <div
            style={{
              marginTop: Math.round(28 * m.s),
              fontSize: Math.round(13 * m.s * 10) / 10,
              color: theme.muted,
              letterSpacing: 1,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <span
              style={{
                width: Math.round(22 * m.s),
                height: 1,
                background: theme.accent,
                display: 'inline-block',
                flexShrink: 0,
              }}
            />
            {spec.subtitle}
          </div>
        ) : null}
      </div>
    </Shell>
  )
}

/* ------------------------------------------------------------------ */
/* 要点                                                               */
/* ------------------------------------------------------------------ */

function PointsCard({ spec, theme, m }: { spec: CardSpec; theme: CardTheme; m: Metrics }) {
  const points = (spec.points ?? []).slice(0, 5)
  const titleSize = fitFontSize(spec.title, Math.round(27 * m.s), Math.round(18 * m.s), TITLE_THRESHOLDS)
  const base = points.length >= 5 ? 16 : points.length === 4 ? 17 : 18
  const bodySize = Math.round(base * m.s * 10) / 10
  const gap = Math.round(26 * m.s * (m.h < 600 ? 0.82 : 1))

  return (
    <Shell spec={spec} theme={theme} m={m}>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            fontFamily: SERIF,
            fontSize: titleSize,
            lineHeight: 1.4,
            fontWeight: 700,
            letterSpacing: 0.8,
            marginBottom: Math.round(28 * m.s),
            color: theme.ink,
            flexShrink: 0,
            textWrap: 'balance',
          }}
        >
          {spec.title}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap }}>
          {points.map((p, i) => (
            <div key={i} style={{ display: 'flex', gap: Math.round(16 * m.s), alignItems: 'flex-start' }}>
              <div
                style={{
                  fontFamily: MONO,
                  fontSize: Math.round(12.5 * m.s * 10) / 10,
                  fontWeight: 700,
                  color: theme.accent,
                  lineHeight: `${Math.round(bodySize * 1.6)}px`,
                  width: Math.round(18 * m.s),
                  flexShrink: 0,
                  letterSpacing: 0,
                }}
              >
                {String(i + 1).padStart(2, '0')}
              </div>
              <div
                style={{
                  fontSize: bodySize,
                  lineHeight: 1.6,
                  color: theme.ink,
                  letterSpacing: 0.3,
                  flex: 1,
                  minWidth: 0,
                }}
              >
                {p}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Shell>
  )
}

/* ------------------------------------------------------------------ */
/* 小节                                                               */
/* ------------------------------------------------------------------ */

function SectionCard({ spec, theme, m }: { spec: CardSpec; theme: CardTheme; m: Metrics }) {
  const titleSize = fitFontSize(spec.title, Math.round(29 * m.s), Math.round(19 * m.s), TITLE_THRESHOLDS)
  return (
    <Shell spec={spec} theme={theme} m={m}>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            fontFamily: SERIF,
            fontSize: titleSize,
            lineHeight: 1.42,
            fontWeight: 700,
            letterSpacing: 0.6,
            color: theme.ink,
            flexShrink: 0,
          }}
        >
          {spec.title}
        </div>
        <div
          style={{
            width: Math.round(26 * m.s),
            height: 2,
            borderRadius: 1,
            background: theme.accent,
            margin: `${Math.round(22 * m.s)}px 0 ${Math.round(20 * m.s)}px`,
            opacity: 0.9,
            flexShrink: 0,
          }}
        />
        {spec.subtitle ? (
          <div
            style={{
              fontSize: Math.round(15.5 * m.s * 10) / 10,
              lineHeight: 1.85,
              letterSpacing: 0.3,
              color: theme.ink,
              opacity: 0.86,
              // 摘要的可用高度必须按画布算：16:9 只有 420 的正文区，
              // 写死 190 会直接把最后两行顶到页脚下面
              maxHeight: Math.round(m.contentH * 0.52),
              overflow: 'hidden',
            }}
          >
            {spec.subtitle}
          </div>
        ) : null}
      </div>
    </Shell>
  )
}

/* ------------------------------------------------------------------ */
/* 结尾                                                               */
/* ------------------------------------------------------------------ */

function EndCard({ spec, theme, m }: { spec: CardSpec; theme: CardTheme; m: Metrics }) {
  const size = fitFontSize(spec.title, Math.round(30 * m.s), Math.round(18 * m.s), QUOTE_THRESHOLDS)
  return (
    <Shell spec={spec} theme={theme} m={m}>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            width: Math.round(36 * m.s),
            height: 2,
            background: theme.accent,
            marginBottom: Math.round(30 * m.s),
            borderRadius: 1,
          }}
        />
        <div
          style={{
            fontFamily: SERIF,
            fontSize: size,
            lineHeight: 1.72,
            letterSpacing: 0.8,
            color: theme.ink,
            maxHeight: Math.round(m.contentH * 0.72),
            overflow: 'hidden',
          }}
        >
          {spec.title}
        </div>
        {spec.subtitle ? (
          <div
            style={{
              marginTop: Math.round(24 * m.s),
              fontSize: Math.round(14 * m.s * 10) / 10,
              color: theme.muted,
              lineHeight: 1.8,
            }}
          >
            {spec.subtitle}
          </div>
        ) : null}
      </div>
    </Shell>
  )
}

/* ------------------------------------------------------------------ */

export function CardRenderer({
  spec,
  theme,
  format = '3:4',
}: {
  spec: CardSpec
  theme: CardTheme
  format?: CardFormatId
}) {
  const m = metricsOf(format)
  switch (spec.layout) {
    case 'cover':
      return <CoverCard spec={spec} theme={theme} m={m} />
    case 'quote':
      return <QuoteCard spec={spec} theme={theme} m={m} />
    case 'points':
      return <PointsCard spec={spec} theme={theme} m={m} />
    case 'section':
      return <SectionCard spec={spec} theme={theme} m={m} />
    case 'end':
      return <EndCard spec={spec} theme={theme} m={m} />
  }
}

/** 卡片外框样式，供预览容器复用 */
export const cardFrameStyle: CSSProperties = {
  width: CARD_WIDTH,
  height: CARD_HEIGHT,
  overflow: 'hidden',
  position: 'relative',
}
