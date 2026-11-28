/**
 * 公众号文末组件回归
 *
 * 两条主线：
 * 1. 断言 —— 转义、占位符、全关时不改变产物、标签配平、纯文本通道带文末
 * 2. 扫描 —— 109 篇真实文章套上默认配置后，尾部给 HTML 增加了多少体积，
 *    以及尾部是否真的拼在两条通道的最后
 *
 * 工具不再做正文字数上限判定；这里只关心「加了文末之后产物有没有被破坏」。
 */

import { ok, fail, report } from './harness'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { POSTS } from './posts-dir'
import { parseArticle } from '../src/core/parse'
import { buildTailHtml, defaultTailConfig, applyVars, activeBlocks, wechatArticleUrl, type TailConfig } from '../src/core/tail'
import { getWechatTheme, wechatThemes } from '../src/themes/wechat'
import { renderWechat } from '../src/renderers/wechat'


const theme = getWechatTheme('paper')
const full: TailConfig = {
  follow: { on: true, title: '关于作者', text: '欢迎关注「{account}」。' },
  history: {
    on: true,
    title: '往期推荐',
    items: [
      { title: '第一篇', url: 'https://mp.weixin.qq.com/s/abc' },
      { title: '第二篇', url: '' },
      { title: '第三篇', url: 'https://example.com/a' },
    ],
  },
  copyright: { on: true, text: '© {year} {account}' },
}

/* ---------------- 1. 断言 ---------------- */

console.log('文末组件：')

const r1 = buildTailHtml(full, theme, '胡拉图说')
ok(r1.html.includes('胡拉图说'), '{account} 被替换成账号名')
ok(r1.html.includes(String(new Date().getFullYear())), '{year} 被替换成当前年份')
ok(r1.historyCount === 3, `往期推荐统计到 ${r1.historyCount} 条`)
ok(r1.linkedCount === 1, `公众号文章链接统计到 ${r1.linkedCount} 条`)
ok(r1.droppedLinks === 1, `不能点击的链接统计到 ${r1.droppedLinks} 条`)
ok(r1.html.includes('href="https://mp.weixin.qq.com/s/abc"'), '公众号文章链接输出成 <a href>')
ok(!r1.html.includes('href="https://example.com/a"'), '非公众号链接不输出 href（写了也会被剥离）')

// 往期推荐不再限制 4 条：6 条配置应全部输出
const many = buildTailHtml(
  {
    ...full,
    history: {
      on: true,
      title: '',
      items: Array.from({ length: 6 }, (_, i) => ({ title: `第 ${i + 1} 篇`, url: '' })),
    },
  },
  theme,
  'x',
)
ok(many.historyCount === 6, `往期推荐 6 条全部输出（实际 ${many.historyCount} 条）`)
ok(many.text.includes('第 6 篇'), '往期推荐第 6 条进入纯文本通道')

// 链接识别：微信号、协议归一化、伪装域名、其它页面
ok(wechatArticleUrl('https://mp.weixin.qq.com/s/abc') === 'https://mp.weixin.qq.com/s/abc', '标准短链被识别')
ok(wechatArticleUrl('  mp.weixin.qq.com/s/abc  ') === 'https://mp.weixin.qq.com/s/abc', '省略协议的地址补上 https')
ok(wechatArticleUrl('http://mp.weixin.qq.com/s/abc') === 'https://mp.weixin.qq.com/s/abc', 'http 统一成 https')
ok(
  wechatArticleUrl('https://mp.weixin.qq.com/s?__biz=Mz&mid=1&idx=1&sn=x') ===
    'https://mp.weixin.qq.com/s?__biz=Mz&mid=1&idx=1&sn=x',
  '长链原样保留（& 在 href 里再转义）',
)
ok(wechatArticleUrl('https://mp.weixin.qq.com/mp/profile_ext?action=home') === null, '非文章页不识别')
ok(wechatArticleUrl('https://mp.weixin.qq.com.evil.com/s/abc') === null, '伪装域名不识别')
ok(wechatArticleUrl('https://example.com/?u=https://mp.weixin.qq.com/s/abc') === null, '查询参数里带微信号也不算')
ok(wechatArticleUrl('javascript:alert(1)') === null, 'javascript: 不识别')

