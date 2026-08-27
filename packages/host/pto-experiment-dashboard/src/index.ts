/** Session-addressed Host projection and user execution edge for the PTO experiment dashboard. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { PtoExperimentMetric, PtoExperimentView } from '@deepseek-ai/dsh-pto-experiments'
import { SessionId } from '@deepseek-ai/dsh-session'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  PtoExperimentDashboardEntry,
  PtoExperimentDashboardCancelRequest,
  PtoExperimentDashboardCancelResult,
  PtoExperimentDashboardExecuteRequest,
  PtoExperimentDashboardExecutionActivity,
  PtoExperimentDashboardMetric,
  PtoExperimentDashboardRequest,
  PtoExperimentDashboardSnapshot,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Session-addressed PTO experiment dashboard and user execution edge. */
    ptoExperimentDashboard: PtoExperimentDashboardGateway
  }
}

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100
const MAX_SUMMARY_LENGTH = 1_000
const INACTIVE_EXECUTION = Object.freeze({ active: false, cancellable: false })

interface ActiveExecution {
  readonly sessionId: SessionId
  readonly cwd: string
  readonly agent: Agent
  readonly messageId: ReturnType<typeof createUserMessage>['id']
  readonly experimentId: string
  readonly expectedRevision: number
  readonly controller: AbortController
  readonly completion: Promise<PtoExperimentDashboardEntry>
  readonly settled: Promise<void>
  readonly complete: (entry: PtoExperimentDashboardEntry) => void
  readonly fail: (error: Error) => void
}

interface SessionTarget {
  readonly sessionId: SessionId
  readonly cwd: string
}

/** A dashboard request named a Session that is not attached to this Host. */
export class PtoExperimentDashboardSessionNotFound extends Error {
  constructor(readonly sessionId: string) {
    super(`PTO experiment dashboard session '${sessionId}' does not exist`)
    this.name = 'PtoExperimentDashboardSessionNotFound'
  }
}

/** A dashboard request named a Session without a Workspace cwd. */
export class PtoExperimentDashboardWorkspaceUnavailable extends Error {
  constructor(readonly sessionId: string) {
    super(`PTO experiment dashboard session '${sessionId}' has no Workspace`)
    this.name = 'PtoExperimentDashboardWorkspaceUnavailable'
  }
}

function boundedLimit(value: number | undefined): number {
  const limit = value ?? DEFAULT_LIMIT
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new TypeError(`limit must be a positive safe integer no greater than ${MAX_LIMIT}`)
  }
  return limit
}

function boundedSummary(value: string): string {
  return value.length <= MAX_SUMMARY_LENGTH
    ? value
    : `${value.slice(0, MAX_SUMMARY_LENGTH - 3)}...`
}

function rejectionError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function metricView(metric: PtoExperimentMetric): PtoExperimentDashboardMetric {
  return metric.status === 'collected'
    ? Object.freeze({
      status: metric.status,
      value: metric.value,
      unit: metric.unit,
      definition: metric.definition,
    })
    : Object.freeze({ status: metric.status, reason: boundedSummary(metric.reason) })
}

function entryView(
  experiment: PtoExperimentView,
  executionActivity: PtoExperimentDashboardExecutionActivity = INACTIVE_EXECUTION,
): PtoExperimentDashboardEntry {
  return Object.freeze({
    id: experiment.id,
    status: experiment.status,
    revision: experiment.revision,
    declaredChange: boundedSummary(experiment.change.summary),
    baselinePath: experiment.baseline.path,
    candidateOutputPath: experiment.candidateOutput.path,
    actualRunPath: experiment.actualRun?.path ?? null,
    metric: experiment.actualRun === null ? null : metricView(experiment.actualRun.metric),
    failureReason: experiment.failure === null ? null : boundedSummary(experiment.failure.reason),
    executionActivity,
    createdAt: experiment.createdAt,
    updatedAt: experiment.updatedAt,
  })
}

/** Session-authorized Remote edge over the durable PTO experiment registry. */
export class PtoExperimentDashboardGateway extends TypertRemoteService {
  static inject = ['sessions', 'agents', 'ptoExperiments']

  private readonly activeExecutions = new Map<string, ActiveExecution>()

  constructor(ctx: Context) {
    super(ctx, 'ptoExperimentDashboard')
    ctx.on('agent/pre-step', async ({ agent, messages, signal }, next): Promise<PreStepDecision> => {
      const active = [...this.activeExecutions.values()].find(execution =>
        execution.agent === agent && messages.some(message => message.id === execution.messageId))
      if (active === undefined) return next()

      try {
        const result = await this.ctx.ptoExperiments.execute(
          { cwd: active.cwd, agent, signal: AbortSignal.any([active.controller.signal, signal]) },
          { experimentId: active.experimentId, expectedRevision: active.expectedRevision },
        )
        active.complete(entryView(result))
      } catch (error: unknown) {
        active.fail(rejectionError(error))
      }
      // The private plugin message exists only to open the durable turn that
      // encloses approval/asked + approval/decided. It is claimed from the
      // inbox but never appended as a model-facing user/message or sent to an
      // LLM; this plugin owns and completes the whole turn payload here.
      return { kind: 'reject' }
    })
    ctx.effect(() => async () => {
      const active = [...this.activeExecutions.values()]
      for (const execution of active) {
        const reason = new Error('PTO experiment dashboard gateway stopped')
        execution.controller.abort(reason)
        if (execution.agent.inbox.remove(execution.messageId)) execution.fail(reason)
      }
      await Promise.allSettled(active.map(execution => execution.settled))
    }, 'pto-experiment-dashboard: settle active executions on disposal')
  }

