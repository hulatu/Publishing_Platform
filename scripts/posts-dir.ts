/**
 * 文章目录解析。
 *
 * 本地跑回归时默认读 Hugo 博客的真实文章（109 篇，覆盖面最好）；
 * CI 里没有那台机器的路径，所以工作流把 POSTS_DIR 指向仓库内的 scripts/fixtures。
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// 不写死用户名：默认读「当前用户家目录下的 Blog」，换台机器/换个人 clone 都能直接跑
const DEFAULT_POSTS = join(homedir(), 'Blog', 'content', 'posts')

export const POSTS = process.env.POSTS_DIR ?? DEFAULT_POSTS

if (!existsSync(POSTS)) {
  console.error(`找不到文章目录：${POSTS}`)
  console.error('本地请把 POSTS_DIR 指向你的 Hugo posts 目录；仓库内自检用 POSTS_DIR=scripts/fixtures')
  process.exit(1)
}
