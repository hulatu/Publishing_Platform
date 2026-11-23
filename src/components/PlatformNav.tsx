import { useCallback, useState, type ReactNode } from 'react'
import { cardPlatform, convertPlatforms, rewritePlatforms } from '../renderers'
import { sortByWidth } from '../core/platform-visibility'
import type { ArticleLedger } from '../core/ledger'
import { ariaShortcut, shortcutLabel } from '../core/keys'

type JobStatus = 'idle' | 'running' | 'done' | 'error'

interface Props {
  active: string
  onSelect: (id: string) => void
  /** 每个改写平台各自的状态，切换 tab 不丢 */
  platformStatus: Record<string, JobStatus>
  /** 发布台账：已发过的平台 id → 记录 */
  published: ArticleLedger
  /** 被隐藏的平台 id；只影响显示 */
  hidden: Set<string>
  /** 打开「显示哪些平台」面板 */
  onOpenFilter: () => void
  /** 打开 ⌘K 快速切换 */
  onQuickSwitch: () => void
}

/** 单个汉字做「图标」：比一排灰色徽章好扫，也不用引图标库 */
const MONOGRAM: Record<string, string> = {
  sspai: '少',
  zhihu: '知',
  wechat: '公',
  douban: '豆',
  bilibili: 'B',
  toutiao: '头',
  baijiahao: '百',
  xiaohongshu: '小',
  twitter: '推',
  jike: '即',
  weibo: '微',
  cards: '图',
}

/* ------------------------------------------------------------------ */
/* 分组折叠记忆                                                         */
/* ------------------------------------------------------------------ */

const COLLAPSE_KEY = 'ad.navCollapsed.v1'

/** 默认全展开。读不到（隐私模式）就当没折叠过，不影响使用 */
function loadCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY)
    if (!raw) return new Set()
    const arr: unknown = JSON.parse(raw)
    if (!Array.isArray(arr)) return new Set()
    return new Set(arr.filter((k): k is string => typeof k === 'string'))
  } catch {
    return new Set()
  }
}

function saveCollapsed(set: Set<string>): void {
  try {
    localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...set]))
  } catch {
    // 存不住就只在本次会话生效
  }
}

/* ------------------------------------------------------------------ */

/** 侧栏状态点对读屏的说法 */
const DOT_LABEL: Record<'ok' | 'warn' | 'error' | 'idle', string> = {
  ok: '文案已生成',
  warn: '正在生成',
  error: '生成失败',
  idle: '',
}

function NavItem({
  id,
  name,
  hint,
  active,
  onSelect,
  dot,
  published,
  prepared,
}: {
  id: string
  name: string
  hint: string
  active: boolean
  onSelect: (id: string) => void
  dot?: 'ok' | 'warn' | 'error' | 'idle'
  /** 已发过：名字后面挂个勾，扫一眼就知道还剩几个平台 */
  published?: boolean
  /** 已复制但还没确认真发布 */
  prepared?: boolean
}) {
  return (
    <button
      className={`nav-item ${active ? 'active' : ''} ${published ? 'published' : ''} ${prepared ? 'prepared' : ''}`}
      onClick={() => onSelect(id)}
      title={published ? `${hint} · 已发布` : hint}
      /* 读屏用户看不到 .active 这个 class，只能靠 aria-current 知道自己在哪家 */
      aria-current={active ? 'page' : undefined}
    >
      <span className="nav-mark" aria-hidden>
        {MONOGRAM[id] ?? '·'}
      </span>
      <span className="nav-item-body">
        <span className="nav-item-name">{name}</span>
      </span>
      {published ? (
        // role="img" + label：符号本身没有语义，直接把意思给读屏
        <span className="nav-check" role="img" aria-label="已发布">
          ✓
        </span>
      ) : null}
      {prepared ? (
        <span className="nav-prepared" role="img" aria-label="已复制，待发布">
          待发
        </span>
      ) : null}
      {dot && dot !== 'idle' ? (
        <span className={`dot dot-${dot}`} role="img" aria-label={DOT_LABEL[dot]} />
      ) : null}
    </button>
  )
}

/**
 * 分组标题可折叠。
 *
 * 11 个平台全部平铺仍会挤占主操作空间；每一行保持单行，
 * 平台说明由主标题区域统一展示，侧栏只负责选择。
 *
 * 收起时标题右侧显示「组里几个」，如果当前平台正好在这个组里，就改显示它的名字
 * （否则折叠后看不出自己在哪一组）。
 */
