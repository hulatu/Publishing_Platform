/**
 * markdown-it-footnote 没有自带 TypeScript 声明，官方也没有对应的 @types 包。
 * 这里补一个最小声明：它只被 md.use() 调用一次，参数类型放宽到 unknown 即可，
 * 因为 use() 期望的是 (md: MarkdownIt) => void，而接受 unknown 的函数是它的超集。
 */
declare module 'markdown-it-footnote' {
  const footnote: (md: unknown) => void
  export default footnote
}
