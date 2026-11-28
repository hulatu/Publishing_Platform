/**
 * 深色预览回归
 *
 * 深色主题不是另写的一份 ThemeSpec，而是把亮色 palette 推导后重跑同一套
 * build 函数（见 themes/wechat.ts 的 darkPalette）。推导规则一旦写错，
 * 最容易出现的不是「报错」，而是「某一级标题在深色下糊成一片」——
 * 只有把每套主题的每个文字角色都量一遍才看得出来。
 *
 * 检查项：
 * - 每套主题都有 dark 变体，且和亮色不同
 * - 深色根底亮度足够低（< 0.08），不能出现「黑字配浅灰底」的半吊子深色
 * - 产物里所有 background-color 都是深色（相对亮度 < 0.25）
 * - 正文 / H2–H4 / 引用 / 图注 / 代码 / 表头 / 参考链接 / 脚注 / 强调 / 链接
 *   的对比度全部 ≥ 4.5:1（AA 正文标准）
 * - getWechatTheme(id, true) 确实返回深色变体，默认仍返回亮色
 */

import { ok, report } from './harness'
import { renderHtml } from '../src/core/html-inline'
import type { Block } from '../src/core/ir'
import { parseArticle } from '../src/core/parse'
import { renderWechat } from '../src/renderers/wechat'
import { darkContrast, getWechatTheme, wechatThemes } from '../src/themes/wechat'
import { parseColor, relativeLuminance } from '../src/core/color'

/** 够覆盖所有主题分支：标题、正文、引用、代码、表格、强调、链接 */
const SAMPLE: Block[] = [
  { t: 'heading', level: 2, raw: '第一节', inline: [{ t: 'text', v: '第一节' }] },
  { t: 'heading', level: 3, raw: '小节', inline: [{ t: 'text', v: '小节' }] },
  { t: 'heading', level: 4, raw: '细目', inline: [{ t: 'text', v: '细目' }] },
  {
    t: 'p',
    raw: '正文有加粗、斜体和行内代码',
    inline: [
      { t: 'text', v: '正文有' },
      { t: 'strong', c: [{ t: 'text', v: '加粗' }] },
      { t: 'text', v: '、' },
      { t: 'em', c: [{ t: 'text', v: '斜体' }] },
      { t: 'text', v: '和' },
      { t: 'code', v: 'inline' },
      { t: 'text', v: '。' },
      { t: 'link', href: 'https://example.com', c: [{ t: 'text', v: '链接' }] },
    ],
  },
  {
    t: 'quote',
    raw: '引用',
    children: [{ t: 'p', raw: '引用', inline: [{ t: 'text', v: '引用里的一段话' }] }],
  },
  { t: 'code', lang: 'ts', text: 'const a = 1\nconst b = 2' },
  {
    t: 'table',
    head: [[{ t: 'text', v: '列一' }], [{ t: 'text', v: '列二' }]],
    rows: [
      [[{ t: 'text', v: '值一' }], [{ t: 'text', v: '值二' }]],
      [[{ t: 'text', v: '值三' }], [{ t: 'text', v: '值四' }]],
    ],
    align: [null, null],
  },
]

const render = (themeId: string, dark: boolean) =>
  renderHtml(SAMPLE, {
    theme: getWechatTheme(themeId, dark),
    linkMode: 'refs',
    target: 'wechat',
  }).html

console.log(`扫描 ${wechatThemes.length} 套主题的深色变体`)

for (const theme of wechatThemes) {
  const dark = theme.dark
  if (!ok(Boolean(dark), `${theme.id}：有深色变体`)) continue

  ok(dark.id === `${theme.id}__dark`, `${theme.id}：深色变体 id 可追溯`)
  ok(dark !== theme, `${theme.id}：深色与亮色不是同一个对象`)

  const bg = dark.root['background-color'] ?? ''
  const bgLum = relativeLuminance(bg)
  ok(bgLum !== null && bgLum < 0.08, `${theme.id}：深色底足够暗（${bg}，亮度 ${bgLum?.toFixed(3) ?? '—'}）`)

  const contrast = darkContrast(dark)
  ok(
    contrast.min >= 4.5,
    `${theme.id}：深色文字对比度 ${contrast.min.toFixed(1)}:1（最弱 ${contrast.worst}，需 ≥ 4.5）`,
  )

  const html = render(theme.id, true)
  const lightHtml = render(theme.id, false)
  ok(html !== lightHtml, `${theme.id}：深色产物与亮色不同`)

  // 产物里每一处实心底都必须落在暗区间；出现一块浅底就说明某个分支漏了 palette。
  const backgrounds = new Set(
    [...html.matchAll(/background-color:(#[0-9a-f]{6})/gi)].map((m) => m[1].toLowerCase()),
  )
  const lightBlocks = [...backgrounds].filter((color) => {
    if (!parseColor(color)) return false
    return (relativeLuminance(color) ?? 1) > 0.25
  })
  ok(
    lightBlocks.length === 0,
    `${theme.id}：产物里没有浅色背景${lightBlocks.length ? `（${lightBlocks.join('、')}）` : ''}`,
  )
}

/* 取主题的两个入口不能串：预览要深色，复制必须默认亮色 */
ok(getWechatTheme('paper', true).id === 'paper__dark', 'getWechatTheme(id, true) 返回深色变体')
ok(getWechatTheme('paper').id === 'paper', 'getWechatTheme(id) 仍返回亮色主题')
ok(getWechatTheme('no-such-theme', true).id === 'sspai__dark', '未知 id 的深色回退到默认（少数派）深色')

/*
 * 渲染器契约：`wechatThemeDark` 只在预览链路传；不传时产物必须还是亮色。
 * 这条比「主题对象不同」更靠近真实风险 —— 一旦复制流程误传了这个开关，
 * 用户粘到公众号里就是一篇深色文章。
 */
const doc = parseArticle({ source: '# 标题\n\n一段正文。', fileName: 'darkmode-check.md' })
const copyHtml = renderWechat(doc, { wechatThemeId: 'paper' }).html ?? ''
const previewHtml = renderWechat(doc, { wechatThemeId: 'paper', wechatThemeDark: true }).html ?? ''
ok(copyHtml.includes('background-color:#ffffff'), '复制链路默认仍输出亮色纸白')
ok(previewHtml.includes('background-color:#1a1a1a'), '预览开关确实换成深色底')

process.exit(report('深色预览层'))
