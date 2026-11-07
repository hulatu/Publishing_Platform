/**
 * 左侧栏的平台显示偏好
 *
 * 只决定「列表里显示哪几个」，不影响任何实际能力：
 * 隐藏的平台照样有渲染器、照样记账、AI 也照样能批量生成，
 * 只是不占侧栏位置。想找回来打开筛选面板勾上即可。
 */

import { weightedLength } from './cjk'

const KEY = 'ad.hiddenPlatforms.v1'

/**
 * 读回隐藏集合。
 *
 * `known` 是当前实际存在的平台 id —— 平台改名或下线后，本地还留着旧 id，
 * 不清掉的话「已隐藏 2 个」会永远对不上列表，用户也找不到是谁。
 */
export function loadHidden(known: string[]): Set<string> {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return new Set()
    const arr: unknown = JSON.parse(raw)
    if (!Array.isArray(arr)) return new Set()
    const allow = new Set(known)
    return new Set(arr.filter((x): x is string => typeof x === 'string' && allow.has(x)))
  } catch {
    // 隐私模式读不到 / 存的是坏 JSON —— 当成「全都显示」，不要因为偏好读不出就少半个列表
    return new Set()
  }
}

/** 返回是否真的写进去了（隐私模式、配额满时会失败） */
export function saveHidden(hidden: Iterable<string>): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify([...hidden]))
    return true
  } catch {
    return false
  }
}

/**
 * 按名字长短排，短的在上面。
 *
 * 用视觉宽度而不是字数：「B 站专栏」5 个字，但 `B` 和空格都是半角，
 * 排出来和「配图卡片」一样宽。按字数排会把它塞到「配图卡片」前面，看着歪。
 *
 * 宽度相同的保持注册表里的原顺序（Array.sort 在现代引擎里是稳定的）。
 */
export function sortByWidth<T extends { name: string }>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => weightedLength(a.name) - weightedLength(b.name))
}
