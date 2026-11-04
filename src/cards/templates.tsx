/**
 * 卡片版式（极简杂志风）
 *
 * 约束（保证 html-to-image 导出可靠）：
 * - 只用纯色、linear-gradient、border-radius、box-shadow、position:absolute
 * - 禁用 backdrop-filter / filter:blur / mix-blend-mode / mask / position:fixed
 * - 不引用任何外部图片（外链图会污染 canvas，toPng 直接抛 SecurityError）
 * - 只用系统字体，不内嵌 webfont（跨域字体会让导出结果整张空白）
 */

import type { CSSProperties, ReactNode } from 'react'
import { CARD_HEIGHT, CARD_WIDTH, fitFontSize, QUOTE_THRESHOLDS, TITLE_THRESHOLDS } from './types'
import type { CardSpec } from './types'
import type { CardTheme } from './themes'

const SERIF = '"Songti SC", "Source Han Serif SC", "Noto Serif CJK SC", Georgia, serif'
const SANS = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'
const MONO = '"SF Mono", Menlo, Consolas, monospace'

interface FrameProps {
  theme: CardTheme
  children: ReactNode
}

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
          height: 14,
          background: theme.accent,
        }}
      />
    )
  }

  if (theme.ornament === 'corner') {
    return (
      <div
        style={{
          position: 'absolute',
          top: -120,
          right: -120,
          width: 320,
          height: 320,
          borderRadius: '50%',
          background: theme.ornamentColor,
          opacity: 0.55,
        }}
      />
    )
  }

  // rule：左上角一段短竖线 + 底部一条细横线
  return (
    <>
      <div
        style={{
          position: 'absolute',
          top: 54,
          left: 52,
          width: 3,
          height: 34,
          background: theme.ornamentColor,
          borderRadius: 2,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 52,
          right: 52,
          bottom: 46,
          height: 1,
          background: theme.line,
        }}
      />
    </>
  )
}

function Frame({ theme, children }: FrameProps) {
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
        letterSpacing: 3.5,
        color: theme.accent,
        fontWeight: 600,
        textTransform: 'uppercase',
        marginBottom: 22,
      }}
    >
      {text}
    </div>
  )
}

function Foot({
  left,
  right,
  theme,
}: {
  left?: string
  right?: string
  theme: CardTheme
}) {
  if (!left && !right) return null
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        fontSize: 12,
        color: theme.muted,
        letterSpacing: 0.8,
      }}
    >
      <span style={{ fontFamily: SANS }}>{left}</span>
      <span style={{ fontFamily: MONO, fontSize: 11 }}>{right}</span>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 封面                                                               */
/* ------------------------------------------------------------------ */

function CoverCard({ spec, theme }: { spec: CardSpec; theme: CardTheme }) {
  const titleSize = fitFontSize(spec.title, 44, 26, TITLE_THRESHOLDS)
  return (
    <Frame theme={theme}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          padding: '58px 52px 46px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ paddingTop: 34 }}>
          <Kicker text={spec.kicker ?? ''} theme={theme} />
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
                marginTop: 22,
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
        <Foot left={spec.footer} right={spec.date} theme={theme} />
      </div>
    </Frame>
  )
}

/* ------------------------------------------------------------------ */
/* 金句                                                               */
/* ------------------------------------------------------------------ */

function QuoteCard({ spec, theme }: { spec: CardSpec; theme: CardTheme }) {
  const size = fitFontSize(spec.title, 31, 18, QUOTE_THRESHOLDS)
  return (
    <Frame theme={theme}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          padding: '62px 54px 48px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            fontFamily: SERIF,
            fontSize: 58,
            lineHeight: 0.7,
            color: theme.accent,
            marginBottom: 26,
            opacity: 0.85,
          }}
        >
          「
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
              marginTop: 30,
              fontSize: 13,
              color: theme.muted,
              letterSpacing: 1,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <span style={{ width: 22, height: 1, background: theme.accent, display: 'inline-block' }} />
            {spec.subtitle}
          </div>
        ) : null}
      </div>
      <div
        style={{
          position: 'absolute',
          left: 54,
          right: 54,
          bottom: 44,
        }}
      >
        <Foot left={spec.footer} right={spec.date} theme={theme} />
      </div>
    </Frame>
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
    <Frame theme={theme}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          padding: '56px 52px 46px',
          display: 'flex',
          flexDirection: 'column',
          boxSizing: 'border-box',
        }}
      >
        <Kicker text={spec.kicker ?? ''} theme={theme} />
        <div
          style={{
            fontFamily: SERIF,
            fontSize: titleSize,
            lineHeight: 1.4,
            fontWeight: 700,
            letterSpacing: 0.8,
            marginBottom: 30,
            color: theme.ink,
          }}
        >
          {spec.title}
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 20 }}>
          {points.map((p, i) => (
            <div key={i} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <div
                style={{
                  fontFamily: MONO,
                  fontSize: 13,
                  fontWeight: 700,
                  color: theme.accent,
                  lineHeight: `${bodySize * 1.62}px`,
                  width: 20,
                  flexShrink: 0,
                }}
              >
                {String(i + 1).padStart(2, '0')}
              </div>
              <div
                style={{
                  fontSize: bodySize,
                  lineHeight: 1.62,
                  color: theme.ink,
                  letterSpacing: 0.3,
                  flex: 1,
                }}
              >
                {p}
              </div>
            </div>
          ))}
        </div>
        <Foot left={spec.footer} right={spec.date} theme={theme} />
      </div>
    </Frame>
  )
}

/* ------------------------------------------------------------------ */
/* 结尾                                                               */
/* ------------------------------------------------------------------ */

function EndCard({ spec, theme }: { spec: CardSpec; theme: CardTheme }) {
  const size = fitFontSize(spec.title, 30, 18, QUOTE_THRESHOLDS)
  return (
    <Frame theme={theme}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          padding: '62px 54px 52px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          textAlign: 'center',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            width: 36,
            height: 2,
            background: theme.accent,
            marginBottom: 32,
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
          <div style={{ marginTop: 26, fontSize: 14, color: theme.muted, lineHeight: 1.8 }}>
            {spec.subtitle}
          </div>
        ) : null}
      </div>
      <div style={{ position: 'absolute', left: 54, right: 54, bottom: 50, textAlign: 'center' }}>
        <div style={{ fontSize: 12.5, color: theme.muted, letterSpacing: 1.2 }}>
          {spec.footer}
          {spec.date ? `　·　${spec.date}` : ''}
        </div>
      </div>
    </Frame>
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
