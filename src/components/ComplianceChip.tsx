/**
 * 发布前检查（词表层）
 *
 * 挂在主标题右边的一枚小 chip：没命中就是「检查通过」，命中就报处数，
 * 点开能看到原句、命中词和改法。不联网，正文不出浏览器。
 */

import { useState } from 'react'
import type { ComplianceHit } from '../core/compliance'

interface Props {
  hits: ComplianceHit[]
  /** 当前用的是哪套规则，如「小红书规则」 */
  scopeLabel: string
}

export function ComplianceChip({ hits, scopeLabel }: Props) {
  const [open, setOpen] = useState(false)

  const high = hits.filter((h) => h.severity === 'high').length
  const tone = hits.length === 0 ? 'ok' : high > 0 ? 'high' : 'warn'

  return (
    <div className="check-wrap">
      <button
        className={`check-chip ${tone}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="发布前词表检查：极限词、承诺性用语、医疗功效、站外导流、联系方式、标题党"
      >
        <span className="check-dot" />
        {hits.length === 0 ? '检查通过' : `${hits.length} 处风险`}
      </button>

      {open ? (
        <>
          <div className="check-backdrop" onClick={() => setOpen(false)} />
          <div className="check-panel">
            <div className="check-panel-head">
              <span>发布前检查</span>
              <span className="check-scope">{scopeLabel}</span>
            </div>

            {hits.length === 0 ? (
              <div className="check-empty">
                没发现明显风险。
                <br />
                这里只查词表层面的问题，各平台审核尺度随时会变。
              </div>
            ) : (
              <div className="check-list">
                {hits.map((h, i) => (
                  <div className="check-item" key={`${h.ruleId}-${i}`}>
                    <div className="check-item-head">
                      <span className={`check-sev ${h.severity}`}>{h.severity === 'high' ? '高' : '中'}</span>
                      <span className="check-label">{h.label}</span>
                      <span className="check-match">{h.match}</span>
                    </div>
                    <div className="check-context">{h.context}</div>
                    <div className="check-hint">{h.hint}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  )
}
