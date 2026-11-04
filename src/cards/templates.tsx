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
 *   │  ▬▬  ← 顶部强调短横（34）      │
 *   │  KICKER                      │  ← 56 起
 *   │                              │
 *   │  正文区（各版式自己排）        │
 *   │                              │
 *   │  ────────────────────────    │  ← 分隔线（82）
 *   │  署名              日期       │  ← 页脚（46）
 *   └──────────────────────────────┘
 *
 * 所有装饰元素都锚在「正文区之外」的边带上，永远不会压到文字上。
 */

import type { CSSProperties, ReactNode } from 'react'
import { CARD_HEIGHT, CARD_WIDTH, fitFontSize, QUOTE_THRESHOLDS, TITLE_THRESHOLDS } from './types'
import type { CardSpec } from './types'
import type { CardTheme } from './themes'

const SERIF = '"Songti SC", "Source Han Serif SC", "Noto Serif CJK SC", Georgia, serif'
const SANS = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'
const MONO = '"SF Mono", Menlo, Consolas, monospace'

/** 左右边距 */
const PAD_X = 52
/** 正文区上边界 */
const PAD_TOP = 56
/** 正文区下边界：给分隔线 + 页脚留位 */
const PAD_BOTTOM = 104
/** 页脚基线距底 */
const FOOT_BOTTOM = 46
/** 正文与页脚之间的分隔线 */
const RULE_BOTTOM = 82

/* ------------------------------------------------------------------ */
/* 装饰                                                               */
/* ------------------------------------------------------------------ */

function Ornament({ theme }: { theme: CardTheme }) {
  if (theme.ornament === 'none') return null

  if (theme.ornament === 'band') {
    return (
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: 12,
          background: theme.accent,
        }}
      />
    )
  }

  if (theme.ornament === 'corner') {
    // 右上角的大圆：往画布外推得足够远，只留一小片弧在角上，不进入文字行
    return (
      <div
        style={{
          position: 'absolute',
          top: -170,
          right: -170,
          width: 340,
          height: 340,
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
          top: 34,
          left: PAD_X,
          width: 44,
          height: 3,
          borderRadius: 2,
          background: theme.ornamentColor,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: PAD_X,
          right: PAD_X,
          bottom: RULE_BOTTOM,
          height: 1,
          background: theme.line,
        }}
      />
    </>
  )
}

function Frame({ theme, children }: { theme: CardTheme; children: ReactNode }) {
  return (
    <div
      style={{
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        background: theme.bg,
        color: theme.ink,
        position: 'relative',
        overflow: 'hidden',
        fontFamily: SANS,
        boxSizing: 'border-box',
      }}
    >
      <Ornament theme={theme} />
      {children}
    </div>
  )
}

