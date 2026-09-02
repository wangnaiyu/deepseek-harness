import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { agentEvents, type Agent } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, type Session } from '@deepseek-ai/dsh-session'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import PtoExperimentDashboardGateway from '../src/index.ts'

const contexts: Context[] = []

function liveAgent(ctx: Context, session: Session): Agent {
  let pending: UserMessage | undefined
  const agent = {
    id: session.id,
    session,
    inbox: {
      remove: (messageId: UserMessage['id']) => {
        if (pending?.id !== messageId) return false
        pending = undefined
        return true
      },
    },
    followup: (message: UserMessage) => {
      pending = message
      queueMicrotask(() => {
        if (pending?.id !== message.id) return
        pending = undefined
        session.append('turn/start', { turn: 1 })
        void agentEvents(ctx, agent as unknown as Agent).waterfall(
          'agent/pre-step',
          {
            messages: [message],
            turn: 1,
            step: 1,
            signal: new AbortController().signal,
          },
          () => Promise.resolve({ kind: 'enter' as const, messages: [message] }),
        ).then((decision) => {
          expect(decision).toEqual({ kind: 'reject' })
          session.append('turn/end', { turn: 1, reason: { kind: 'blocked' } })
        })
      })
    },
  }
  return agent as unknown as Agent
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

async function harness(executeImpl?: (scope: { signal?: AbortSignal }, input: unknown) => Promise<unknown>) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  const list = vi.fn(() => Promise.resolve({
    experiments: [{
      id: 'pto-exp-1', status: 'completed', revision: 4,
      workspaceKey: 'opaque-workspace',
      workspacePath: '/work/pto',
      baseline: { path: '/work/pto/baseline', targetKey: 'opaque-baseline' },
      source: { path: '/work/pto/source', targetKey: 'opaque-source', identity: { status: 'unverified' } },
      environment: { identity: { status: 'unverified' } },
      candidateOutput: { path: '/work/pto/candidate', targetKey: 'opaque-candidate' },
      change: { summary: 'Use a different schedule edge', evidenceRefs: [] },
      controls: { stopConditions: 'stop', rollbackPlan: 'rollback' },
      execution: { command: 'run', timeoutMs: 1 },
      authorization: null,
      actualRun: {
        path: '/work/pto/candidate', targetKey: 'opaque-actual', kind: 'l2',
        marker: 'kernel_config.py', identityStatus: 'registry-bound', observedAt: '2026-08-27T00:01:00.000Z',
        metric: {
          status: 'collected', adapter: 'pypto-chip-swimlane-makespan-v1', identity: 'metric-v1',
          definition: 'device-dispatch-makespan', unit: 'us', scope: 'single-l2-run',
          aggregation: 'latest-finish-minus-earliest-dispatch', value: 80, sampleCount: 1,
          collection: {}, taskIdentity: {}, hardwareIdentity: {}, lineage: {},
        },
      },
      failure: null,
      events: [],
      createdAt: '2026-08-27T00:00:00.000Z',
      updatedAt: '2026-08-27T00:01:00.000Z',
    }],
    total: 1,
    truncated: false,
  }))
  const agents = new Map<string, Agent>()
  const execute = vi.fn(executeImpl ?? (() => Promise.reject(new Error('unexpected execute'))))
  const get = vi.fn(async () => ({
    ...(await list()).experiments[0],
    status: 'planned',
    revision: 0,
    actualRun: null,
  }))
  ctx.provide('agents', { get: (id: string) => agents.get(id) } as never)
  ctx.provide('ptoExperiments', { list, get, execute } as never)
  await ctx.plugin(PtoExperimentDashboardGateway)
  return { ctx, list, get, agents, execute, dashboard: ctx.ptoExperimentDashboard }
}

