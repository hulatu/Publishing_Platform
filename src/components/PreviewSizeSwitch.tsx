/**
 * 预览宽度切换
 *
 * 两个图标 + tooltip：手机 390px、桌面（自适应）。不再用文字按钮 ——
 * 文字在 390px 窄屏上要么换行、要么把标题挤成竖排；图标一眼能认出设备，
 * 也给预览标题留出空间。
 *
 * 顺序和用户心智一致：手机 → 桌面（自适应）。
 */

import type { ReactElement } from 'react'
import type { PreviewSize } from './PreviewStage'

interface Props {
  value: PreviewSize
  onChange: (size: PreviewSize) => void
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <rect x="7" y="2" width="10" height="20" rx="2" />
      <path d="M11 18h2" strokeLinecap="round" />
    </svg>
  )
}

function DesktopIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" strokeLinecap="round" />
    </svg>
  )
}

const OPTIONS: {
  value: PreviewSize
  label: string
  hint: string
  icon: () => ReactElement
}[] = [
  { value: 'mobile', label: '手机预览', hint: '按手机 390px 宽度排版', icon: PhoneIcon },
  { value: 'auto', label: '桌面预览', hint: '跟随窗口宽度，最大到阅读列宽', icon: DesktopIcon },
]

export function PreviewSizeSwitch({ value, onChange }: Props) {
  return (
    <div className="segmented preview-size-switch" role="group" aria-label="预览宽度">
      {OPTIONS.map(({ value: option, label, hint, icon: Icon }) => (
        <button
          key={option}
          className={value === option ? 'active' : ''}
          onClick={() => onChange(option)}
          aria-label={label}
          aria-pressed={value === option}
          title={hint}
        >
          <Icon />
        </button>
      ))}
    </div>
  )
}
