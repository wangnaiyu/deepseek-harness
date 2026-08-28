/** Session-scoped durable PTO experiment dashboard. */

import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  PtoExperimentDashboardCancelResult,
  PtoExperimentDashboardEntry,
  PtoExperimentDashboardSnapshot,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './dashboard.module.css'

/** Session-bound authoritative loader supplied by the slot registration. */
export interface ExperimentDashboardInjected {
  loadExperiments: () => Promise<PtoExperimentDashboardSnapshot>
  executeExperiment: (experimentId: string, expectedRevision: number) => Promise<PtoExperimentDashboardEntry>
  cancelExecution: (experimentId: string) => Promise<PtoExperimentDashboardCancelResult>
}

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly value: PtoExperimentDashboardSnapshot }
  | { readonly kind: 'error'; readonly message: string }

type ActionState =
  | { readonly kind: 'executing' }
  | { readonly kind: 'cancelling' }
  | { readonly kind: 'error'; readonly message: string }

function leaf(path: string): string {
  const normalized = path.replaceAll('\\', '/').replace(/\/+$/u, '')
  return normalized.slice(normalized.lastIndexOf('/') + 1) || path
}

function metric(entry: PtoExperimentDashboardEntry, t: PropsLocale<'ptoExperiments'>['t']): string {
  if (entry.metric === null) return t('dashboard.metric.none')
  if (entry.metric.status === 'collected') return `${entry.metric.value} ${entry.metric.unit}`
  return t(`dashboard.metric.${entry.metric.status}`)
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    const encoded: unknown = JSON.stringify(error)
    return typeof encoded === 'string' ? encoded : fallback
  } catch { return fallback }
}

