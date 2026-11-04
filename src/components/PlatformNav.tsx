import { cardPlatform, convertPlatforms, rewritePlatforms } from '../renderers'

type JobStatus = 'idle' | 'running' | 'done' | 'error'

interface Props {
  active: string
  onSelect: (id: string) => void
  /** 每个改写平台各自的状态，切换 tab 不丢 */
  platformStatus: Record<string, JobStatus>
}

/** 单个汉字做「图标」：比一排灰色徽章好扫，也不用引图标库 */
const MONOGRAM: Record<string, string> = {
  sspai: '少',
  zhihu: '知',
  wechat: '公',
  douban: '豆',
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
}: {
  id: string
  name: string
  hint: string
  badge: string
  active: boolean
  onSelect: (id: string) => void
  dot?: 'ok' | 'warn' | 'error' | 'idle'
}) {
  return (
    <button className={`nav-item ${active ? 'active' : ''}`} onClick={() => onSelect(id)} title={hint}>
      <span className="nav-mark" aria-hidden>
        {MONOGRAM[id] ?? '·'}
      </span>
      <span className="nav-item-body">
        <span className="nav-item-name">{name}</span>
        <span className="nav-item-meta">{hint}</span>
      </span>
      {dot && dot !== 'idle' ? <span className={`dot dot-${dot}`} /> : null}
      <span className="nav-badge">{badge}</span>
    </button>
  )
}

export function PlatformNav({ active, onSelect, platformStatus }: Props) {
  const dotOf = (id: string): 'ok' | 'warn' | 'error' | 'idle' => {
    const s = platformStatus[id] ?? 'idle'
    if (s === 'running') return 'warn'
    if (s === 'done') return 'ok'
    if (s === 'error') return 'error'
    return 'idle'
  }

  return (
    <div className="side-section nav-section">
      <div className="side-title">
        <span>发布到</span>
        <span className="count">{convertPlatforms.length + rewritePlatforms.length + 1}</span>
      </div>

      <div className="nav-group">
        <div className="nav-group-label">格式转换 · 无需 AI</div>
        {convertPlatforms.map((p) => (
          <NavItem
            key={p.id}
            id={p.id}
            name={p.name}
            hint={p.hint}
            badge="转换"
            active={active === p.id}
            onSelect={onSelect}
          />
        ))}
      </div>

      <div className="nav-group">
        <div className="nav-group-label">内容改写 · 需要大模型</div>
        {rewritePlatforms.map((p) => (
          <NavItem
            key={p.id}
            id={p.id}
            name={p.name}
            hint={p.hint}
            badge="AI"
            active={active === p.id}
            onSelect={onSelect}
            dot={dotOf(p.id)}
          />
        ))}
      </div>

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
    </div>
  )
}
