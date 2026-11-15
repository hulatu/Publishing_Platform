/**
 * 卡片版式（Kami 纸感一系）
 *
 * 约束（保证 html-to-image 导出可靠）：
 * - 只用纯色、linear-gradient、border-radius、box-shadow、position:absolute
 * - 禁用 backdrop-filter / filter:blur / mix-blend-mode / mask / position:fixed
 * - 不引用任何外部图片（外链图会污染 canvas，toPng 直接抛 SecurityError）
 * - 只用系统字体，不内嵌 webfont（跨域字体会让导出结果整张空白）
 *
 * 版式骨架（所有卡共用，保证一套图看起来是同一套东西）：
 *
 *   ┌──────────────────────────────┐
 *   │  ▬▬  ← 顶部强调短横            │
 *   │  KICKER                 页码  │  ← padTop 起
 *   │                              │
 *   │  正文区（各版式自己排）        │
 *   │                              │
 *   │  ────────────────────────    │  ← 分隔线
 *   │  署名              日期       │  ← 页脚
 *   └──────────────────────────────┘
 *
 * 所有装饰元素都锚在「正文区之外」的边带上，永远不会压到文字上。
 *
 * 设计取向参照 tw93/kami：标题与正文同一套衬线字体、字重 500 不用合成粗体，
 * 一种强调色（油墨蓝）不超过版面 5%，层级靠字号与留白而不是边框和阴影。
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
  densityGap,
  fitFontSize,
  getCardFormat,
  QUOTE_THRESHOLDS,
  sizeScale,
  specDensity,
  specSize,
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
  /** 几何缩放系数（以 3:4 的 720 高为 1） */
  s: number
  /** 字号系数：size 档位 */
  ts: number
  /** 间距系数：density 档位 */
  gk: number
  /** 正文区净高度 */
  contentH: number
}

function metricsOf(format: CardFormatId, spec?: Pick<CardSpec, 'size' | 'density'>): Metrics {
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
    ts: sizeScale[specSize(spec)],
    gk: densityGap[specDensity(spec)],
    contentH: f.h - padTop - padBottom,
  }
}

/** 字号：按画布与 size 档位换算，保留一位小数，避免 subpixel 抖动 */
const fs = (m: Metrics, n: number) => Math.round(n * m.s * m.ts * 10) / 10
/** 间距：按画布与 density 档位换算 */
const g = (m: Metrics, n: number) => Math.round(n * m.s * m.gk)

const isCenter = (spec: CardSpec) => spec.align === 'center'

/* ------------------------------------------------------------------ */
/* 装饰                                                               */
/* ------------------------------------------------------------------ */

function Ornament({ theme, m, showRule = true }: { theme: CardTheme; m: Metrics; showRule?: boolean }) {
  if (theme.ornament === 'none') return null

  if (theme.ornament === 'band') {
    return (
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: Math.round(10 * m.s),
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
          opacity: 0.55,
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
          height: Math.max(2, Math.round(2.5 * m.s)),
          borderRadius: 1,
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
          display: showRule ? undefined : 'none',
        }}
      />
    </>
  )
}

function Frame({
  theme,
  m,
  showRule,
  children,
}: {
  theme: CardTheme
  m: Metrics
  showRule?: boolean
  children: ReactNode
}) {
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
      <Ornament theme={theme} m={m} showRule={showRule} />
      {children}
    </div>
  )
}

function Kicker({ text, theme, m }: { text: string; theme: CardTheme; m: Metrics }) {
  if (!text) return null
  return (
    <div
      style={{
        fontSize: fs(m, 10.5),
        lineHeight: 1.2,
        letterSpacing: 0.22 * 10.5 * m.s * m.ts,
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
        fontSize: fs(m, 11.5),
        lineHeight: 1.2,
        color: theme.muted,
        letterSpacing: 0.06 * 11.5 * m.s,
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ fontFamily: SANS, overflow: 'hidden', textOverflow: 'ellipsis' }}>{left}</span>
      <span style={{ fontFamily: MONO, fontSize: fs(m, 10.5), flexShrink: 0, letterSpacing: 0.06 * 10.5 * m.s }}>
        {right}
      </span>
    </div>
  )
}