describe('PtoExperimentDashboardGateway', () => {
  it('publishes one direct read-only Remote', async () => {
    const { dashboard } = await harness()
    expect(dashboard.typertRemote).toMatchObject({
      serviceKey: 'ptoExperimentDashboard', namespace: 'ptoExperimentDashboard',
    })
    expect(remoteMethods(dashboard)).toEqual([
      { method: 'listSession', invocation: { kind: 'direct' } },
      { method: 'executeSession', invocation: { kind: 'direct' } },
      { method: 'cancelSession', invocation: { kind: 'direct' } },
    ])
  })

  it('derives cwd from the Session and strips internal identities', async () => {
    const { ctx, list, dashboard } = await harness()
    ctx.sessions.create(SessionId('session-1'), { meta: { cwd: '/work/pto' } })

    const before = ctx.sessions.list()
    const result = await dashboard.listSession({ sessionId: 'session-1', limit: 7 })

    expect(ctx.sessions.list()).toEqual(before)
    expect(list).toHaveBeenCalledWith({ cwd: '/work/pto' }, 7)
    expect(result).toEqual({
      experiments: [{
        id: 'pto-exp-1', status: 'completed', revision: 4,
        declaredChange: 'Use a different schedule edge',
        baselinePath: '/work/pto/baseline',
        candidateOutputPath: '/work/pto/candidate',
        actualRunPath: '/work/pto/candidate',
        metric: { status: 'collected', value: 80, unit: 'us', definition: 'device-dispatch-makespan' },
        failureReason: null,
        executionActivity: { active: false, cancellable: false },
        createdAt: '2026-08-27T00:00:00.000Z',
        updatedAt: '2026-08-27T00:01:00.000Z',
      }],
      total: 1,
      truncated: false,
    })
    expect(JSON.stringify(result)).not.toMatch(/workspaceKey|targetKey/u)
  })

  it('rejects unknown Sessions before reading the registry', async () => {
    const { list, dashboard } = await harness()
    await expect(dashboard.listSession({ sessionId: 'missing' }))
      .rejects.toThrow("PTO experiment dashboard session 'missing' does not exist")
    expect(list).not.toHaveBeenCalled()
  })

  it('requires a live Agent, preserves revision, and lets only the initiating Session cancel', async () => {
    let observedSignal: AbortSignal | undefined
    const terminal = {
      id: 'pto-exp-1', status: 'cancelled', revision: 4,
      workspaceKey: 'opaque-workspace', workspacePath: '/work/pto',
      baseline: { path: '/work/pto/baseline', targetKey: 'opaque-baseline' },
      source: { path: '/work/pto/source', targetKey: 'opaque-source', identity: { status: 'unverified' } },
      environment: { identity: { status: 'unverified' } },
      candidateOutput: { path: '/work/pto/candidate', targetKey: 'opaque-candidate' },
      change: { summary: 'Use a different schedule edge', evidenceRefs: [] },
      controls: { stopConditions: 'stop', rollbackPlan: 'rollback' },
      execution: { command: 'run', timeoutMs: 1 }, authorization: null, actualRun: null,
      failure: { reason: 'experiment execution was cancelled' }, events: [],
      createdAt: '2026-08-27T00:00:00.000Z', updatedAt: '2026-08-27T00:01:00.000Z',
    }
    const { ctx, agents, execute, dashboard } = await harness(scope => new Promise((resolve) => {
      observedSignal = scope.signal
      scope.signal?.addEventListener('abort', () => { resolve(terminal) }, { once: true })
    }))
    const session = ctx.sessions.create(SessionId('session-1'), { meta: { cwd: '/work/pto' } })
    ctx.sessions.create(SessionId('session-2'), { meta: { cwd: '/work/pto' } })

    await expect(dashboard.executeSession({
      sessionId: 'session-1', experimentId: 'pto-exp-1', expectedRevision: 0,
    })).rejects.toThrow('has no live Agent')
    const agent = liveAgent(ctx, session)
    agents.set('session-1', agent)

    const execution = dashboard.executeSession({
      sessionId: 'session-1', experimentId: 'pto-exp-1', expectedRevision: 0,
    })
    await vi.waitFor(() => { expect(execute).toHaveBeenCalledTimes(1) })
    expect(execute.mock.calls[0]?.[0]).toMatchObject({ cwd: '/work/pto', agent })
    expect(execute.mock.calls[0]?.[1]).toEqual({ experimentId: 'pto-exp-1', expectedRevision: 0 })
    expect(session.snapshotEvents().at(-1)?.type).toBe('turn/start')

    const ownerView = await dashboard.listSession({ sessionId: 'session-1' })
    const observerView = await dashboard.listSession({ sessionId: 'session-2' })
    expect(ownerView.experiments[0]?.executionActivity).toEqual({ active: true, cancellable: true })
    expect(observerView.experiments[0]?.executionActivity).toEqual({ active: true, cancellable: false })
    await expect(dashboard.executeSession({
      sessionId: 'session-1', experimentId: 'pto-exp-1', expectedRevision: 0,
    })).rejects.toThrow('already has an active dashboard execution')
    await expect(dashboard.cancelSession({ sessionId: 'session-2', experimentId: 'pto-exp-1' }))
      .rejects.toThrow('does not own an active execution')

    await expect(dashboard.cancelSession({ sessionId: 'session-1', experimentId: 'pto-exp-1' }))
      .resolves.toEqual({ cancelled: true })
    expect(observedSignal?.aborted).toBe(true)
    await expect(execution).resolves.toMatchObject({
      id: 'pto-exp-1', status: 'cancelled', revision: 4,
      executionActivity: { active: false, cancellable: false },
    })
    await vi.waitFor(() => {
      expect(session.snapshotEvents().map(event => event.type)).toEqual(['turn/start', 'turn/end'])
    })
  })

  it('settles a queued execution when cancellation removes its private follow-up before pre-step', async () => {
    const { ctx, agents, get, execute, dashboard } = await harness()
    const session = ctx.sessions.create(SessionId('session-1'), { meta: { cwd: '/work/pto' } })
    let pending: UserMessage | undefined
    const agent = {
      id: session.id,
      session,
      inbox: {
        remove: (messageId: UserMessage['id']) => {
          if (pending?.id !== messageId) return false
          pending = undefined
          return true
        },
      },
      followup: (message: UserMessage) => { pending = message },
    } as unknown as Agent
    agents.set('session-1', agent)

    const execution = dashboard.executeSession({
      sessionId: 'session-1', experimentId: 'pto-exp-1', expectedRevision: 0,
    })
    await expect(dashboard.cancelSession({ sessionId: 'session-1', experimentId: 'pto-exp-1' }))
      .resolves.toEqual({ cancelled: true })
    await expect(execution).resolves.toMatchObject({
      id: 'pto-exp-1', status: 'planned', revision: 0,
      executionActivity: { active: false, cancellable: false },
    })
    expect(get).toHaveBeenCalledWith({ cwd: '/work/pto' }, 'pto-exp-1')
    expect(execute).not.toHaveBeenCalled()
    expect(session.snapshotEvents()).toEqual([])
  })
})