  private sessionTarget(rawSessionId: string): SessionTarget {
    const sessionId = SessionId(rawSessionId)
    const session = this.ctx.sessions.get(sessionId)
    if (session === undefined) throw new PtoExperimentDashboardSessionNotFound(rawSessionId)
    if (session.header.cwd === undefined) {
      throw new PtoExperimentDashboardWorkspaceUnavailable(rawSessionId)
    }
    return { sessionId, cwd: session.header.cwd }
  }

  /**
   * List one existing Session's newest durable experiments. The caller supplies
   * no path: Host-owned Session metadata selects the Workspace, and the read
   * never creates or resumes an Agent, Session, or turn.
   * @param request - existing Session identity and optional bounded limit.
   * @returns minimal dashboard projection without storage identity keys.
   */
  @Remote('listSession')
  async listSession(request: PtoExperimentDashboardRequest): Promise<PtoExperimentDashboardSnapshot> {
    const target = this.sessionTarget(request.sessionId)
    const result = await this.ctx.ptoExperiments.list(
      { cwd: target.cwd },
      boundedLimit(request.limit),
    )
    return Object.freeze({
      experiments: Object.freeze(result.experiments.map((experiment) => {
        const active = this.activeExecutions.get(experiment.id)
        return entryView(experiment, active === undefined
          ? INACTIVE_EXECUTION
          : Object.freeze({ active: true, cancellable: active.sessionId === target.sessionId }))
      })),
      total: result.total,
      truncated: result.truncated,
    })
  }

  /**
   * Execute one planned experiment through the trusted registry admission loop.
   * The long Remote survives view unmount. A private plugin follow-up opens a
   * normal Agent turn; this gateway consumes it at pre-step, so the existing
   * approval surface can append its audit pair inside a durable turn without
   * sending any synthetic prompt to the model. Optimistic revision is
   * preserved exactly.
   * @param request - initiating Session and planned experiment identity.
   * @returns terminal dashboard projection after approval and execution settle.
   */
  @Remote('executeSession')
  async executeSession(request: PtoExperimentDashboardExecuteRequest): Promise<PtoExperimentDashboardEntry> {
    const target = this.sessionTarget(request.sessionId)
    const agent = this.ctx.agents.get(target.sessionId)
    if (agent === undefined) {
      throw new Error(`PTO experiment dashboard session '${request.sessionId}' has no live Agent`)
    }
    if (this.activeExecutions.has(request.experimentId)) {
      throw new Error(`experiment ${request.experimentId} already has an active dashboard execution`)
    }
    const controller = new AbortController()
    const message = createUserMessage({
      content: [{
        type: 'text',
        text: `Execute PTO experiment ${request.experimentId}@${request.expectedRevision} from the dashboard.`,
      }],
      source: {
        kind: 'plugin',
        plugin: 'pto-experiment-dashboard',
        form: 'notice',
        summary: request.experimentId,
      },
    })
    let complete!: (entry: PtoExperimentDashboardEntry) => void
    let fail!: (error: Error) => void
    let finished = false
    const completion = new Promise<PtoExperimentDashboardEntry>((resolve, reject) => {
      complete = (entry) => {
        if (finished) return
        finished = true
        resolve(entry)
      }
      fail = (error) => {
        if (finished) return
        finished = true
        reject(error)
      }
    })
    const active: ActiveExecution = {
      sessionId: target.sessionId,
      cwd: target.cwd,
      agent,
      messageId: message.id,
      experimentId: request.experimentId,
      expectedRevision: request.expectedRevision,
      controller,
      completion,
      settled: completion.then(() => undefined, () => undefined),
      complete,
      fail,
    }
    this.activeExecutions.set(request.experimentId, active)
    try {
      agent.followup(message)
    } catch (error: unknown) {
      active.fail(rejectionError(error))
    }
    return await completion.finally(() => {
      this.activeExecutions.delete(request.experimentId)
    })
  }

  /**
   * Cancel an active execution owned by the same initiating Session. The call
   * returns only after the long execution Remote has settled its Host state.
   * @param request - initiating Session and active experiment identity.
   * @returns cancellation confirmation after executor settlement.
   */
  @Remote('cancelSession')
  async cancelSession(request: PtoExperimentDashboardCancelRequest): Promise<PtoExperimentDashboardCancelResult> {
    const target = this.sessionTarget(request.sessionId)
    const active = this.activeExecutions.get(request.experimentId)
    if (active === undefined || active.sessionId !== target.sessionId) {
      throw new Error(`session ${request.sessionId} does not own an active execution for ${request.experimentId}`)
    }
    const reason = new Error('cancelled by dashboard user')
    active.controller.abort(reason)
    if (active.agent.inbox.remove(active.messageId)) {
      try {
        const current = await this.ctx.ptoExperiments.get({ cwd: active.cwd }, active.experimentId)
        active.complete(entryView(current))
      } catch (error: unknown) {
        // Removing a queued message means no pre-step handler remains to settle
        // the long execute Remote. Mirror the lookup failure into that Promise
        // so both callers terminate and the active entry can be released.
        const rejection = rejectionError(error)
        active.fail(rejection)
        await active.settled
        throw rejection
      }
    }
    await active.settled
    return Object.freeze({ cancelled: true })
  }
}

export default PtoExperimentDashboardGateway