/**
 * 所有卡共用的骨架：顶部小标签 + 正文区 + 分隔线 + 页脚。
 * 页脚是绝对定位的，所以不管正文多长多短，所有卡的页脚永远在同一条基线上。
 * 顶栏用 flex 一行放「分类」和「页码」，两者共享基线，永远不会叠在一起。
 * 三块内容都可以在编辑区单独关掉，关掉后顶栏整行让位给正文。
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
  const kicker = spec.showKicker === false ? '' : (spec.kicker ?? '')
  const mark = spec.showMark === false ? '' : (spec.mark ?? '')
  const hasTop = Boolean(kicker || mark)
  const showFoot = spec.showFooter !== false
  return (
    <Frame theme={theme} m={m} showRule={showFoot}>
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
              marginBottom: g(m, 20),
              flexShrink: 0,
            }}
          >
            <Kicker text={kicker} theme={theme} m={m} />
            {mark ? (
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: fs(m, 10.5),
                  lineHeight: 1.2,
                  letterSpacing: 0.1 * 10.5 * m.s,
                  color: theme.muted,
                  flexShrink: 0,
                }}
              >
                {mark}
              </span>
            ) : null}
          </div>
        ) : null}
        {children}
      </div>
      {showFoot ? (
        <div style={{ position: 'absolute', left: m.padX, right: m.padX, bottom: m.footBottom }}>
          <Foot left={spec.footer} right={spec.date} theme={theme} m={m} />
        </div>
      ) : null}
    </Frame>
  )
}

/* ------------------------------------------------------------------ */
/* 封面                                                               */
/* ------------------------------------------------------------------ */