function Kicker({ text, theme }: { text: string; theme: CardTheme }) {
  if (!text) return null
  return (
    <div
      style={{
        fontSize: 11,
        lineHeight: 1.2,
        letterSpacing: 3.5,
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

function Foot({ left, right, theme }: { left?: string; right?: string; theme: CardTheme }) {
  if (!left && !right) return null
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 16,
        fontSize: 12,
        lineHeight: 1.2,
        color: theme.muted,
        letterSpacing: 0.8,
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ fontFamily: SANS, overflow: 'hidden', textOverflow: 'ellipsis' }}>{left}</span>
      <span style={{ fontFamily: MONO, fontSize: 11, flexShrink: 0 }}>{right}</span>
    </div>
  )
}

/**
 * 四张卡共用的骨架：顶部小标签 + 正文区 + 分隔线 + 页脚。
 * 页脚是绝对定位的，所以不管正文多长多短，四张卡的页脚永远在同一条基线上。
 * 顶栏用 flex 一行放「分类」和「页码」，两者共享基线，永远不会叠在一起。
 */
function Shell({ spec, theme, children }: { spec: CardSpec; theme: CardTheme; children: ReactNode }) {
  const hasTop = Boolean(spec.kicker || spec.mark)
  return (
    <Frame theme={theme}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          padding: `${PAD_TOP}px ${PAD_X}px ${PAD_BOTTOM}px`,
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
              marginBottom: 20,
              flexShrink: 0,
            }}
          >
            <Kicker text={spec.kicker ?? ''} theme={theme} />
            {spec.mark ? (
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: 10.5,
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
      <div style={{ position: 'absolute', left: PAD_X, right: PAD_X, bottom: FOOT_BOTTOM }}>
        <Foot left={spec.footer} right={spec.date} theme={theme} />
      </div>
    </Frame>
  )
}

/* ------------------------------------------------------------------ */
/* 封面                                                               */
/* ------------------------------------------------------------------ */

function CoverCard({ spec, theme }: { spec: CardSpec; theme: CardTheme }) {
  const titleSize = fitFontSize(spec.title, 44, 26, TITLE_THRESHOLDS)
  return (
    <Shell spec={spec} theme={theme}>
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
          }}
        >
          {spec.title}
        </div>
        {spec.subtitle ? (
          <div
            style={{
              marginTop: 20,
              fontSize: 15,
              lineHeight: 1.78,
              color: theme.muted,
              letterSpacing: 0.4,
              maxHeight: 82,
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

function QuoteCard({ spec, theme }: { spec: CardSpec; theme: CardTheme }) {
  const size = fitFontSize(spec.title, 31, 18, QUOTE_THRESHOLDS)
  return (
    <Shell spec={spec} theme={theme}>
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
            fontSize: 56,
            lineHeight: 0.86,
            color: theme.accent,
            marginBottom: 14,
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
          }}
        >
          {spec.title}
        </div>
        {spec.subtitle ? (
          <div
            style={{
              marginTop: 28,
              fontSize: 13,
              color: theme.muted,
              letterSpacing: 1,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <span style={{ width: 22, height: 1, background: theme.accent, display: 'inline-block', flexShrink: 0 }} />
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

function PointsCard({ spec, theme }: { spec: CardSpec; theme: CardTheme }) {
  const points = (spec.points ?? []).slice(0, 5)
  const titleSize = fitFontSize(spec.title, 27, 18, TITLE_THRESHOLDS)
  const bodySize = points.length >= 5 ? 16 : points.length === 4 ? 17 : 18

  return (
    <Shell spec={spec} theme={theme}>
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
            marginBottom: 28,
            color: theme.ink,
            flexShrink: 0,
          }}
        >
          {spec.title}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
          {points.map((p, i) => (
            <div key={i} style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
              <div
                style={{
                  fontFamily: MONO,
                  fontSize: 12.5,
                  fontWeight: 700,
                  color: theme.accent,
                  lineHeight: `${Math.round(bodySize * 1.6)}px`,
                  width: 18,
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

function SectionCard({ spec, theme }: { spec: CardSpec; theme: CardTheme }) {
  const titleSize = fitFontSize(spec.title, 29, 19, TITLE_THRESHOLDS)
  return (
    <Shell spec={spec} theme={theme}>
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
          }}
        >
          {spec.title}
        </div>
        <div
          style={{
            width: 26,
            height: 2,
            borderRadius: 1,
            background: theme.accent,
            margin: '22px 0 20px',
            opacity: 0.9,
          }}
        />
        {spec.subtitle ? (
          <div
            style={{
              fontSize: 15.5,
              lineHeight: 1.85,
              letterSpacing: 0.3,
              color: theme.ink,
              opacity: 0.86,
              maxHeight: 190,
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

function EndCard({ spec, theme }: { spec: CardSpec; theme: CardTheme }) {
  const size = fitFontSize(spec.title, 30, 18, QUOTE_THRESHOLDS)
  return (
    <Shell spec={spec} theme={theme}>
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
            width: 36,
            height: 2,
            background: theme.accent,
            marginBottom: 30,
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
          }}
        >
          {spec.title}
        </div>
        {spec.subtitle ? (
          <div style={{ marginTop: 24, fontSize: 14, color: theme.muted, lineHeight: 1.8 }}>{spec.subtitle}</div>
        ) : null}
      </div>
    </Shell>
  )
}

/* ------------------------------------------------------------------ */

export function CardRenderer({ spec, theme }: { spec: CardSpec; theme: CardTheme }) {
  switch (spec.layout) {
    case 'cover':
      return <CoverCard spec={spec} theme={theme} />
    case 'quote':
      return <QuoteCard spec={spec} theme={theme} />
    case 'points':
      return <PointsCard spec={spec} theme={theme} />
    case 'section':
      return <SectionCard spec={spec} theme={theme} />
    case 'end':
      return <EndCard spec={spec} theme={theme} />
  }
}

/** 卡片外框样式，供预览容器复用 */
export const cardFrameStyle: CSSProperties = {
  width: CARD_WIDTH,
  height: CARD_HEIGHT,
  overflow: 'hidden',
  position: 'relative',
}
