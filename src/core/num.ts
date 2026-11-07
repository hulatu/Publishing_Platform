/**
 * 「人怎么读」→ 数字
 *
 * 复盘表里的四个格子（阅读 / 点赞 / 评论 / 收藏）用户是从各平台后台抄的，
 * 抄过来长什么样都有可能：`1,234`、`1.2万`、`3.5k`。
 *
 * 这里以前的做法是把非数字字符全剔掉，于是 `1.2万` 变成 12（差 1000 倍）、
 * `1234.5` 变成 12345（差 10 倍）—— 不报错、不提示，表格上看着还挺正常，
 * 只是结论全错。所以单位必须真的参与换算。
 *
 * 独立成文件是为了能在 node 里断言，不用起浏览器。
 */

const MULTIPLIERS: Record<string, number> = {
  万: 1e4,
  w: 1e4,
  亿: 1e8,
  k: 1e3,
}

export function parseNum(raw: string): number | undefined {
  // 千分位逗号、全角逗号、空格都是纯排版，先去掉
  const s = raw.replace(/[,，\s]/g, '').toLowerCase()
  if (!s) return undefined

  const m = /^(\d+(?:\.\d*)?)(万|w|亿|k)?$/.exec(s)
  if (!m) return undefined

  // 「1.」在输入过程中是合法中间态，去掉尾点再算，别让用户打不出小数点
  const base = Number(m[1].replace(/\.$/, ''))
  if (!Number.isFinite(base)) return undefined

  const mult = m[2] ? MULTIPLIERS[m[2]] : 1
  // 这些数字都是「多少个」，没有小数意义；四舍五入顺便吃掉 1.2万 = 12000 的浮点误差
  return Math.round(base * mult)
}
