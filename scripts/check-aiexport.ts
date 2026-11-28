/**
 * AI 文案 Markdown 导出回归
 *
 * 「导出全平台」现在会把已生成的 AI 文案放进 zip 的 ai/ 目录。
 * 这里只测纯转换函数：标题 / 正文 / 话题 / thread 编号是否正确，
 * 以及没生成过的平台不能凭空产生文件。
 */

import { report, ok } from './harness'
import { REWRITE_FILE_NAMES, rewriteMarkdown } from '../src/core/rewrite-markdown'
import type { AIResultSet } from '../src/ai/types'

const all: AIResultSet = {
  xhs: { title: '一篇小红书标题', body: '小红书正文', tags: ['AI', '效率'] },
  twitter: { thread: ['第一条', '第二条'] },
  jike: { body: '即刻正文' },
  weibo: { text: '微博正文', topics: ['写作'] },
}

console.log('AI 文案导出：')

const xhs = rewriteMarkdown('xiaohongshu', all)
ok(Boolean(xhs?.includes('# 一篇小红书标题')), '小红书保留标题')
ok(Boolean(xhs?.includes('#AI #效率')), '小红书带话题标签')
ok(Boolean(xhs?.endsWith('\n')), 'Markdown 文件以换行结尾')

const twitter = rewriteMarkdown('twitter', all)
ok(Boolean(twitter?.includes('1/2 第一条')), '推特 thread 带 1/n 编号')
ok(Boolean(twitter?.includes('2/2 第二条')), '推特 thread 第二条编号正确')

ok(Boolean(rewriteMarkdown('jike', all)?.includes('即刻正文')), '即刻正文保留')
ok(Boolean(rewriteMarkdown('weibo', all)?.includes('#写作#')), '微博保留话题')

ok(rewriteMarkdown('jike', {}) === null, '没有结果时返回 null（不生成空文件）')
ok(rewriteMarkdown('twitter', { twitter: { thread: [] } }) === null, '空 thread 返回 null')
ok(REWRITE_FILE_NAMES.twitter === '推特', '推特文件名不带路径斜杠')

process.exit(report('AI 导出'))