function NavGroup({
  label,
  count,
  collapsed,
  onToggle,
  activeName,
  children,
}: {
  label: string
  count: number
  collapsed: boolean
  onToggle: () => void
  activeName: string | null
  children: ReactNode
}) {
  return (
    <div className={`nav-group ${collapsed ? 'is-collapsed' : ''}`}>
      <button
        type="button"
        className="nav-group-label"
        onClick={onToggle}
        aria-expanded={!collapsed}
        title={`${collapsed ? '展开' : '收起'}「${label}」`}
      >
        <span className={`caret ${collapsed ? '' : 'open'}`} aria-hidden>
          ▶
        </span>
        <span className="nav-group-name">{label}</span>
        {collapsed ? (
          <span className={`nav-group-fold ${activeName ? 'on' : ''}`}>
            {activeName ?? `${count} 个`}
          </span>
        ) : null}
      </button>
      {collapsed ? null : children}
    </div>
  )
}

export function PlatformNav({
  active,
  onSelect,
  platformStatus,
  published,
  hidden,
  onOpenFilter,
  onQuickSwitch,
}: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed)

  const toggle = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      saveCollapsed(next)
      return next
    })
  }, [])

  const dotOf = (id: string): 'ok' | 'warn' | 'error' | 'idle' => {
    const s = platformStatus[id] ?? 'idle'
    if (s === 'running') return 'warn'
    if (s === 'done') return 'ok'
    if (s === 'error') return 'error'
    return 'idle'
  }

  // 每个板块内部按名字长短排（短的在上），再滤掉被隐藏的
  const convertList = sortByWidth(convertPlatforms.filter((p) => !hidden.has(p.id)))
  const rewriteList = sortByWidth(rewritePlatforms.filter((p) => !hidden.has(p.id)))
  const showCards = !hidden.has(cardPlatform.id)

  const hiddenCount = hidden.size

  const activeIn = (list: { id: string; name: string }[]) =>
    list.some((p) => p.id === active) ? (list.find((p) => p.id === active)?.name ?? null) : null

  return (
    <div className="side-section nav-section">
      <div className="side-title">
        <span>发布到</span>
        <span className="side-title-right">
          <button
            className="nav-kbd"
            onClick={onQuickSwitch}
            title={`快速切换平台（${shortcutLabel('K')}）`}
            aria-label="快速切换平台"
            aria-keyshortcuts={ariaShortcut('K')}
          >
            {shortcutLabel('K')}
          </button>
          <button
            className={`nav-filter-btn ${hiddenCount > 0 ? 'has-hidden' : ''}`}
            onClick={onOpenFilter}
            title="选择显示哪些平台。隐藏只影响列表，不影响台账和生成。"
          >
            筛选
            {hiddenCount > 0 ? <span className="nav-filter-badge">{hiddenCount}</span> : null}
          </button>
        </span>
      </div>

      {convertList.length > 0 ? (
        <NavGroup
          label="直接转换"
          count={convertList.length}
          collapsed={collapsed.has('convert')}
          onToggle={() => toggle('convert')}
          activeName={activeIn(convertList)}
        >
          {convertList.map((p) => (
            <NavItem
              key={p.id}
              id={p.id}
              name={p.name}
              hint={p.hint}
              active={active === p.id}
              onSelect={onSelect}
              published={Boolean(published[p.id]?.at)}
              prepared={!published[p.id]?.at && Boolean(published[p.id]?.copiedAt)}
            />
          ))}
        </NavGroup>
      ) : null}

      {rewriteList.length > 0 ? (
        <NavGroup
          label="AI 改写"
          count={rewriteList.length}
          collapsed={collapsed.has('rewrite')}
          onToggle={() => toggle('rewrite')}
          activeName={activeIn(rewriteList)}
        >
          {rewriteList.map((p) => (
            <NavItem
              key={p.id}
              id={p.id}
              name={p.name}
              hint={p.hint}
              active={active === p.id}
              onSelect={onSelect}
              dot={dotOf(p.id)}
              published={Boolean(published[p.id]?.at)}
              prepared={!published[p.id]?.at && Boolean(published[p.id]?.copiedAt)}
            />
          ))}
        </NavGroup>
      ) : null}

      {showCards ? (
        <NavGroup
          label="配图"
          count={1}
          collapsed={collapsed.has('cards')}
          onToggle={() => toggle('cards')}
          activeName={active === cardPlatform.id ? cardPlatform.name : null}
        >
          <NavItem
            id={cardPlatform.id}
            name={cardPlatform.name}
            hint={cardPlatform.hint}
            active={active === cardPlatform.id}
            onSelect={onSelect}
          />
        </NavGroup>
      ) : null}

      {convertList.length === 0 && rewriteList.length === 0 && !showCards ? (
        <div className="nav-empty">
          全部平台都被隐藏了。
          <button className="nav-empty-btn" onClick={onOpenFilter}>
            打开筛选
          </button>
        </div>
      ) : null}
    </div>
  )
}
