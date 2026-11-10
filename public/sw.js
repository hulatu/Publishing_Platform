/**
 * 离线壳
 *
 * 目标很克制：断网时还能打开界面、看到已导入的文章和草稿箱。
 * 不做「离线也能生成」—— 那需要把大模型请求也缓存掉，没有意义。
 *
 * 三条策略，各管一件事：
 * - 导航请求 → network-first。在线永远拿最新 HTML，发版后不会卡在旧版本；
 *   断网才回退缓存。这一条是「能不能安全地用 SW」的关键。
 * - /assets/* → cache-first。文件名带内容哈希，内容变了名字就变了，
 *   缓存永远不会命中错的东西。
 * - 其它同源静态资源 → stale-while-revalidate。
 *
 * 跨域请求（AI 接口、图片）一律不碰，直接放行。
 */

// 构建时由 vite.config.ts 的 sw-version 插件替换成 git 短 hash。
// 手改这里没用 —— 下次构建会被覆盖；版本号变了，缓存名跟着变，旧缓存由 activate 清掉。
const VERSION = '__APP_VERSION__'
const SHELL = `shell-${VERSION}`
const RUNTIME = `runtime-${VERSION}`

// 只预缓存入口：assets 的哈希写在 index.html 里，构建时才知道
const SHELL_URLS = ['./', './index.html', './site.webmanifest']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== SHELL && k !== RUNTIME).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  // 导航：先网络，失败才吃缓存
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // 只缓存成功的入口：404 / 500 的错误页也写进 ./index.html，
          // 下次断网打开的就是那张错误页。
          if (res.ok) {
            const copy = res.clone()
            caches.open(SHELL).then((c) => c.put('./index.html', copy))
          }
          return res
        })
        .catch(() =>
          caches.match('./index.html').then((hit) => hit || caches.match('./')),
        ),
    )
    return
  }

  // 带哈希的产物：缓存优先，永不失效
  if (url.pathname.indexOf('/assets/') !== -1) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone()
              caches.open(RUNTIME).then((c) => c.put(req, copy))
            }
            return res
          }),
      ),
    )
    return
  }

  // 图标 / manifest：先用缓存，后台顺手更新
  event.respondWith(
    caches.match(req).then((hit) => {
      const network = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(RUNTIME).then((c) => c.put(req, copy))
          }
          return res
        })
        .catch(() => hit)
      return hit || network
    }),
  )
})
