import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 平台通过 PORT 环境变量注入端口，必须优先使用；本地开发时回退到 5183。
const port = Number(process.env.PORT) || 5183

export default defineConfig({
  plugins: [react()],
  // 相对路径：同一份产物既能挂在 publish.hulatu.com 根目录，
  // 也能挂在 hulatu.github.io/Publishing_Platform/ 这种子路径下，不用改配置。
  base: './',
  server: {
    // 部署环境通过反向代理访问，必须监听 0.0.0.0 并放行代理域名，
    // 否则 Vite 会返回 "Blocked request. This host is not allowed."
    host: '0.0.0.0',
    port,
    strictPort: true,
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port,
    allowedHosts: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
