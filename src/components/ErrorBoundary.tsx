/**
 * 崩溃兜底
 *
 * 没有这一层时，任何组件在渲染期抛异常，React 19 会把整棵树卸掉 ——
 * 用户看到的是一片白屏，而这时草稿、台账、Key 其实都还在 localStorage 里躺着。
 * 白屏最大的问题是它不提供信息：用户不知道「刷新就能回来」，也不敢刷新，
 * 怕把没发出去的东西刷没了。
 *
 * 所以这里给三样东西：一句「数据还在」的实话、一段能贴出来的错误信息、
 * 以及两个出口 —— 先导出备份，再重载。
 */

import { Component, useState, type ErrorInfo, type ReactNode } from 'react'
import { backupFileName, backupText, clearAllLocal, collectBackup, describeBackup } from '../core/backup'
import { copyPlain, downloadText } from '../core/copy'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // 留一份在控制台：用户反馈时可以直接复制
    console.error('[文章分发台] 渲染出错', error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.error) return <CrashScreen error={this.state.error} />
    return this.props.children
  }
}

function CrashScreen({ error }: { error: Error }) {
  const [copied, setCopied] = useState<'idle' | 'ok' | 'fail'>('idle')
  const [arming, setArming] = useState(false)
  const [wipeMessage, setWipeMessage] = useState('')

  const detail = `${error.name}: ${error.message}\n${error.stack ?? ''}`.trim()
  const backup = collectBackup()

  const exportData = () => {
    downloadText(backupText(), backupFileName(), 'application/json')
  }

  const copyDetail = async () => {
    try {
      // 复用 copy.ts 的两条通道（剪贴板 API → execCommand），它已经处理过失焦重试
      await copyPlain(detail)
      setCopied('ok')
    } catch {
      setCopied('fail')
    }
  }

  const wipe = () => {
    if (!arming) {
      setArming(true)
      return
    }
    const { keys, ok } = clearAllLocal()
    setWipeMessage(
      ok ? `已清空 ${keys} 项，正在重载…` : `有 ${keys} 项没清掉（浏览器拒绝写入），刷新后可能还在`,
    )
    if (ok) setTimeout(() => window.location.reload(), 600)
    else setArming(false)
  }

  return (
    <div className="crash">
      <div className="crash-card">
        <h1 className="crash-title">界面出错了</h1>
        <p className="crash-lead">
          草稿、发布台账和设置都还在本机，刷新一次通常就能回来。先别清浏览器缓存。
        </p>

        <pre className="crash-error" aria-label="错误信息">
          {detail}
        </pre>

        <div className="crash-actions">
          <button className="btn btn-primary" onClick={() => window.location.reload()}>
            刷新页面
          </button>
          <button className="btn" onClick={() => void copyDetail()}>
            {copied === 'ok' ? '已复制' : copied === 'fail' ? '复制失败，请手动选中' : '复制错误信息'}
          </button>
          <button className="btn" onClick={exportData}>
            导出本地数据
          </button>
          <button className={`btn ${arming ? 'btn-danger' : ''}`} onClick={wipe}>
            {arming ? '确认清空并重载' : '清空本地数据'}
          </button>
        </div>

        {wipeMessage ? <p className="crash-hint">{wipeMessage}</p> : null}

        <p className="crash-hint">
          导出的备份含 {describeBackup(backup)}，其中包含 API Key —— 文件别发给别人。
          恢复入口在「设置 → 本地数据」。
        </p>
      </div>
    </div>
  )
}
