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
import { renderSspai } from './sspai'
import { renderZhihu } from './zhihu'
import { renderWechat } from './wechat'
import { renderDouban } from './douban'
import { renderBilibili, renderToutiao, renderBaijiahao } from './cn-blogs'

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
  warnings: string[]
  stats: StatItem[]
  extras?: ExtraList[]
  /** 建议的下载文件名 */
  fileName?: string
}

export interface ConvertOptions {
  /** 公众号主题 id */
  wechatThemeId: string
  /** 公众号文末组件（关注引导 / 往期推荐 / 版权），只有公众号渲染器会用 */
  tail?: TailConfig
  /** 账号名，替换尾部模板里的 {account} */
  account?: string
}

export interface ConvertPlatform {
  id: string
  name: string
  kind: 'convert'
  /** 平台一句话定位 */
  hint: string
  /** 硬性限制说明 */
  limits?: string
  render: (doc: Doc, opts: ConvertOptions) => RenderOutput
}

export const convertPlatforms: ConvertPlatform[] = [
  {
    id: 'sspai',
    name: '少数派',
    kind: 'convert',
    hint: '原生支持 Markdown，导入即用',
    render: renderSspai,
  },
  {
    id: 'zhihu',
    name: '知乎',
    kind: 'convert',
    hint: '专栏编辑器支持 .md 导入，富文本为备选',
    limits: '富文本粘贴后字号行距会被知乎归一化',
    render: renderZhihu,
  },
  {
    id: 'wechat',
    name: '公众号',
    kind: 'convert',
    hint: '全 inline style，复制后直接粘进编辑器',
    limits: '正文上限 20000 字（按字数算）',
    render: renderWechat,
  },
  {
    id: 'douban',
    name: '豆瓣',
    kind: 'convert',
    hint: '日记支持有限 HTML，保留链接与图片',
    limits: '不支持自定义字体与复杂样式',
    render: renderDouban,
  },
  {
    id: 'bilibili',
    name: 'B 站专栏',
    kind: 'convert',
    hint: '富文本粘贴，标题层级与表格保真',
    limits: '代码块退化成普通段落',
    render: renderBilibili,
  },
  {
    id: 'toutiao',
    name: '头条号',
    kind: 'convert',
    hint: '富文本粘贴，样式会被归一化',
    limits: '正文外链被清除（已转文末参考）；代码块被清洗',
    render: renderToutiao,
  },
  {
    id: 'baijiahao',
    name: '百家号',
    kind: 'convert',
    hint: '只保留段落、加粗、标题、图片',
    limits: '清洗最狠：外链与 <pre> 都会被剥掉',
    render: renderBaijiahao,
  },
]

export const rewritePlatforms = [
  {
    id: 'xiaohongshu',
    name: '小红书',
    kind: 'rewrite' as const,
    hint: '短句分点，配 3:4 竖图',
    limits: '标题 20 字 · 正文 1000 字 · 图片 3:4',
  },
  {
    id: 'twitter',
    name: '推特 / X',
    kind: 'rewrite' as const,
    hint: '拆成 thread 逐条发',
    limits: '单条 280 加权字符（约 140 汉字）',
  },
  {
    id: 'jike',
    name: '即刻',
    kind: 'rewrite' as const,
    hint: '一段话短评，不要标题',
    limits: '正文 500 字',
  },
  {
    id: 'weibo',
    name: '微博',
    kind: 'rewrite' as const,
    hint: '一句话 + #话题#',
    limits: '正文 140 字',
  },
]

export const cardPlatform = {
  id: 'cards',
  name: '配图卡片',
  kind: 'card' as const,
  hint: '1080×1440 文字卡片，导出 PNG',
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
  { id: 'convert', label: '格式转换 · 无需 AI', list: convertPlatforms },
  { id: 'rewrite', label: '内容改写 · 需要大模型', list: rewritePlatforms },
  { id: 'card', label: '配图', list: [cardPlatform] },
]

export function getConvertPlatform(id: string): ConvertPlatform | undefined {
  return convertPlatforms.find((p) => p.id === id)
}
