/** Root overlay for Session-free PTO static viewers. */

import { IconCloseFill14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, PropsHooks, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { PtoViewerState } from './pto-viewer.ts'
import type { WorkspaceKey } from './locales.ts'
import css from './PtoViewerOverlay.module.css'

export interface PtoViewerOverlayInjected {
  hooks: { viewer: HostObservable<PtoViewerState> }
  closeViewer: () => void
  analyzeRecord: () => void
  switchViewer: (actionId: string) => void
}

type PtoViewerOverlayProps = PropsHooks<PtoViewerOverlayInjected['hooks']>
  & Pick<PtoViewerOverlayInjected, 'closeViewer' | 'analyzeRecord' | 'switchViewer'>
  & PropsLocale<'workspace'>

/** Render loading/error/open states without requiring a Session provider. */
export function PtoViewerOverlay({ useViewer, closeViewer, analyzeRecord, switchViewer, t }: PtoViewerOverlayProps) {
  const state = useViewer(value => value)
  if (state.kind === 'idle') return null
  if (state.kind !== 'open') {
    return (
      <div className={css.message} data-pto-viewer-state={state.kind}>
        <section className={css.card} role={state.kind === 'error' ? 'alert' : 'status'}>
          <strong>{t(state.kind === 'loading' ? 'viewer.loading' : 'viewer.error')}</strong>
          <span className={state.kind === 'error' ? css.error : undefined}>
            {state.kind === 'loading' ? state.path : state.message}
          </span>
          <button type="button" className={css.close} onClick={closeViewer}>{t('viewer.close')}</button>
        </section>
      </div>
    )
  }
  const canAnalyze = state.record.actions.some(action =>
    action.actionId === 'analyze.dependency-redundancy'
    && action.kind === 'analysis'
    && action.status === 'available')
  const viewerActions = state.record.actions.filter(action => action.kind === 'viewer' && action.status === 'available')
  const viewerLabels: Record<string, WorkspaceKey> = {
    'open.dependency-graph': 'viewer.dependencyGraph',
    'open.memory-map': 'viewer.memoryMap',
    'open.ir-lowering': 'viewer.irTrace',
  }
  return (
    <section className={css.root} data-pto-viewer-state="open">
      <header className={css.toolbar}>
        <span className={css.title}>{state.handle.title}</span>
        <span className={css.artifact} title={state.handle.artifactRef}>{state.handle.artifactRef}</span>
        <span className={css.capability}>{t('viewer.viewOnly')}</span>
        {viewerActions.length > 1 && (
          <nav className={css.switchers} aria-label={t('viewer.views')}>
            {viewerActions.map(action => (
              <button
                type="button"
                className={css.switcher}
                aria-pressed={action.actionId === state.handle.actionId}
                onClick={() => { switchViewer(action.actionId) }}
                key={action.actionId}
              >
                {t(viewerLabels[action.actionId] ?? 'viewer.visualization')}
              </button>
            ))}
          </nav>
        )}
        <button
          type="button"
          className={css.analyze}
          disabled={!canAnalyze}
          onClick={analyzeRecord}
        >
          {t('viewer.analyze')}
        </button>
        <button type="button" className={css.close} aria-label={t('viewer.close')} onClick={closeViewer}>
          <IconCloseFill14 />
        </button>
      </header>
      <iframe
        className={css.frame}
        title={state.handle.title}
        src={state.handle.urlPath}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
      />
    </section>
  )
}