function CoverCard({ spec, theme, m }: { spec: CardSpec; theme: CardTheme; m: Metrics }) {
  const center = isCenter(spec)
  const titleSize = fitFontSize(spec.title, fs(m, 45), fs(m, 26), TITLE_THRESHOLDS)
  return (
    <Shell spec={spec} theme={theme} m={m}>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: center ? 'center' : undefined,
          textAlign: center ? 'center' : undefined,
        }}
      >
        <div
          style={{
            fontFamily: SERIF,
            fontSize: titleSize,
            lineHeight: 1.32,
            letterSpacing: 0.02 * titleSize,
            fontWeight: 500,
            color: theme.ink,
            textWrap: 'balance',
          }}
        >
          {spec.title}
        </div>
        {spec.subtitle ? (
          <div
            style={{
              marginTop: g(m, 22),
              fontFamily: SERIF,
              fontSize: fs(m, 15),
              lineHeight: 1.85,
              color: theme.muted,
              letterSpacing: 0.02 * 15,
              maxHeight: Math.round(m.contentH * 0.3),
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
  const center = isCenter(spec)
  const size = fitFontSize(spec.title, fs(m, 30), fs(m, 18), QUOTE_THRESHOLDS)
  return (
    <Shell spec={spec} theme={theme} m={m}>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: center ? 'center' : undefined,
          textAlign: center ? 'center' : undefined,
        }}
      >
        <div
          style={{
            fontFamily: SERIF,
            fontSize: fs(m, 54),
            lineHeight: 0.8,
            color: theme.accent,
            marginBottom: g(m, 12),
            opacity: 0.85,
          }}
        >
          “
        </div>
        <div
          style={{
            fontFamily: SERIF,
            fontSize: size,
            lineHeight: 1.74,
            letterSpacing: 0.03 * size,
            fontWeight: 500,
            color: theme.ink,
            maxHeight: Math.round(m.contentH * 0.72),
            overflow: 'hidden',
            textWrap: 'balance',
          }}
        >
          {spec.title}
        </div>
        {spec.subtitle ? (
          <div
            style={{
              marginTop: g(m, 26),
              fontSize: fs(m, 12.5),
              color: theme.muted,
              letterSpacing: 0.04 * 12.5,
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
  const titleSize = fitFontSize(spec.title, fs(m, 26), fs(m, 18), TITLE_THRESHOLDS)
  // 条数越多字号越小：五条挤在一张 3:4 里，16px 是还能读的下限
  const base = points.length >= 5 ? 15.5 : points.length === 4 ? 16.5 : 17.5
  const bodySize = fs(m, base)
  const rowGap = g(m, 15)
  return (
    <Shell spec={spec} theme={theme} m={m}>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div
          style={{
            fontFamily: SERIF,
            fontSize: titleSize,
            lineHeight: 1.42,
            fontWeight: 500,
            letterSpacing: 0.02 * titleSize,
            marginBottom: g(m, 24),
            color: theme.ink,
            flexShrink: 0,
            textWrap: 'balance',
          }}
        >
          {spec.title}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {points.map((p, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                gap: Math.round(14 * m.s),
                alignItems: 'flex-start',
                paddingTop: i === 0 ? 0 : rowGap,
                borderTop: i === 0 ? 'none' : `1px solid ${theme.line}`,
              }}
            >
              <div
                style={{
                  fontFamily: MONO,
                  fontSize: fs(m, 11),
                  fontWeight: 600,
                  color: theme.accent,
                  lineHeight: `${Math.round(bodySize * 1.65)}px`,
                  width: Math.round(20 * m.s),
                  flexShrink: 0,
                  letterSpacing: 0.02 * 11,
                }}
              >
                {String(i + 1).padStart(2, '0')}
              </div>
              <div
                style={{
                  fontSize: bodySize,
                  lineHeight: 1.66,
                  color: theme.ink,
                  letterSpacing: 0.02 * bodySize,
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
  const center = isCenter(spec)
  const titleSize = fitFontSize(spec.title, fs(m, 30), fs(m, 19), TITLE_THRESHOLDS)
  return (
    <Shell spec={spec} theme={theme} m={m}>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: center ? 'center' : undefined,
          textAlign: center ? 'center' : undefined,
        }}
      >
        <div
          style={{
            fontFamily: SERIF,
            fontSize: titleSize,
            lineHeight: 1.42,
            fontWeight: 500,
            letterSpacing: 0.02 * titleSize,
            color: theme.ink,
            flexShrink: 0,
            textWrap: 'balance',
          }}
        >
          {spec.title}
        </div>
        <div
          style={{
            width: Math.round(30 * m.s),
            height: 2,
            borderRadius: 1,
            background: theme.accent,
            margin: `${g(m, 20)}px 0 ${g(m, 18)}px`,
            opacity: 0.9,
            flexShrink: 0,
          }}
        />
        {spec.subtitle ? (
          <div
            style={{
              fontFamily: SERIF,
              fontSize: fs(m, 15),
              lineHeight: 1.92,
              letterSpacing: 0.02 * 15,
              color: theme.ink,
              opacity: 0.84,
              // 摘要的可用高度必须按画布算：16:9 只有 420 的正文区，
              // 写死 190 会直接把最后两行顶到页脚下面
              maxHeight: Math.round(m.contentH * 0.5),
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
/* 数据                                                               */
/* ------------------------------------------------------------------ */

function StatCard({ spec, theme, m }: { spec: CardSpec; theme: CardTheme; m: Metrics }) {
  const center = isCenter(spec)
  const stats = (spec.stats ?? []).filter((s) => s.value.trim()).slice(0, 3)
  const valueSize = stats.length >= 3 ? fs(m, 34) : stats.length === 2 ? fs(m, 42) : fs(m, 52)
  const titleSize = fitFontSize(spec.title, fs(m, 22), fs(m, 16), TITLE_THRESHOLDS)
  return (
    <Shell spec={spec} theme={theme} m={m}>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: center ? 'center' : undefined,
          textAlign: center ? 'center' : undefined,
        }}
      >
        {spec.title ? (
          <div
            style={{
              fontFamily: SERIF,
              fontSize: titleSize,
              lineHeight: 1.45,
              fontWeight: 500,
              color: theme.ink,
              marginBottom: g(m, 30),
              flexShrink: 0,
            }}
          >
            {spec.title}
          </div>
        ) : null}
        {stats.length === 0 ? (
          // 不编造数字：没填就给一句提示，省得导出一张带假数据的图
          <div style={{ fontSize: fs(m, 15), lineHeight: 1.7, color: theme.muted }}>
            在右侧补一项指标，比如「98% · 复购率」
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: center ? 'center' : 'flex-start',
              width: '100%',
            }}
          >
            {stats.map((s, i) => (
              <div
                key={i}
                style={{
                  flex: stats.length > 1 ? 1 : undefined,
                  minWidth: 0,
                  paddingLeft: i === 0 ? 0 : g(m, 18),
                  marginLeft: i === 0 ? 0 : g(m, 18),
                  borderLeft: i === 0 ? 'none' : `1px solid ${theme.line}`,
                }}
              >
                <div
                  style={{
                    fontFamily: SERIF,
                    fontSize: valueSize,
                    lineHeight: 1.1,
                    fontWeight: 500,
                    letterSpacing: 0.01 * valueSize,
                    color: theme.accent,
                    fontVariantNumeric: 'tabular-nums',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {s.value}
                </div>
                <div
                  style={{
                    marginTop: g(m, 10),
                    fontSize: fs(m, 12),
                    lineHeight: 1.55,
                    color: theme.muted,
                    letterSpacing: 0.03 * 12,
                    maxHeight: fs(m, 12) * 1.55 * 3,
                    overflow: 'hidden',
                  }}
                >
                  {s.label}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Shell>
  )
}

/* ------------------------------------------------------------------ */
/* 目录                                                               */
/* ------------------------------------------------------------------ */

function TocCard({ spec, theme, m }: { spec: CardSpec; theme: CardTheme; m: Metrics }) {
  const items = (spec.points ?? []).slice(0, 6)
  const titleSize = fitFontSize(spec.title, fs(m, 24), fs(m, 17), TITLE_THRESHOLDS)
  const rowGap = g(m, 13)
  return (
    <Shell spec={spec} theme={theme} m={m}>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div
          style={{
            fontFamily: SERIF,
            fontSize: titleSize,
            lineHeight: 1.42,
            fontWeight: 500,
            color: theme.ink,
            marginBottom: g(m, 18),
            flexShrink: 0,
          }}
        >
          {spec.title}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {items.map((p, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: Math.round(13 * m.s),
                padding: `${rowGap}px 0`,
                borderTop: `1px solid ${theme.line}`,
              }}
            >
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: fs(m, 10.5),
                  color: theme.accent,
                  letterSpacing: 0.04 * 10.5,
                  flexShrink: 0,
                }}
              >
                {String(i + 1).padStart(2, '0')}
              </span>
              <span
                style={{
                  fontSize: fs(m, 15.5),
                  lineHeight: 1.5,
                  color: theme.ink,
                  letterSpacing: 0.02 * 15.5,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  minWidth: 0,
                  flex: 1,
                }}
              >
                {p}
              </span>
            </div>
          ))}
        </div>
      </div>
    </Shell>
  )
}

/* ------------------------------------------------------------------ */
/* 对比                                                               */
/* ------------------------------------------------------------------ */

/** 「左 | 右」拆成两栏；没写分隔符的行只占左栏 */
function splitPair(line: string): [string, string] {
  const m = /^(.+?)\s*[|｜]\s*(.+)$/.exec(line.trim())
  return m ? [m[1].trim(), m[2].trim()] : [line.trim(), '']
}

function CompareCard({ spec, theme, m }: { spec: CardSpec; theme: CardTheme; m: Metrics }) {
  const rows = (spec.points ?? []).slice(0, 4).map(splitPair)
  const rowGap = g(m, 12)
  const headStyle: CSSProperties = {
    fontSize: fs(m, 12),
    lineHeight: 1.4,
    letterSpacing: 0.12 * 12,
    color: theme.muted,
    fontWeight: 600,
    textTransform: 'uppercase',
    paddingBottom: g(m, 10),
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  }
  const cellStyle: CSSProperties = {
    fontSize: fs(m, 14.5),
    lineHeight: 1.6,
    color: theme.ink,
    letterSpacing: 0.02 * 14.5,
    padding: `${rowGap}px 0`,
    overflow: 'hidden',
  }
  return (
    <Shell spec={spec} theme={theme} m={m}>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div style={{ fontFamily: SERIF, fontSize: fs(m, 19), fontWeight: 500, color: theme.ink, flexShrink: 0 }}>
          {spec.title || '两种做法'}
        </div>
        <div
          style={{
            display: 'flex',
            marginTop: g(m, 22),
            borderTop: `1px solid ${theme.line}`,
          }}
        >
          <div style={{ flex: 1, minWidth: 0, paddingRight: g(m, 16) }}>
            <div style={headStyle}>{spec.leftLabel || '做法 A'}</div>
            {rows.map(([left], i) => (
              <div key={i} style={{ ...cellStyle, borderTop: i === 0 ? 'none' : `1px solid ${theme.line}` }}>
                {left}
              </div>
            ))}
          </div>
          <div style={{ width: 1, background: theme.line, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0, paddingLeft: g(m, 16) }}>
            <div style={headStyle}>{spec.rightLabel || '做法 B'}</div>
            {rows.map(([, right], i) => (
              <div
                key={i}
                style={{
                  ...cellStyle,
                  borderTop: i === 0 ? 'none' : `1px solid ${theme.line}`,
                  color: right ? theme.ink : theme.muted,
                }}
              >
                {right}
              </div>
            ))}
          </div>
        </div>
      </div>
    </Shell>
  )
}

/* ------------------------------------------------------------------ */
/* 引导                                                               */
/* ------------------------------------------------------------------ */

function CtaCard({ spec, theme, m }: { spec: CardSpec; theme: CardTheme; m: Metrics }) {
  const size = fitFontSize(spec.title, fs(m, 30), fs(m, 18), QUOTE_THRESHOLDS)
  /** 按钮文字是可选的：留空就只留标题与说明，不硬塞一句「长按识别」 */
  const tag = (spec.points ?? [])[0]?.trim() || ''
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
            width: Math.round(34 * m.s),
            height: 2,
            background: theme.accent,
            marginBottom: g(m, 28),
            borderRadius: 1,
          }}
        />
        <div
          style={{
            fontFamily: SERIF,
            fontSize: size,
            lineHeight: 1.62,
            letterSpacing: 0.03 * size,
            fontWeight: 500,
            color: theme.ink,
            maxHeight: Math.round(m.contentH * 0.55),
            overflow: 'hidden',
            textWrap: 'balance',
          }}
        >
          {spec.title}
        </div>
        {spec.subtitle ? (
          <div
            style={{
              marginTop: g(m, 18),
              fontSize: fs(m, 13),
              color: theme.muted,
              lineHeight: 1.8,
              maxHeight: Math.round(m.contentH * 0.24),
              overflow: 'hidden',
            }}
          >
            {spec.subtitle}
          </div>
        ) : null}
        {tag ? (
          <div
            style={{
              marginTop: g(m, 30),
              padding: `${Math.round(6 * m.s)}px ${Math.round(14 * m.s)}px`,
              borderRadius: 2,
              background: theme.tint,
              color: theme.accent,
              fontSize: fs(m, 11),
              letterSpacing: 0.14 * 11,
              fontWeight: 600,
              textTransform: 'uppercase',
              whiteSpace: 'nowrap',
            }}
          >
            {tag}
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
  const size = fitFontSize(spec.title, fs(m, 28), fs(m, 17), QUOTE_THRESHOLDS)
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
            marginBottom: g(m, 26),
            borderRadius: 1,
          }}
        />
        <div
          style={{
            fontFamily: SERIF,
            fontSize: size,
            lineHeight: 1.72,
            letterSpacing: 0.03 * size,
            fontWeight: 500,
            color: theme.ink,
            maxHeight: Math.round(m.contentH * 0.68),
            overflow: 'hidden',
            textWrap: 'balance',
          }}
        >
          {spec.title}
        </div>
        {spec.subtitle ? (
          <div
            style={{
              marginTop: g(m, 22),
              fontSize: fs(m, 13),
              color: theme.muted,
              lineHeight: 1.8,
              maxHeight: Math.round(m.contentH * 0.22),
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

export function CardRenderer({
  spec,
  theme,
  format = '3:4',
}: {
  spec: CardSpec
  theme: CardTheme
  format?: CardFormatId
}) {
  const m = metricsOf(format, spec)
  switch (spec.layout) {
    case 'cover':
      return <CoverCard spec={spec} theme={theme} m={m} />
    case 'quote':
      return <QuoteCard spec={spec} theme={theme} m={m} />
    case 'points':
      return <PointsCard spec={spec} theme={theme} m={m} />
    case 'section':
      return <SectionCard spec={spec} theme={theme} m={m} />
    case 'stat':
      return <StatCard spec={spec} theme={theme} m={m} />
    case 'toc':
      return <TocCard spec={spec} theme={theme} m={m} />
    case 'compare':
      return <CompareCard spec={spec} theme={theme} m={m} />
    case 'cta':
      return <CtaCard spec={spec} theme={theme} m={m} />
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
