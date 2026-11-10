import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// 平台通过 PORT 环境变量注入端口，必须优先使用；本地开发时回退到 5183。
const port = Number(process.env.PORT) || 5183

/**
 * 发版号：git 短 hash，没有 git 时回退到 'dev'。
 * 只在构建时算一次；SW 缓存名用它，版本变了旧缓存由 activate 清掉。
 */
function appVersion(): string {
  try {
    return execSync('git rev-parse --short HEAD', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return 'dev'
  }
}

const version = appVersion()

/**
 * 把版本号注入 public/sw.js。
 *
 * public/ 下的文件构建时原样复制，Vite 的 define 够不着它；
 * 而 generateBundle 里还看不到它（public 文件是写盘时才复制过去的），
 * 所以用 writeBundle：等 dist/sw.js 落盘后再读出来换掉占位符。
 */
const swVersionPlugin: Plugin = {
  name: 'sw-version',
  writeBundle(options) {
    const file = join(options.dir ?? 'dist', 'sw.js')
    let text: string
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      return
    }
    if (!text.includes('__APP_VERSION__')) {
      console.warn('[sw-version] sw.js 里没有 __APP_VERSION__，版本号没注入')
      return
    }
    writeFileSync(file, text.replaceAll('__APP_VERSION__', version))
  },
}

export default defineConfig({
  plugins: [react(), swVersionPlugin],
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
