import { defineConfig, devices } from '@playwright/test'

/**
 * 只跑一条浏览器冒烟。
 *
 * 剪贴板、复制顺序、Modal、文末 5+ 条这些只有真实浏览器能测；
 * Node 回归覆盖解析 / 渲染 / 对比度，两边不重复。
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5183',
    permissions: ['clipboard-read', 'clipboard-write'],
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5183',
    url: 'http://127.0.0.1:5183',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