// 长链含 &，进 href 时必须转义，否则属性会被截断
const longLink = buildTailHtml(
  {
    follow: { on: false, title: '', text: '' },
    history: { on: true, title: '', items: [{ title: '长链', url: 'https://mp.weixin.qq.com/s?__biz=Mz&mid=1' }] },
    copyright: { on: false, text: '' },
  },
  theme,
  'x',
)
ok(longLink.html.includes('href="https://mp.weixin.qq.com/s?__biz=Mz&amp;mid=1"'), 'href 里的 & 被转义')

const empty = buildTailHtml(full, theme, '')
ok(empty.html.includes('本号'), '账号名为空时退化成「本号」，不会留下半个句子')

// 纯文本通道：公众号复制是 text/html + text/plain 双通道，
// 富文本那条一旦降级成纯文本，少了这份文末就等于「复制丢了后半篇」
ok(r1.text.includes('胡拉图说'), '纯文本通道同样替换了 {account}')
ok(r1.text.includes('第一篇') && r1.text.includes('第二篇'), '纯文本通道包含全部往期条目')
ok(!/[<>]/.test(r1.text), '纯文本通道里没有残留标签')
ok(r1.text.includes('关于作者'), '纯文本通道保留了小标题')

// 转义：用户会在标题里写尖括号和引号
const nasty = buildTailHtml(
  {
    follow: { on: true, title: '<b>x</b>', text: 'a & b < c > d "e"' },
    history: { on: false, title: '', items: [] },
    copyright: { on: false, text: '' },
  },
  theme,
  'x',
)
ok(!nasty.html.includes('<b>x</b>'), '标题里的 HTML 被转义，不会被当标签执行')
ok(nasty.html.includes('&amp;') && nasty.html.includes('&lt;'), '正文里的 & < > 都被转义')

// 全关：产物必须和没配尾部时完全一致
const off: TailConfig = {
  follow: { on: false, title: '', text: '' },
  history: { on: false, title: '', items: [] },
  copyright: { on: false, text: '' },
}
ok(buildTailHtml(off, theme, 'x').html === '', '三块全关时不产出任何字符')
ok(buildTailHtml(off, theme, 'x').text === '', '三块全关时纯文本通道同样不产出字符')
ok(activeBlocks(off) === 0 && activeBlocks(full) === 3, '启用块数统计正确')

// 标签配平
const open = (r1.html.match(/<section/g) ?? []).length
const close = (r1.html.match(/<\/section>/g) ?? []).length
ok(open === close, `<section> 开合配平（${open} / ${close}）`)
ok(!/<style|class=|::before|::after/.test(r1.html), '没有 <style> / class / 伪元素（微信会剥离）')

// 占位符
ok(applyVars('{account}·{year}', 'A') === `A·${new Date().getFullYear()}`, 'applyVars 同时替换两个占位符')

// 主题配色确实跟着主题走
const inks = new Set(wechatThemes.map((t) => buildTailHtml(full, getWechatTheme(t.id), 'x').html.slice(0, 400)))
ok(inks.size > 1, `${wechatThemes.length} 套主题产出 ${inks.size} 种不同配色`)

/* ---------------- 2. 扫描真实文章 ---------------- */

const files = readdirSync(POSTS).filter((f) => f.endsWith('.md') && !f.startsWith('_'))

const tailChars: number[] = []

for (const file of files) {
  const doc = parseArticle({ source: readFileSync(join(POSTS, file), 'utf8'), fileName: file })

  const before = renderWechat(doc, { wechatThemeId: 'paper', tail: off })
  const after = renderWechat(doc, { wechatThemeId: 'paper', tail: defaultTailConfig, account: '胡拉图说' })

  const b = [...before.primary].length
  const a = [...after.primary].length
  tailChars.push(a - b)

  // 尾部必须真的拼在最后 —— HTML 和纯文本两条通道都要
  const tail = buildTailHtml(defaultTailConfig, getWechatTheme('paper'), '胡拉图说')
  if (tail.html && !after.primary.endsWith(tail.html)) {
    fail(`${file}：尾部没有拼在 HTML 产物末尾`)
  }
  if (tail.text && !after.text.endsWith(tail.text)) {
    fail(`${file}：尾部没有拼在纯文本产物末尾（降级成纯文本时会丢文末）`)
  }
}

const avgTail = tailChars.reduce((x, y) => x + y, 0) / Math.max(1, tailChars.length)
const maxTail = Math.max(...tailChars)

console.log(`\n扫描 ${files.length} 篇：`)
console.log(`  默认配置增加的 HTML 字符：平均 ${avgTail.toFixed(0)}，最多 ${maxTail}`)
process.exit(report('文末组件'))
