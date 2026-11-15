/**
 * ESLint —— 只为一件事：Hooks 的两条规则
 *
 * 这个项目里手写的依赖数组有 30 多处，最长 12 项。这类代码靠人肉维护：
 * 漏一项就是「改了标题但清单不更新」这种只在特定操作顺序下复现的 bug，
 * 而且没有任何测试能覆盖到。
 *
 * 所以这里**只开两条规则**，故意不引 `js.configs.recommended` 和
 * `tseslint.configs.recommended`：那些会带来几十条「风格型」告警
 * （no-explicit-any、prefer-const……），红一片之后大家就都学会无视它了。
 * 类型层面的约束交给 `tsc --strict`（项目本来就 0 个 @ts-ignore）。
 *
 *   react-hooks/rules-of-hooks      —— 条件里调 hook 直接报错
 *   react-hooks/exhaustive-deps     —— 依赖数组漏项只警告，不挡 CI
 *
 * 想放宽或收紧，改这里一处即可。
 */

import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

export default [
  { ignores: ['dist/**', '.tmp/**', 'node_modules/**'] },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    // 只解析 TS/TSX，不注册 @typescript-eslint 的规则 ——
    // 那些（no-explicit-any 之类）交给 tsc 和 code review，
    // 这个配置存在的唯一理由是下面两条 hooks 规则。
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
]
