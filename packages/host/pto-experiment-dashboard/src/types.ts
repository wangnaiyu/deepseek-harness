/** Client-safe wire vocabulary for the PTO experiment dashboard. */

/** Session-addressed, bounded dashboard request. */
export interface PtoExperimentDashboardRequest {
  readonly sessionId: string
  readonly limit?: number
}

/** Session-authorized optimistic request to execute one planned experiment. */
export interface PtoExperimentDashboardExecuteRequest {
  readonly sessionId: string
  readonly experimentId: string
  readonly expectedRevision: number
}

/** Session-authorized request to cancel an execution started by that Session. */
export interface PtoExperimentDashboardCancelRequest {
  readonly sessionId: string
  readonly experimentId: string
}

/** Confirmation returned after the active executor has observed cancellation and settled. */
export interface PtoExperimentDashboardCancelResult {
  readonly cancelled: true
}

/** Ephemeral Host execution activity overlaid on a durable registry entry. */
export interface PtoExperimentDashboardExecutionActivity {
  readonly active: boolean
  readonly cancellable: boolean
}

/** Minimal app-owned metric presentation retained by the dashboard. */
export type PtoExperimentDashboardMetric =
  | {
    readonly status: 'collected'
    readonly value: number
    readonly unit: 'us'
    readonly definition: 'device-dispatch-makespan'
  }
  | {
    readonly status: 'not-observed' | 'invalid'
    readonly reason: string
  }

/** One durable experiment projected without storage or filesystem identity keys. */
export interface PtoExperimentDashboardEntry {
  readonly id: string
  readonly status: 'planned' | 'authorized' | 'running' | 'completed' | 'failed' | 'cancelled'
  readonly revision: number
  readonly declaredChange: string
  readonly baselinePath: string
  readonly candidateOutputPath: string
  readonly actualRunPath: string | null
  readonly metric: PtoExperimentDashboardMetric | null
  readonly failureReason: string | null
  readonly executionActivity: PtoExperimentDashboardExecutionActivity
  readonly createdAt: string
  readonly updatedAt: string
}

/** Newest-first bounded dashboard snapshot for one existing Session. */
export interface PtoExperimentDashboardSnapshot {
  readonly experiments: readonly PtoExperimentDashboardEntry[]
  readonly total: number
  readonly truncated: boolean
}
