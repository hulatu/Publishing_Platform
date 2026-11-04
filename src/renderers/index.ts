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
    limits: '图片需在少数派后台上传，外链图会被拒',
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
    limits: '正文上限 20000 字符；图片需微信域名',
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

export function getConvertPlatform(id: string): ConvertPlatform | undefined {
  return convertPlatforms.find((p) => p.id === id)
}
