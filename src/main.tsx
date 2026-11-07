import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { applyPreconnect, byokConfigured, loadByok } from './ai/provider'
import './styles/global.css'

// 上次填过的服务商先预连接：等用户点「生成」时，握手已经做完了。
// 只在真的配了 Key 时才连 —— 没配的人不该因为打开页面就跟第三方 API 建连接。
const savedByok = loadByok()
if (byokConfigured(savedByok)) applyPreconnect(savedByok.endpoint)

const root = document.getElementById('root')
if (!root) throw new Error('找不到 #root 挂载点')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// 离线壳。只在生产构建里注册 —— 开发时 SW 会缓存 Vite 的模块请求，
// 改代码不生效，排查起来能浪费半小时。
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // 注册失败不影响在线使用，静默即可
    })
  })
}
