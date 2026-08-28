/** Full-height, evidence-gated PTO comparison details body. */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolResultDetailsViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { COMPARISON_DIMENSIONS, comparisonViewModel, type ComparisonMetric } from './model.ts'
import css from './ComparisonDetails.module.css'

type ComparisonDetailsProps = ToolResultDetailsViewProps & PropsLocale<'ptoExperiments'>

function number(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(value)
}

function metricText(metric: ComparisonMetric | null, t: ComparisonDetailsProps['t']): string {
  if (metric === null) return t('details.metricUnavailable')
  if (metric.status !== 'collected') return metric.reason
  return `${number(metric.value)} ${metric.unit}`
}

function shortIdentity(value: string | null): string {
  if (value === null) return '—'
  return value.length > 28 ? `${value.slice(0, 25)}…` : value
}

/** Render only values admitted by the closed comparison schema. */
export function ComparisonDetails({ block, t }: ComparisonDetailsProps) {
  const model = comparisonViewModel(block)
  if (model.state !== 'evidence') {
    const title = model.state === 'running'
      ? t('row.running')
      : model.state === 'error' ? t('row.failed') : t('row.unavailable')
    const body = model.state === 'error'
      ? model.message
      : model.state === 'unavailable' ? model.reason : model.experimentId
    return (
      <section className={css.empty} data-state={model.state}>
        <strong>{title}</strong>
        <span>{body}</span>
      </section>
    )
  }

  const { evidence } = model
  const resultKey = `result.${evidence.result}` as const
  return (
    <section className={css.root} data-result={evidence.result}>
      <header className={css.header}>
        <div>
          <h3>{t('details.title')}</h3>
          <div className={css.experimentId}>{evidence.experimentId}</div>
        </div>
        <span className={css.resultBadge}>{t(resultKey)}</span>
      </header>

      <div className={css.notice}>
        {t(evidence.result === 'incomparable'
          ? 'details.notice.incomparable'
          : 'details.notice.inconclusive')}
      </div>

      <div className={css.sides}>
        <article className={css.side}>
          <span className={css.eyebrow}>{t('details.baseline')}</span>
          <strong>{metricText(evidence.baseline.metric, t)}</strong>
          <span className={css.path} title={evidence.baseline.runPath}>{evidence.baseline.runPath}</span>
          <span className={css.identifier}>{evidence.baselineExperimentId ?? t('details.noBaseline')}</span>
        </article>
        <article className={css.side}>
          <span className={css.eyebrow}>{t('details.candidate')}</span>
          <strong>{metricText(evidence.candidate.metric, t)}</strong>
          <span className={css.path} title={evidence.candidate.runPath}>{evidence.candidate.runPath}</span>
          <span className={css.identifier}>{evidence.experimentId}</span>
        </article>
      </div>

      {evidence.delta !== null ? (
        <section className={css.section}>
          <h4>{t('details.delta')}</h4>
          <div className={css.deltaGrid}>
            <div><span>{t('details.absolute')}</span><strong>{number(evidence.delta.absolute)} {t('details.unit.microseconds')}</strong></div>
            <div><span>{t('details.relative')}</span><strong>{evidence.delta.relativePct === null ? '—' : `${number(evidence.delta.relativePct)}%`}</strong></div>
            <div><span>{t(`direction.${evidence.delta.direction}`)}</span><strong>{t('details.significance')}</strong></div>
          </div>
        </section>
      ) : null}

      <section className={css.section}>
        <h4>{t('details.identities')}</h4>
        <div className={css.identityTable} role="table">
          {COMPARISON_DIMENSIONS.map((name) => {
            const dimension = evidence.identity[name]
            return (
              <div className={css.identityRow} role="row" key={name} data-status={dimension.status}>
                <span className={css.dimension} role="cell">{t(`dimension.${name}`)}</span>
                <span className={css.identityValue} role="cell" title={dimension.baseline ?? undefined}>{shortIdentity(dimension.baseline)}</span>
                <span className={css.identityValue} role="cell" title={dimension.candidate ?? undefined}>{shortIdentity(dimension.candidate)}</span>
                <span className={css.status} role="cell">{t(`status.${dimension.status}`)}</span>
              </div>
            )
          })}
        </div>
      </section>

      <section className={css.section}>
        <h4>{t('details.reasons')}</h4>
        <ul className={css.reasons}>{evidence.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
      </section>
    </section>
  )
}
