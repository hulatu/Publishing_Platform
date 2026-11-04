/**
 * 临时预览页（只在本地核对视觉用，不参与构建）
 * /cards-preview.html?theme=paper      → 四张卡横排
 * /cards-preview.html?picker=1         → 主题墙
 */

import { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { CardRenderer } from '../cards/templates'
import { getCardTheme } from '../cards/themes'
import type { CardSpec } from '../cards/types'
import { ThemePicker } from '../components/ThemePicker'
import '../styles/global.css'

const SPECS: CardSpec[] = [
  {
    id: 'cover',
    layout: 'cover',
    title: '我为什么把写作流程拆成七段',
    subtitle: '把一件靠灵感的事，改成一件靠流程的事。',
    kicker: '方法论',
    footer: '胡拉图说',
    date: '2026.11.03',
    themeId: 'paper',
  },
  {
    id: 'quote',
    layout: 'quote',
    title: '真正的效率不是写得快，而是改得少。',
    subtitle: '—— 摘自本文',
    kicker: '方法论',
    footer: '胡拉图说',
    date: '2026.11.03',
    themeId: 'paper',
  },
  {
    id: 'points',
    layout: 'points',
    title: '这篇文章讲了什么',
    points: [
      '先把素材拆成事实、观点、例子三类',
      '每一节只留一个论点，删掉并列的第二个',
      '初稿写完先放一夜，第二天只改结构',
      '定稿前朗读一遍，卡住的地方就是要改的地方',
    ],
    kicker: '要点',
    footer: '胡拉图说',
    date: '2026.11.03',
    themeId: 'paper',
  },
  {
    id: 'end',
    layout: 'end',
    title: '写作不是表达，是把想法重新排一次序。',
    subtitle: '#写作　#流程　#长期主义',
    kicker: '结语',
    footer: '胡拉图说',
    date: '2026.11.03',
    themeId: 'paper',
  },
]

/** ?stress=1：把字数顶到上限，看会不会溢出到页脚 */
const STRESS: Record<string, Partial<CardSpec>> = {
  cover: { title: '我为什么把写作流程拆成七段，并且从此不再靠灵感写作' },
  quote: { title: '真正的效率不是写得快，而是改得少——把每一句话都当成一次可以被删除的候选。' },
  points: {
    title: '这篇文章讲了什么，以及你可以马上拿走的三件事',
    points: [
      '先把素材拆成事实、观点、例子三类，分类之后再动笔，避免一边写一边找材料',
      '每一节只留一个论点，删掉并列的第二个，读者一次只能记住一件事',
      '初稿写完先放一夜，第二天只改结构不改字句，改字句会把结构问题藏起来',
      '定稿前朗读一遍，卡住的地方就是要改的地方，朗读是最便宜的通顺检查',
      '最后再回头看标题和开头，它们必须回答「为什么值得读下去」这个问题',
    ],
  },
  end: { title: '写作不是表达，是把想法重新排一次序，然后把它交给一个具体的人。' },
}

function Cards({ themeId, stress }: { themeId: string; stress: boolean }) {
  const theme = getCardTheme(themeId)
  return (
    <div style={{ display: 'flex', gap: 24, padding: 24, background: '#ddd' }}>
      {SPECS.map((s) => (
        <div key={s.id} data-card={s.id}>
          <CardRenderer spec={{ ...s, themeId, ...(stress ? STRESS[s.id] : {}) }} theme={theme} />
        </div>
      ))}
    </div>
  )
}

function Picker() {
  const autoOpen = new URLSearchParams(location.search).get('open') === '1'
  useEffect(() => {
    if (!autoOpen) return
    const t = setTimeout(() => {
      const bar = document.querySelector<HTMLButtonElement>('.theme-bar')
      bar?.click()
    }, 120)
    return () => clearTimeout(t)
  }, [autoOpen])
  return (
    <div style={{ padding: 0, background: 'var(--main-bg)', minHeight: '100vh' }}>
      <ThemePicker value="paper" onChange={() => {}} />
    </div>
  )
}

const params = new URLSearchParams(location.search)
const root = createRoot(document.getElementById('root')!)
root.render(
  params.get('picker') ? (
    <Picker />
  ) : (
    <Cards themeId={params.get('theme') ?? 'paper'} stress={params.get('stress') === '1'} />
  ),
)
