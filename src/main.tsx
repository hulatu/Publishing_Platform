import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { applyPreconnect, byokConfigured, loadByok } from './ai/provider'
import { isCloudConfigured } from './cloud/config'
import { hasUnsplashKey } from './core/unsplash'
import './styles/global.css'

// 上次填过的服务商先预连接：等用户点「生成」时，握手已经做完了。
// 只在真的配了 Key 时才连 —— 没配的人不该因为打开页面就跟第三方 API 建连接。
const savedByok = loadByok()
if (byokConfigured(savedByok)) applyPreconnect(savedByok.endpoint)
// 云服务走 jsDelivr 拉 SDK：配好就先把 cdn.jsdelivr.net 的握手做了
if (isCloudConfigured()) applyPreconnect('https://cdn.jsdelivr.net')
// 填了 Unsplash Key：封面搜索走 api.unsplash.com
if (hasUnsplashKey()) applyPreconnect('https://api.unsplash.com')

const root = document.getElementById('root')
if (!root) throw new Error('找不到 #root 挂载点')

createRoot(root).render(
  <StrictMode>
    {/* 兜住整棵树的渲染异常：数据都在 localStorage 里，白屏等于让用户以为丢了 */}
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)

// Service Worker 的注册 / 更新提示统一放在 App 的 useAppUpdate 里：
// 新版本不再自动 skipWaiting，而是等用户点“新版本”后刷新。
