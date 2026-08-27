/** Compact, replay-stable row for the PTO experiment comparison tool. */
import { IconDataOutline16, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { ReactNode } from 'react'
import { comparisonViewModel } from './model.ts'
import type { PtoExperimentsKey } from './locales.ts'
import css from './ComparisonRow.module.css'

type ComparisonRowProps = ToolCallViewProps & PropsLocale<'ptoExperiments'>

function number(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value)
}

function stateIcon(state: 'running' | 'error' | 'unavailable' | 'evidence'): ReactNode {
  if (state === 'error') return <StateDot state="error" />
  if (state === 'unavailable') return <StateDot state="warning" />
  return <IconDataOutline16 size={14} />
}

/** Render one comparison call without calculating or upgrading its conclusion. */
export function ComparisonRow({ block, t }: ComparisonRowProps) {
  const model = comparisonViewModel(block)
  let summary: string
  let badge: PtoExperimentsKey | null = null
  let badgeResult: 'incomparable' | 'inconclusive' | null = null
  if (model.state === 'running') summary = model.experimentId
  else if (model.state === 'error') summary = model.message
  else if (model.state === 'unavailable') summary = model.experimentId
  else {
    const evidence = model.evidence
    badgeResult = evidence.result
    badge = evidence.result === 'incomparable' ? 'result.incomparable' : 'result.inconclusive'
    if (evidence.result === 'inconclusive' && evidence.delta !== null
      && evidence.baseline.metric?.status === 'collected'
      && evidence.candidate.metric?.status === 'collected') {
      const relative = evidence.delta.relativePct === null ? '—' : `${number(evidence.delta.relativePct)}%`
      summary = `${number(evidence.baseline.metric.value)} → ${number(evidence.candidate.metric.value)} us · ${relative}`
    } else {
      summary = evidence.reasons[0] ?? evidence.experimentId
    }
  }
  const stateLabel = model.state === 'running'
    ? t('row.running')
    : model.state === 'error'
      ? t('row.failed')
      : model.state === 'unavailable' ? t('row.unavailable') : null
  return (
    <div className={css.row} data-state={model.state} data-tool="pto_experiment_compare">
      <span className={css.leading}>{stateIcon(model.state)}</span>
      {stateLabel !== null ? <span className={css.visuallyHidden}>{stateLabel}</span> : null}
      <span className={css.title}>{t('row.title')}</span>
      <span className={css.separator} aria-hidden />
      <span className={model.state === 'error' ? `${css.summary} ${css.error}` : css.summary}>{summary}</span>
      {badge !== null ? <span className={css.badge} data-result={badgeResult}>{t(badge)}</span> : null}
      {model.state === 'unavailable' ? <span className={css.badge} data-result="unavailable">{t('row.unavailable')}</span> : null}
    </div>
  )
}
