// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { PtoExperimentDashboardSnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '../src/client/index.ts'
import { ExperimentDashboardView } from '../src/client/DashboardView.tsx'

afterEach(cleanup)

const t = ((key: string) => key) as TranslateNS<'ptoExperiments'>

const snapshot: PtoExperimentDashboardSnapshot = {
  experiments: [{
    id: 'pto-exp-1', status: 'completed', revision: 4,
    declaredChange: 'Use a different schedule edge',
    baselinePath: '/work/pto/baseline',
    candidateOutputPath: '/work/pto/candidate',
    actualRunPath: '/work/pto/candidate-run',
    metric: { status: 'collected', value: 80, unit: 'us', definition: 'device-dispatch-makespan' },
    failureReason: null,
    executionActivity: { active: false, cancellable: false },
    createdAt: '2026-08-27T00:00:00.000Z',
    updatedAt: '2026-08-27T00:01:00.000Z',
  }],
  total: 1,
  truncated: false,
}

function props(loadExperiments: () => Promise<PtoExperimentDashboardSnapshot>) {
  return {
    sessionId: 'session-1' as SessionId,
    loadExperiments,
    executeExperiment: vi.fn(() => Promise.resolve(snapshot.experiments[0]!)),
    cancelExecution: vi.fn(() => Promise.resolve({ cancelled: true as const })),
    t,
  } as unknown as Parameters<typeof ExperimentDashboardView>[0]
}

describe('PTO experiment dashboard', () => {
  it('loads the authoritative snapshot and keeps paths in tooltips', async () => {
    const load = vi.fn(() => Promise.resolve(snapshot))
    render(<ExperimentDashboardView {...props(load)} />)

    expect(screen.getByRole('status').textContent).toBe('dashboard.loading')
    await screen.findByText('Use a different schedule edge')
    expect(load).toHaveBeenCalledTimes(1)
    expect(screen.getByText('80 us')).not.toBeNull()
    expect(screen.getByText('candidate-run').getAttribute('title')).toBe('/work/pto/candidate-run')
  })

  it('refreshes explicitly and contains Remote failures in the view', async () => {
    const load = vi.fn<() => Promise<PtoExperimentDashboardSnapshot>>()
      .mockResolvedValueOnce(snapshot)
      .mockRejectedValueOnce(new Error('registry unavailable'))
    render(<ExperimentDashboardView {...props(load)} />)
    await screen.findByText('Use a different schedule edge')

    fireEvent.click(screen.getByRole('button', { name: 'dashboard.refresh' }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('registry unavailable') })
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('executes with the visible optimistic revision and refreshes after settlement', async () => {
    const completed = {
      ...snapshot,
      experiments: [{ ...snapshot.experiments[0]!, status: 'completed' as const, revision: 4 }],
    }
    const load = vi.fn<() => Promise<PtoExperimentDashboardSnapshot>>()
      .mockResolvedValueOnce({
        ...snapshot,
        experiments: [{ ...snapshot.experiments[0]!, status: 'planned', revision: 0 }],
      })
      .mockResolvedValue(completed)
    const executeExperiment = vi.fn(() => Promise.resolve(completed.experiments[0]!))
    render(<ExperimentDashboardView {...props(load)} executeExperiment={executeExperiment} />)
    await screen.findByRole('button', { name: 'dashboard.execution.execute' })

    fireEvent.click(screen.getByRole('button', { name: 'dashboard.execution.execute' }))
    expect(screen.getByRole('status').textContent).toBe('dashboard.execution.active')
    await waitFor(() => { expect(load).toHaveBeenCalledTimes(2) })
    expect(executeExperiment).toHaveBeenCalledWith('pto-exp-1', 0)
    await screen.findByText('dashboard.status.completed')
  })

  it('offers explicit cancellation but does not cancel merely because the view unmounts', async () => {
    let finish: ((value: PtoExperimentDashboardSnapshot['experiments'][number]) => void) | undefined
    const executeExperiment = vi.fn(() => new Promise<PtoExperimentDashboardSnapshot['experiments'][number]>((resolve) => {
      finish = resolve
    }))
    const cancelExecution = vi.fn(() => Promise.resolve({ cancelled: true as const }))
    const load = vi.fn(() => Promise.resolve({
      ...snapshot,
      experiments: [{ ...snapshot.experiments[0]!, status: 'planned' as const, revision: 0 }],
    }))
    const view = render(<ExperimentDashboardView
      {...props(load)} executeExperiment={executeExperiment} cancelExecution={cancelExecution}
    />)
    await screen.findByRole('button', { name: 'dashboard.execution.execute' })
    fireEvent.click(screen.getByRole('button', { name: 'dashboard.execution.execute' }))
    await screen.findByRole('button', { name: 'dashboard.execution.cancel' })

    view.unmount()
    expect(cancelExecution).not.toHaveBeenCalled()
    finish?.({ ...snapshot.experiments[0]!, status: 'cancelled', revision: 4 })
  })
})
