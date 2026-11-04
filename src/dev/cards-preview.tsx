/**
 * 临时预览页（只在本地核对视觉用，不参与构建）
 * /cards-preview.html?theme=paper      → 四张卡横排
 * /cards-preview.html?picker=1         → 主题墙
 */

import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { CardRenderer } from '../cards/templates'
import { getCardTheme } from '../cards/themes'
import type { CardSpec, CardFormatId } from '../cards/types'
import { ThemePicker } from '../components/ThemePicker'
import { CardStudio } from '../components/CardStudio'
import { parseArticle } from '../core/parse'
import { splitSections } from '../core/sections'
import type { Doc } from '../core/ir'
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
    id: 'section',
    layout: 'section',
    title: '三、把初稿放一夜',
    subtitle:
      '写完当天不要改。第二天再看，你会发现真正的问题在结构上，而不在字句上——这也是为什么第一遍改稿只动结构，不动措辞。',
    kicker: '方法论',
    mark: '04 / 08',
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
  section: {
    title: '四、把初稿放一夜，第二天只改结构不动字句',
    subtitle:
      '写完当天不要改。第二天再看，你会发现真正的问题在结构上，而不在字句上——这也是为什么第一遍改稿只动结构，不动措辞。先把段落顺序调对，再逐句打磨，否则打磨的是一段本来就要删掉的话。',
  },
}

function Cards({ themeId, stress, formats }: { themeId: string; stress: boolean; formats: CardFormatId[] }) {
  const theme = getCardTheme(themeId)
  return (
    <div style={{ padding: 24, background: '#ddd' }}>
      {formats.map((f) => (
        <div key={f} style={{ marginBottom: 32 }}>
          <div style={{ font: '600 12px/1 -apple-system, sans-serif', color: '#555', marginBottom: 10 }}>
            {f}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20 }}>
            {SPECS.map((s) => (
              <div key={s.id} data-card={s.id} data-format={f}>
                <CardRenderer
                  spec={{ ...s, themeId, ...(stress ? STRESS[s.id] : {}) }}
                  theme={theme}
                  format={f}
                />
              </div>
            ))}
          </div>
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

/** ?studio=1：拿真实文章喂进 CardStudio，看整套面板（含卡片列表） */
function Studio() {
  const [doc, setDoc] = useState<Doc | null>(null)
  const [theme, setTheme] = useState('paper')
  const [site, setSite] = useState('胡拉图说')

  useEffect(() => {
    fetch('/scripts/fixtures/fixture-long.md')
      .then((r) => r.text())
      .then((src) => setDoc(parseArticle({ source: src, fileName: 'fixture-long.md' })))
  }, [])

  // ?drag=1：模拟把第 4 张卡拖到第 1 位，用来验证排序与页码重算
  useEffect(() => {
    if (!doc || new URLSearchParams(location.search).get('drag') !== '1') return
    const t = setTimeout(() => {
      const items = document.querySelectorAll<HTMLElement>('.card-item')
      if (items.length < 4) return
      const dt = new DataTransfer()
      items[3].dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }))
      items[0].dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt }))
      items[0].dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }))
      items[3].dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }))
    }, 300)
    return () => clearTimeout(t)
  }, [doc])

  if (!doc) return <div style={{ padding: 40 }}>加载中…</div>
  const sections = splitSections(doc)

  return (
    <div style={{ padding: 24, background: 'var(--main-bg)', minHeight: '100vh' }}>
      <div className="panel-card">
        <CardStudio
          doc={doc}
          sections={sections}
          summaries={null}
          cardThemeId={theme}
          onThemeChange={setTheme}
          siteName={site}
          onSiteNameChange={setSite}
          onToast={() => {}}
        />
      </div>
    </div>
  )
}

const params = new URLSearchParams(location.search)
const root = createRoot(document.getElementById('root')!)
const fmtParam = params.get('fmt')
const formats: CardFormatId[] = params.get('allformats')
  ? ['3:4', '1:1', '16:9']
  : fmtParam === '1:1' || fmtParam === '16:9'
    ? [fmtParam]
    : ['3:4']

root.render(
  params.get('studio') ? (
    <Studio />
  ) : params.get('picker') ? (
    <Picker />
  ) : (
    <Cards
      themeId={params.get('theme') ?? 'paper'}
      stress={params.get('stress') === '1'}
      formats={formats}
    />
  ),
)
