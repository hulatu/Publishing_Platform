/**
 * 临时预览页（只在本地核对视觉用，不参与构建）
 * /app-preview.html            → 载入 fixture 后停在公众号
 * /app-preview.html?open=ledger|check|images
 */

import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import App from '../App'
import '../styles/global.css'

function Harness() {
  const [ready, setReady] = useState(false)
  const params = new URLSearchParams(location.search)
  const open = params.get('open')
  const docPath = params.get('doc') ?? '/scripts/fixtures/fixture-long.md'

  useEffect(() => {
    let cancelled = false
    fetch(docPath)
      .then((r) => r.text())
      .then((src) => {
        if (cancelled) return

        // ?seed=1：先写几条台账，方便看「已发」态
        if (params.get('seed') === '1') {
          const title = /^title:\s*"?(.+?)"?\s*$/m.exec(src)?.[1] ?? '未命名'
          const at = new Date().toISOString()
          localStorage.setItem(
            'ad.publish-ledger.v1',
            JSON.stringify({
              [title]: {
                wechat: { at, url: 'https://mp.weixin.qq.com/s/demo' },
                zhihu: { at },
                xiaohongshu: { at },
              },
            }),
          )
        }

        // ?tail=full：塞一份「三块全开」的文末配置，方便看预览
        const input = document.querySelector<HTMLInputElement>('input[type=file]')
        if (!input) return
        const name = docPath.split('/').pop() ?? 'article.md'
        const file = new File([src], name, { type: 'text/markdown' })
        const dt = new DataTransfer()
        dt.items.add(file)
        input.files = dt.files
        input.dispatchEvent(new Event('change', { bubbles: true }))
        setTimeout(() => setReady(true), 400)
        // ?scroll=bottom：滚到预览区底部，用来看文末三块有没有真的拼上去
        if (params.get('scroll') === 'bottom') {
          setTimeout(() => {
            const el = document.querySelector<HTMLElement>('.preview-scroll')
            if (el) el.scrollTop = el.scrollHeight
          }, 900)
        }
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docPath])

  useEffect(() => {
    if (!ready || !open) return
    const sel =
      open === 'ledger'
        ? '.ledger-entry'
        : open === 'check'
          ? '.check-chip'
          : open === 'images'
            ? '.img-entry'
            : open === 'meta'
              ? '.meta-entry'
              : open === 'tail'
                ? '.tail-entry'
                : ''
    if (!sel) return
    const t = setTimeout(() => {
      document.querySelector<HTMLButtonElement>(sel)?.click()
      // ?run=1：再点一下弹层里的主按钮（本地兜底会立刻出结果，方便截图）
      if (params.get('run') === '1') {
        setTimeout(() => {
          document.querySelector<HTMLButtonElement>('.modal-foot .btn-primary')?.click()
        }, 300)
      }
      // ?tab=preview：文末弹层切到预览页
      if (params.get('tab') === 'preview') {
        setTimeout(() => {
          document.querySelectorAll<HTMLButtonElement>('.tail-tabs button')[1]?.click()
        }, 300)
      }
    }, 200)
    return () => clearTimeout(t)
  }, [ready, open])

  return <App />
}

// ?tail=full：必须在 App 挂载前写盘 —— 账号名和文末配置都是 useState 的初值，
// 在 fetch 回调里写就晚了（组件早就用默认值初始化过了）
const bootParams = new URLSearchParams(location.search)
if (bootParams.get('tail') === 'full') {
  localStorage.setItem('ad.wechat-account', '胡拉图说')
  localStorage.setItem(
    'ad.wechat-tail.v1',
    JSON.stringify({
      follow: {
        on: true,
        title: '关于作者',
        text: '如果这篇内容对你有用，欢迎关注「{account}」，每周更新一篇长文。',
      },
      history: {
        on: true,
        title: '往期推荐',
        items: [
          { title: '我为什么把写作流程拆成七段', url: 'https://hulatu.com/a' },
          { title: '110 篇博客要发 8 个平台，我是怎么做的', url: '' },
          { title: '关于「坚持」这件事的一点怀疑', url: '' },
        ],
      },
      copyright: { on: true, text: '© {year} {account} · 转载请注明出处与原文链接' },
    }),
  )
}

createRoot(document.getElementById('root')!).render(<Harness />)
