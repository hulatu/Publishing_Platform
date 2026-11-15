/**
 * localStorage 的读底座
 *
 * 草稿箱和发布台账原来各抄了一份逐字相同的 readStore：取字符串、JSON.parse、
 * 确认是个对象、任何异常都当空。两份的区别只有 key 和注释里的「草稿箱 / 台账」。
 *
 * 读永远不抛：隐私模式、被浏览器清掉、被手改坏，都当「还没存过」，
 * 调用方拿到空对象继续走，不该因此让整个页面起不来。
 * 写不在这里 —— 草稿箱和台账各自有一套「配额满了淘汰最旧的再试」的策略，
 * 那部分和它们的数据结构绑在一起，硬合并只会让两边都变难懂。
 */

/** 读一个 JSON 对象；不存在、解析失败、不是对象都返回 {} */
export function readJson<T extends object>(key: string): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return {} as T
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {} as T
    return parsed as T
  } catch {
    return {} as T
  }
}
