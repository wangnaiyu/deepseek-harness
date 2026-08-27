/** PTO experiment browser presentation: durable dashboard plus comparison row/details. */
import type {
  PtoExperimentDashboardCancelResult,
  PtoExperimentDashboardEntry,
  PtoExperimentDashboardSnapshot,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import { ComparisonDetails } from './ComparisonDetails.tsx'
import { ComparisonRow } from './ComparisonRow.tsx'
import { ExperimentDashboardView, type ExperimentDashboardInjected } from './DashboardView.tsx'
import { en, NS, type PtoExperimentsKey, zh } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** PTO experiment comparison copy. */
    ptoExperiments: PtoExperimentsKey
  }
}

/** Required browser registries and authoritative dashboard Remote. */
export const inject = ['slots', 'locale', 'remote', 'remote.ptoExperimentDashboard']

/** Register both PTO comparison render sites as one declaration-aware plugin. */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-pto-experiments: dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'pto-experiments',
    order: 20,
    locale: NS,
    label: () => t('dashboard.tab'),
    inject: (sessionId: SessionId): ExperimentDashboardInjected => ({
      loadExperiments: async (): Promise<PtoExperimentDashboardSnapshot> => {
        const result = await ctx.remote.ptoExperimentDashboard.listSession({ sessionId, limit: 20 })
        if (!result.ok) {
          throw new Error(`ptoExperimentDashboard.listSession failed: ${result.error.code}: ${result.error.message}`)
        }
        return result.value
      },
      executeExperiment: async (
        experimentId: string,
        expectedRevision: number,
      ): Promise<PtoExperimentDashboardEntry> => {
        const result = await ctx.remote.ptoExperimentDashboard.executeSession({
          sessionId, experimentId, expectedRevision,
        })
        if (!result.ok) {
          throw new Error(`ptoExperimentDashboard.executeSession failed: ${result.error.code}: ${result.error.message}`)
        }
        return result.value
      },
      cancelExecution: async (experimentId: string): Promise<PtoExperimentDashboardCancelResult> => {
        const result = await ctx.remote.ptoExperimentDashboard.cancelSession({ sessionId, experimentId })
        if (!result.ok) {
          throw new Error(`ptoExperimentDashboard.cancelSession failed: ${result.error.code}: ${result.error.message}`)
        }
        return result.value
      },
    }),
  }, ExperimentDashboardView))
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register(
    { name: 'tool.call.toolview', key: 'pto_experiment_compare', locale: NS },
    ComparisonRow,
  ))
  ctx.slots.inject('tool.result.detailview', () => ctx.slots.register(
    { name: 'tool.result.detailview', key: 'pto_experiment_compare', locale: NS },
    ComparisonDetails,
  ))
}

export { comparisonViewModel } from './model.ts'
export type { ComparisonViewModel, PtoComparisonEvidence } from './model.ts'
export { ExperimentDashboardView } from './DashboardView.tsx'
export type { ExperimentDashboardInjected } from './DashboardView.tsx'
