/**
 * 各平台的发布页地址
 *
 * 用途：复制成功后把发布页直接打开，省掉「切窗口 → 找入口」这一步。
 *
 * 这里**只做一件事：打开一个 URL**。不碰登录态、不填表单、不点发布 ——
 * 粘贴和发布仍然由人完成。原因见 README：11 个平台里只有公众号有官方发布通道，
 * 其余走「模拟操作」既违反平台条款，也会在平台改版时立刻失效。
 *
 * 平台改版时只改这个文件。带 note 的是没有稳定独立编辑页的，只能落到首页。
 */

export interface PublishTarget {
  url: string
  /** 打开之后是什么页面，需要人再点一步时提示用 */
  note?: string
}

export const PUBLISH_URLS: Record<string, PublishTarget> = {
  // 公众号的图文编辑页 URL 带一次性 token，没法直接拼，只能落到后台首页
  wechat: { url: 'https://mp.weixin.qq.com/', note: '登录后到「图文消息」新建' },
  sspai: { url: 'https://sspai.com/write' },
  zhihu: { url: 'https://zhuanlan.zhihu.com/write' },
  douban: { url: 'https://www.douban.com/note/create' },
  bilibili: { url: 'https://member.bilibili.com/platform/upload/text/edit' },
  toutiao: { url: 'https://mp.toutiao.com/profile_v4/graphic/publish' },
  baijiahao: { url: 'https://baijiahao.baidu.com/builder/rc/edit?type=news' },
  xiaohongshu: { url: 'https://creator.xiaohongshu.com/publish/publish' },
  twitter: { url: 'https://x.com/compose/post' },
  jike: { url: 'https://web.okjike.com/', note: '首页点「发布」' },
  weibo: { url: 'https://weibo.com/', note: '首页顶部的发布框' },
}

export function publishUrlOf(platformId: string): PublishTarget | null {
  return PUBLISH_URLS[platformId] ?? null
}

/* ------------------------------------------------------------------ */
/* 「复制后打开发布页」开关                                              */
/* ------------------------------------------------------------------ */

const PREF_KEY = 'ad.openPublishOnCopy.v1'

/** 默认开。读不到（隐私模式）也按开处理 —— 这是主要用法 */
export function loadOpenOnCopy(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) !== '0'
  } catch {
    return true
  }
}

export function saveOpenOnCopy(on: boolean): void {
  try {
    localStorage.setItem(PREF_KEY, on ? '1' : '0')
  } catch {
    // 存不住就只在本次会话生效，不影响功能
  }
}

/* ------------------------------------------------------------------ */
/* 打开新标签页                                                         */
/* ------------------------------------------------------------------ */

export interface PendingTab {
  /** 复制成功了，导航过去 */
  commit: () => void
  /** 复制失败了，把空白页关掉，别留一个白屏标签 */
  discard: () => void
}

/**
 * 在用户手势里同步开一个空白标签，等复制成功再导航到 url。
 *
 * 为什么不能等复制完再 `window.open`：复制是 `await` 的，等到 Promise resolve
 * 时浏览器的「用户激活」窗口已经过期，`window.open` 会被当成弹窗拦掉
 * （Safari 尤其严格，Chrome 大约 5 秒后失效）。所以只能先占位、后导航。
 *
 * 返回 null 表示弹窗被拦了 —— 调用方什么都不用做，功能降级成「只复制」。
 */
export function preopenTab(url: string): PendingTab | null {
  const win = window.open('about:blank', '_blank')
  if (!win) return null

  // 别让目标页通过 window.opener 拿到本页引用
  try {
    win.opener = null
  } catch {
    // 跨源时赋值会抛，忽略即可
  }

  return {
    commit: () => {
      try {
        win.location.replace(url)
      } catch {
        // location 不可写时退回 href
        try {
          win.location.href = url
        } catch {
          // 都不行就保持空白页，用户自己关掉
        }
      }
    },
    discard: () => {
      try {
        win.close()
      } catch {
        // 已经关了或跨源，忽略
      }
    },
  }
}
