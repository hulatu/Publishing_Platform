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

        const input = document.querySelector<HTMLInputElement>('input[type=file]')
        if (!input) return
        const name = docPath.split('/').pop() ?? 'article.md'
        const file = new File([src], name, { type: 'text/markdown' })
        const dt = new DataTransfer()
        dt.items.add(file)
        input.files = dt.files
        input.dispatchEvent(new Event('change', { bubbles: true }))
        setTimeout(() => setReady(true), 400)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docPath])

  useEffect(() => {
    if (!ready || !open) return
    const sel =
      open === 'ledger' ? '.ledger-entry' : open === 'check' ? '.check-chip' : open === 'images' ? '.head-chip' : ''
    if (!sel) return
    const t = setTimeout(() => document.querySelector<HTMLButtonElement>(sel)?.click(), 200)
    return () => clearTimeout(t)
  }, [ready, open])

  return <App />
}

createRoot(document.getElementById('root')!).render(<Harness />)
