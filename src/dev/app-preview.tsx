/**
 * 临时预览页（只在本地核对视觉用，不参与构建）
 *
 * 入口是 /dev/app-preview.html —— 注意不在根路径。根路径的 /app-preview.html
 * 会被 vite 的 SPA 回退兜到 index.html，那样载入的是正式 App，不是这个壳子，
 * 表现是「页面正常但永远是空状态」，很容易误判成数据加载坏了。
 *
 * /dev/app-preview.html             → 载入 fixture 后停在公众号
 * /dev/app-preview.html?open=ledger|check|images|meta|tail|drafts
 * 另有 seed=1 / tail=full / drafts=full / run=1 / tab=preview / scroll=bottom
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

        // ?seed=1：先写几条台账，方便看「已发」态与复盘
        if (params.get('seed') === '1') {
          const title = /^title:\s*"?(.+?)"?\s*$/m.exec(src)?.[1] ?? '未命名'
          const at = new Date().toISOString()
          localStorage.setItem(
            'ad.publish-ledger.v1',
            JSON.stringify({
              [title]: {
                wechat: { at, url: 'https://mp.weixin.qq.com/s/demo', stats: { read: 3820, like: 96, comment: 21, fav: 148 } },
                zhihu: { at, stats: { read: 12600, like: 210, comment: 64 } },
                xiaohongshu: { at, stats: { read: 8700, like: 640, comment: 88, fav: 410 } },
                douban: { at },
              },
              'why-i-write': {
                wechat: {
                  at: '2026-10-02T09:00:00.000Z',
                  stats: { read: 2100, like: 40, comment: 8, fav: 60 },
                },
                jike: { at: '2026-10-02T09:10:00.000Z', stats: { read: 640, like: 33 } },
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
                : open === 'drafts'
                  ? '.drafts-entry'
                  : open === 'review'
                    ? '.review-entry'
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
      // ?rtab=all：复盘弹层切到「全部」
      if (params.get('rtab') === 'all') {
        setTimeout(() => {
          document.querySelectorAll<HTMLButtonElement>('.rev-tabs button')[1]?.click()
        }, 300)
      }
      // ?pick=N：点草稿箱第 N 行的「打开」，用来核对恢复流程
      const pick = Number(params.get('pick') ?? '0')
      if (pick > 0) {
        setTimeout(() => {
          const rows = document.querySelectorAll<HTMLElement>('.drafts-body .draft-row')
          rows[pick - 1]?.querySelector<HTMLButtonElement>('.btn-primary')?.click()
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

// ?drafts=full：同样要在 App 挂载前写盘（drafts 的初值就是 listDrafts()）
if (bootParams.get('drafts') === 'full') {
  const at = (h: number) => new Date(Date.now() - h * 3600_000).toISOString()
  const body = 'x'.repeat(4800)
  const seed = {
    'why-i-write': {
      key: 'why-i-write',
      title: '我为什么把写作流程拆成七段',
      fileName: 'why-i-write.md',
      source: body,
      fingerprint: '6:2418',
      meta: { title: '我为什么把写作流程拆成七段', categories: [], tags: [], summary: '', description: '', extra: {} },
      tone: 'original',
      themeId: 'paper',
      platform: 'wechat',
      digest: {
        status: 'done',
        streaming: '',
        digest: { sections: [{ index: 1, heading: 'a', summary: 'b' }], oneLiner: 'c' },
        error: null,
        fallback: false,
        retries: 0,
        providerLabel: 'DeepSeek',
      },
      platformStates: {
        xiaohongshu: { status: 'done', streaming: '', result: { xhs: { title: 't', body: 'b', tags: [] } }, error: null, fallback: false, retries: 0, providerLabel: 'DeepSeek' },
        twitter: { status: 'done', streaming: '', result: { twitter: { thread: ['a'] } }, error: null, fallback: false, retries: 0, providerLabel: 'DeepSeek' },
        jike: { status: 'idle', streaming: '', result: null, error: null, fallback: false, retries: 0, providerLabel: '' },
        weibo: { status: 'done', streaming: '', result: { weibo: { text: 'x', topics: [] } }, error: null, fallback: false, retries: 0, providerLabel: 'DeepSeek' },
      },
      metaLab: {
        status: 'done',
        streaming: '',
        result: { titles: [{ text: 'a', style: 'statement' }], tags: [] },
        error: null,
        fallback: false,
        retries: 0,
        providerLabel: 'DeepSeek',
      },
      updatedAt: at(0.2),
    },
    'ledger-retro': {
      key: 'ledger-retro',
      title: '110 篇博客要发 8 个平台，我是怎么做的',
      fileName: 'ledger-retro.md',
      source: body,
      fingerprint: '9:6120',
      meta: { title: '110 篇博客要发 8 个平台，我是怎么做的', categories: [], tags: [], summary: '', description: '', extra: {} },
      tone: 'light',
      themeId: 'ink',
      platform: 'xiaohongshu',
      digest: {
        status: 'done',
        streaming: '',
        digest: { sections: [], oneLiner: 'c' },
        error: null,
        fallback: false,
        retries: 0,
        providerLabel: 'DeepSeek',
      },
      platformStates: {
        xiaohongshu: { status: 'idle', streaming: '', result: null, error: null, fallback: false, retries: 0, providerLabel: '' },
        twitter: { status: 'idle', streaming: '', result: null, error: null, fallback: false, retries: 0, providerLabel: '' },
        jike: { status: 'idle', streaming: '', result: null, error: null, fallback: false, retries: 0, providerLabel: '' },
        weibo: { status: 'idle', streaming: '', result: null, error: null, fallback: false, retries: 0, providerLabel: '' },
      },
      metaLab: { status: 'idle', streaming: '', result: null, error: null, fallback: false, retries: 0, providerLabel: '' },
      updatedAt: at(6),
    },
    'plain-one': {
      key: 'plain-one',
      title: '关于「坚持」这件事的一点怀疑',
      fileName: 'plain-one.md',
      source: body,
      fingerprint: '4:1902',
      meta: { title: '关于「坚持」这件事的一点怀疑', categories: [], tags: [], summary: '', description: '', extra: {} },
      tone: 'original',
      themeId: 'paper',
      platform: 'wechat',
      digest: { status: 'idle', streaming: '', digest: null, error: null, fallback: false, retries: 0, providerLabel: '' },
      platformStates: {
        xiaohongshu: { status: 'idle', streaming: '', result: null, error: null, fallback: false, retries: 0, providerLabel: '' },
        twitter: { status: 'idle', streaming: '', result: null, error: null, fallback: false, retries: 0, providerLabel: '' },
        jike: { status: 'idle', streaming: '', result: null, error: null, fallback: false, retries: 0, providerLabel: '' },
        weibo: { status: 'idle', streaming: '', result: null, error: null, fallback: false, retries: 0, providerLabel: '' },
      },
      metaLab: { status: 'idle', streaming: '', result: null, error: null, fallback: false, retries: 0, providerLabel: '' },
      updatedAt: at(30),
    },
  }
  localStorage.setItem('ad.drafts.v1', JSON.stringify(seed))
}

createRoot(document.getElementById('root')!).render(<Harness />)