/**
 * 平台渲染器注册表
 *
 * 分两类：
 * - convert（确定性）：纯格式转换，零 AI，秒出，可复现
 * - rewrite（AI 改写）：需要调大模型，见 ai/ 目录
 *
 * 卡片（cards）是第三类，不走这里。
 */

import type { Doc } from '../core/ir'
import type { TailConfig } from '../core/tail'

export type PlatformKind = 'convert' | 'rewrite' | 'card'

export interface StatItem {
  label: string
  value: string
  level?: 'ok' | 'warn' | 'error'
}

export interface ExtraList {
  title: string
  items: string[]
}

export interface RenderOutput {
  /** 主产物：直接可复制 / 下载的文本 */
  primary: string
  /** 富文本 HTML（有则可走「复制富文本」） */
  html?: string
  /** 纯文本 */
  text: string
  format: 'markdown' | 'html' | 'text'
  copyMode: 'rich' | 'plain' | 'markdown'
  /**
   * 复制时只写 text/html，不写 text/plain。
   * 少数派这种「有纯文本就优先按 Markdown 转换」的编辑器要靠它走 HTML 分支。
   */
  htmlOnly?: boolean
  warnings: string[]
  stats: StatItem[]
  extras?: ExtraList[]
  /** 建议的下载文件名 */
  fileName?: string
}

export interface ConvertOptions {
  /** 公众号主题 id */
  wechatThemeId: string
  /**
   * 用深色变体渲染，只给站内预览用。
   * 复制 / 导出时不传，产物必须保持亮色主题。
   */
  wechatThemeDark?: boolean
  /** 公众号文末组件（关注引导 / 往期推荐 / 版权），只有公众号渲染器会用 */
  tail?: TailConfig
  /** 账号名，替换尾部模板里的 {account} */
  account?: string
}

/** 一个平台的渲染函数本体 */
export type RenderFn = (doc: Doc, opts: ConvertOptions) => RenderOutput

export interface ConvertPlatform {
  id: string
  name: string
  kind: 'convert'
  /** 平台一句话定位 */
  hint: string
  /** 硬性限制说明 */
  limits?: string
  /**
   * 渲染函数是动态 import 进来的 —— 侧栏只要元数据（id / 名字 / 说明），
   * 首屏不该为 5 个平台全买单。调用方用下面的 loadConvertRenderer。
   */
  load: () => Promise<RenderFn>
}

export const convertPlatforms: ConvertPlatform[] = [
  {
    id: 'sspai',
    name: '少数派',
    kind: 'convert',
    hint: 'Markdown / 富文本 · 图注',
    load: () => import('./sspai').then((m) => m.renderSspai),
  },
  {
    id: 'zhihu',
    name: '知乎',
    kind: 'convert',
    hint: '富文本 · 图注进注释',
    limits: '字号行距由知乎归一化',
    load: () => import('./zhihu').then((m) => m.renderZhihu),
  },
  {
    id: 'wechat',
    name: '公众号',
    kind: 'convert',
    hint: '全内联样式',
    load: () => import('./wechat').then((m) => m.renderWechat),
  },
  {
    id: 'douban',
    name: '豆瓣',
    kind: 'convert',
    hint: '有限 HTML',
    limits: '不支持自定义字体',
    load: () => import('./douban').then((m) => m.renderDouban),
  },
  {
    id: 'toutiao',
    name: '头条号',
    kind: 'convert',
    hint: '富文本',
    limits: '外链清除 · 代码块清洗',
    load: () => import('./cn-blogs').then((m) => m.renderToutiao),
  },
]

export const rewritePlatforms = [
  {
    id: 'xiaohongshu',
    name: '小红书',
    kind: 'rewrite' as const,
    hint: '短句分点',
    limits: '标题 20 · 正文 1000 · 图 3:4',
  },
  {
    id: 'twitter',
    name: '推特',
    kind: 'rewrite' as const,
    hint: '自动拆 thread',
    limits: '单条约 140 汉字',
  },
  {
    id: 'jike',
    name: '即刻',
    kind: 'rewrite' as const,
    hint: '单段短评',
    limits: '正文 500 字',
  },
  {
    id: 'weibo',
    name: '微博',
    kind: 'rewrite' as const,
    hint: '一句话 + 话题',
    limits: '正文 140 字',
  },
]

export const cardPlatform = {
  id: 'cards',
  name: '配图卡片',
  kind: 'card' as const,
    hint: '文字卡片 · 导出 PNG',
}

export const allPlatforms = [...convertPlatforms, ...rewritePlatforms, cardPlatform]

/**
 * 侧栏与筛选面板共用的分组。
 *
 * 放在这里而不是组件里，是为了让 check-platforms 能直接断言
 * 「筛选面板覆盖了全部平台」—— 以后新增平台忘了加进面板，
 * 用户在侧栏被隐藏后就再也找不回来了。
 */
export interface PlatformGroup {
  id: 'convert' | 'rewrite' | 'card'
  label: string
  list: { id: string; name: string; hint: string }[]
}

export const platformGroups: PlatformGroup[] = [
  { id: 'convert', label: '直接转换', list: convertPlatforms },
  { id: 'rewrite', label: 'AI 改写', list: rewritePlatforms },
  { id: 'card', label: '配图', list: [cardPlatform] },
]

export function getConvertPlatform(id: string): ConvertPlatform | undefined {
  return convertPlatforms.find((p) => p.id === id)
}

/**
 * 按需加载某平台的渲染函数，结果按平台缓存 —— 同一个平台切来切去只请求一次。
 *
 * 加载失败时把缓存清掉，下次切回来可以重试，别让一次网络抖动把平台永久判死刑。
 * 调用方在加载期间显示「加载中…」，失败时给一条报错产物（见 App.tsx）。
 */
const rendererCache = new Map<string, Promise<RenderFn>>()

export function loadConvertRenderer(id: string): Promise<RenderFn> {
  const p = getConvertPlatform(id)
  if (!p) return Promise.reject(new Error(`未知平台：${id}`))
  const hit = rendererCache.get(id)
  if (hit) return hit
  const loading = p.load()
  rendererCache.set(id, loading)
  loading.catch(() => {
    if (rendererCache.get(id) === loading) rendererCache.delete(id)
  })
  return loading
}
