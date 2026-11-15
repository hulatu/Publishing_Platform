/**
 * HTML 转义
 *
 * 原本 parse.ts、tail.ts、html-inline.ts 各有一份逐字相同的实现。
 * 三份的风险不在体积：哪天有人只在其中一处补上 `'` 的转义（单引号
 * 在 `attr='…'` 这种写法里是会截断属性的），另外两处的产物就会悄悄不同。
 *
 * 只转 `& < > "`：本工具的产物一律用双引号包属性值，单引号不构成逃逸。
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
