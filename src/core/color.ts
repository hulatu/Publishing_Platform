/**
 * 颜色计算：深色预览与对比度检查共用的最小集合。
 *
 * 只处理主题里实际出现的颜色写法：`#rgb` / `#rrggbb` 和 `rgb()/rgba()`。
 * 不引第三方库，是因为这部分逻辑要同时跑在浏览器（预览开关）和 Node
 * （`npm run check`）里；用 canvas 取色或 `color-mix()` 两边都会缺一半。
 *
 * 颜色空间用 HSL 而不是直接对 RGB 做线性缩放：主题里的强调色靠色相区分，
 * RGB 各通道同比例变暗会让红色先变棕、蓝色先变灰，深色预览就认不出原主题了。
 */

export interface Rgb {
  r: number
  g: number
  b: number
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

/** 解析失败返回 null —— 调用方据此跳过这一项，而不是悄悄按黑色算 */
export function parseColor(raw: string): Rgb | null {
  const value = raw.trim().toLowerCase()

  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/)
  if (hex) {
    const h = hex[1]
    const part = (i: number) =>
      parseInt(h.length === 3 ? h[i] + h[i] : h.slice(i * 2, i * 2 + 2), 16)
    return { r: part(0), g: part(1), b: part(2) }
  }

  const fn = value.match(/^rgba?\(([^)]+)\)$/)
  if (fn) {
    const parts = fn[1]
      .split(/[,/\s]+/)
      .filter(Boolean)
      .map(Number)
    if (parts.length < 3 || parts.slice(0, 3).some((n) => !Number.isFinite(n))) return null
    return { r: parts[0], g: parts[1], b: parts[2] }
  }

  return null
}

export function toHex({ r, g, b }: Rgb): string {
  const channel = (n: number) =>
    Math.round(clamp(n, 0, 255))
      .toString(16)
      .padStart(2, '0')
  return `#${channel(r)}${channel(g)}${channel(b)}`
}

/** [0, 360), [0, 100], [0, 100] */
export function rgbToHsl({ r, g, b }: Rgb): [number, number, number] {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  const d = max - min

  if (d === 0) return [0, 0, l * 100]

  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0)
  else if (max === gn) h = (bn - rn) / d + 2
  else h = (rn - gn) / d + 4

  return [h * 60, s * 100, l * 100]
}

export function hslToRgb(h: number, s: number, l: number): Rgb {
  const hue = ((h % 360) + 360) % 360
  const sat = clamp(s, 0, 100) / 100
  const light = clamp(l, 0, 100) / 100

  if (sat === 0) {
    const v = light * 255
    return { r: v, g: v, b: v }
  }

  const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat
  const p = 2 * light - q
  const channel = (t: number) => {
    let c = t
    if (c < 0) c += 1
    if (c > 1) c -= 1
    if (c < 1 / 6) return p + (q - p) * 6 * c
    if (c < 1 / 2) return q
    if (c < 2 / 3) return p + (q - p) * (2 / 3 - c) * 6
    return p
  }

  return {
    r: channel(hue / 360 + 1 / 3) * 255,
    g: channel(hue / 360) * 255,
    b: channel(hue / 360 - 1 / 3) * 255,
  }
}

/**
 * 固定色相与饱和度，只改亮度。
 * `maxSaturation` 用来压掉浅色底本身带的那点色偏 —— 纸白 #fbf8f3 直接拿到
 * 10% 亮度会变成一杯淡咖啡，压到 10% 饱和度才是「暖黑纸」。
 */
export function withLightness(raw: string, lightness: number, maxSaturation = 100): string {
  const rgb = parseColor(raw)
  if (!rgb) return raw
  const [h, s] = rgbToHsl(rgb)
  return toHex(hslToRgb(h, Math.min(s, maxSaturation), clamp(lightness, 0, 100)))
}

/** a 的权重为 weight（0 = 全 b，1 = 全 a） */
export function mixColor(a: string, b: string, weight: number): string {
  const ca = parseColor(a)
  const cb = parseColor(b)
  if (!ca || !cb) return a
  const w = clamp(weight, 0, 1)
  return toHex({
    r: ca.r * w + cb.r * (1 - w),
    g: ca.g * w + cb.g * (1 - w),
    b: ca.b * w + cb.b * (1 - w),
  })
}

/** WCAG 相对亮度；解析失败返回 null */
export function relativeLuminance(color: string | Rgb): number | null {
  const rgb = typeof color === 'string' ? parseColor(color) : color
  if (!rgb) return null
  const channel = (n: number) => {
    const c = clamp(n, 0, 255) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b)
}

/**
 * WCAG 对比度，1–21。
 * 任一颜色解析失败返回 0：调用方拿它和 4.5 比，失败会显式暴露，
 * 而不是因为「算不出来」被当成通过。
 */
export function contrastRatio(a: string | Rgb, b: string | Rgb): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  if (la === null || lb === null) return 0
  const high = Math.max(la, lb)
  const low = Math.min(la, lb)
  return (high + 0.05) / (low + 0.05)
}

/** 保留一位小数，给界面提示用 */
export function formatRatio(ratio: number): string {
  return ratio.toFixed(1)
}
