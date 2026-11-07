import { cardPlatform, convertPlatforms, rewritePlatforms } from '../renderers'
import { sortByWidth } from '../core/platform-visibility'

type JobStatus = 'idle' | 'running' | 'done' | 'error'

interface Props {
  active: string
  onSelect: (id: string) => void
  /** 每个改写平台各自的状态，切换 tab 不丢 */
  platformStatus: Record<string, JobStatus>
  /** 发布台账：已发过的平台 id → 记录 */
  published: Record<string, { at: string }>
  /** 被隐藏的平台 id；只影响显示 */
  hidden: Set<string>
  /** 打开「显示哪些平台」面板 */
  onOpenFilter: () => void
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

function NavItem({
  id,
  name,
  hint,
  badge,
  active,
  onSelect,
  dot,
  published,
}: {
  id: string
  name: string
  hint: string
  badge: string
  active: boolean
  onSelect: (id: string) => void
  dot?: 'ok' | 'warn' | 'error' | 'idle'
  /** 已发过：名字后面挂个勾，扫一眼就知道还剩几个平台 */
  published?: boolean
}) {
  return (
    <button
      className={`nav-item ${active ? 'active' : ''} ${published ? 'published' : ''}`}
      onClick={() => onSelect(id)}
      title={published ? `${hint} · 已发布` : hint}
    >
      <span className="nav-mark" aria-hidden>
        {MONOGRAM[id] ?? '·'}
      </span>
      <span className="nav-item-body">
        <span className="nav-item-name">{name}</span>
        <span className="nav-item-meta">{hint}</span>
      </span>
      {published ? (
        <span className="nav-check" aria-label="已发布">
          ✓
        </span>
      ) : null}
      {dot && dot !== 'idle' ? <span className={`dot dot-${dot}`} /> : null}
      <span className="nav-badge">{badge}</span>
    </button>
  )
}

export function PlatformNav({
  active,
  onSelect,
  platformStatus,
  published,
  hidden,
  onOpenFilter,
}: Props) {
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

  // 分母只算「列表里看得见的」，否则隐藏两个平台后「已发 3/11」会永远凑不满
  const visibleIds = new Set([...convertList, ...rewriteList].map((p) => p.id))
  const total = visibleIds.size
  const done = Object.keys(published).filter((id) => visibleIds.has(id)).length
  const hiddenCount = hidden.size

  return (
    <div className="side-section nav-section">
      <div className="side-title">
        <span>发布到</span>
        <span className="side-title-right">
          <span className={`count ${done === total && total > 0 ? 'all-done' : ''}`}>
            {done > 0 ? `已发 ${done}/${total}` : total}
          </span>
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
        <div className="nav-group">
          <div className="nav-group-label">格式转换 · 无需 AI</div>
          {convertList.map((p) => (
            <NavItem
              key={p.id}
              id={p.id}
              name={p.name}
              hint={p.hint}
              badge="转换"
              active={active === p.id}
              onSelect={onSelect}
              published={Boolean(published[p.id])}
            />
          ))}
        </div>
      ) : null}

      {rewriteList.length > 0 ? (
        <div className="nav-group">
          <div className="nav-group-label">内容改写 · 需要大模型</div>
          {rewriteList.map((p) => (
            <NavItem
              key={p.id}
              id={p.id}
              name={p.name}
              hint={p.hint}
              badge="AI"
              active={active === p.id}
              onSelect={onSelect}
              dot={dotOf(p.id)}
              published={Boolean(published[p.id])}
            />
          ))}
        </div>
      ) : null}

      {showCards ? (
        <div className="nav-group">
          <div className="nav-group-label">配图</div>
          <NavItem
            id={cardPlatform.id}
            name={cardPlatform.name}
            hint={cardPlatform.hint}
            badge="出图"
            active={active === cardPlatform.id}
            onSelect={onSelect}
          />
        </div>
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