/** Durable experiment list with explicit refresh and contained loading/error states. */
export function ExperimentDashboardView({
  loadExperiments, executeExperiment, cancelExecution, t,
}: ConvViewProps & InjectFace<ExperimentDashboardInjected> & PropsLocale<'ptoExperiments'>) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [actions, setActions] = useState<ReadonlyMap<string, ActionState>>(() => new Map())
  const request = useRef(0)
  const actionGeneration = useRef(new Map<string, number>())
  const mounted = useRef(false)
  const load = useCallback(() => {
    const generation = ++request.current
    setState({ kind: 'loading' })
    void loadExperiments().then(
      (value) => { if (request.current === generation) setState({ kind: 'ready', value }) },
      (error: unknown) => {
        if (request.current !== generation) return
        setState({ kind: 'error', message: errorMessage(error, t('dashboard.unknownError')) })
      },
    )
  }, [loadExperiments, t])

  useEffect(() => {
    mounted.current = true
    load()
    return () => { mounted.current = false; request.current += 1 }
  }, [load])

  const nextAction = useCallback((experimentId: string): number => {
    const generation = (actionGeneration.current.get(experimentId) ?? 0) + 1
    actionGeneration.current.set(experimentId, generation)
    return generation
  }, [])

  const finishAction = useCallback((experimentId: string, generation: number, error?: unknown) => {
    if (!mounted.current || actionGeneration.current.get(experimentId) !== generation) return
    setActions((current) => {
      const next = new Map(current)
      if (error === undefined) next.delete(experimentId)
      else next.set(experimentId, { kind: 'error', message: errorMessage(error, t('dashboard.unknownError')) })
      return next
    })
    load()
  }, [load, t])

  const execute = useCallback((experiment: PtoExperimentDashboardEntry) => {
    const generation = nextAction(experiment.id)
    setActions(current => new Map(current).set(experiment.id, { kind: 'executing' }))
    void executeExperiment(experiment.id, experiment.revision).then(
      () => { finishAction(experiment.id, generation) },
      (error: unknown) => { finishAction(experiment.id, generation, error) },
    )
  }, [executeExperiment, finishAction, nextAction])

  const cancel = useCallback((experimentId: string) => {
    const generation = actionGeneration.current.get(experimentId) ?? nextAction(experimentId)
    setActions(current => new Map(current).set(experimentId, { kind: 'cancelling' }))
    void cancelExecution(experimentId).then(
      () => { finishAction(experimentId, generation) },
      (error: unknown) => { finishAction(experimentId, generation, error) },
    )
  }, [cancelExecution, finishAction, nextAction])

  return <section className={css.root} aria-label={t('dashboard.title')}>
    <header className={css.header}>
      <div><h2>{t('dashboard.title')}</h2><p>{t('dashboard.description')}</p></div>
      <button type="button" className={css.refresh} onClick={load} disabled={state.kind === 'loading'}>
        {state.kind === 'loading' ? t('dashboard.refreshing') : t('dashboard.refresh')}
      </button>
    </header>
    {state.kind === 'loading' && <p className={css.state} role="status">{t('dashboard.loading')}</p>}
    {state.kind === 'error' && <div className={css.state} role="alert">
      <strong>{t('dashboard.error')}</strong><span title={state.message}>{state.message}</span>
    </div>}
    {state.kind === 'ready' && state.value.experiments.length === 0 && <p className={css.state}>{t('dashboard.empty')}</p>}
    {state.kind === 'ready' && state.value.experiments.length > 0 && <>
      <div className={css.summary}>
        {t('dashboard.count').replace('{shown}', String(state.value.experiments.length)).replace('{total}', String(state.value.total))}
        {state.value.truncated ? ` · ${t('dashboard.truncated')}` : ''}
      </div>
      <ol className={css.list}>
        {state.value.experiments.map((experiment) => {
          const action = actions.get(experiment.id)
          const locallyActive = action?.kind === 'executing' || action?.kind === 'cancelling'
          const active = experiment.executionActivity.active || locallyActive
          const cancellable = (experiment.executionActivity.cancellable || action?.kind === 'executing')
            && action?.kind !== 'cancelling'
          return <li className={css.card} key={experiment.id}>
            <div className={css.cardHead}>
              <code title={experiment.id}>{experiment.id}</code>
              <span className={css.status} data-status={experiment.status}>{t(`dashboard.status.${experiment.status}`)}</span>
            </div>
            <p className={css.change} title={experiment.declaredChange}>{experiment.declaredChange}</p>
            <dl className={css.facts}>
              <div><dt>{t('dashboard.baseline')}</dt><dd title={experiment.baselinePath}>{leaf(experiment.baselinePath)}</dd></div>
              <div><dt>{t('dashboard.candidate')}</dt><dd title={experiment.actualRunPath ?? experiment.candidateOutputPath}>{leaf(experiment.actualRunPath ?? experiment.candidateOutputPath)}</dd></div>
              <div><dt>{t('dashboard.metric')}</dt><dd>{metric(experiment, t)}</dd></div>
              <div><dt>{t('dashboard.revision')}</dt><dd>{experiment.revision}</dd></div>
            </dl>
            {experiment.failureReason !== null && <p className={css.failure} title={experiment.failureReason}>
              {experiment.failureReason}
            </p>}
            {action?.kind === 'error' && <p className={css.actionError} role="alert" title={action.message}>{action.message}</p>}
            <div className={css.cardFoot}>
              <time className={css.time} dateTime={experiment.updatedAt} title={experiment.updatedAt}>
                {t('dashboard.updated')} {experiment.updatedAt}
              </time>
              <div className={css.actions}>
                {active && <span role="status">{action?.kind === 'cancelling'
                  ? t('dashboard.execution.cancelling')
                  : t('dashboard.execution.active')}</span>}
                {experiment.status === 'planned' && !active && <button type="button" onClick={() => { execute(experiment) }}>
                  {t('dashboard.execution.execute')}
                </button>}
                {cancellable && <button type="button" className={css.cancel} onClick={() => { cancel(experiment.id) }}>
                  {t('dashboard.execution.cancel')}
                </button>}
              </div>
            </div>
          </li>
        })}
      </ol>
    </>}
  </section>
}
