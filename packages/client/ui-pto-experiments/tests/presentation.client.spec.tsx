// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '../src/client/index.ts'
import { ComparisonDetails } from '../src/client/ComparisonDetails.tsx'
import { ComparisonRow } from '../src/client/ComparisonRow.tsx'

afterEach(cleanup)

const t = ((key: string) => key) as TranslateNS<'ptoExperiments'>

function comparison(relativePct = -20): ToolCallBlock {
  const dimension = { status: 'matched', baseline: 'same', candidate: 'same' }
  const metric = (value: number) => ({
    status: 'collected', adapter: 'pypto-chip-swimlane-makespan-v1', identity: 'metric-v1',
    definition: 'device-dispatch-makespan', unit: 'us', scope: 'single-l2-run',
    aggregation: 'latest-finish-minus-earliest-dispatch', value, sampleCount: 1,
  })
  const evidence = {
    experimentId: 'candidate-2', baselineExperimentId: 'baseline-1', result: 'inconclusive',
    reasons: ['no user-owned threshold or repetition/significance rule is registered'],
    identity: {
      metric: dimension, task: dimension, hardware: dimension, environment: dimension,
      executionCommand: dimension, sourceLineage: dimension, changeSet: dimension,
    },
    baseline: { runPath: 'build_output/baseline', metric: metric(100) },
    candidate: { runPath: 'build_output/candidate', metric: metric(80) },
    delta: { absolute: -20, relativePct, direction: 'improved', significance: 'needs-user-confirmation' },
  }
  return {
    kind: 'tool-result', seq: 3, callId: 'call-1', isError: false,
    content: [{ type: 'text', text: JSON.stringify(evidence) }],
    call: { name: 'pto_experiment_compare', argsRaw: '{"experiment_id":"candidate-2"}' },
    subCalls: [],
  } as unknown as ToolCallBlock
}

const owner = (block: ToolCallBlock) => ({
  sessionId: 's1' as SessionId,
  callId: block.callId,
  toolName: 'pto_experiment_compare',
  block,
  t,
})

describe('PTO comparison presentation', () => {
  it('shows a verified delta while retaining the inconclusive label', () => {
    const block = comparison()
    const rowProps = { ...owner(block), openFile: () => {} } as Parameters<typeof ComparisonRow>[0]
    const row = render(<ComparisonRow {...rowProps} />)
    expect(row.container.textContent).toContain('100 → 80 us · -20%')
    expect(row.container.textContent).toContain('result.inconclusive')
    row.unmount()

    const detailsProps = owner(block) as Parameters<typeof ComparisonDetails>[0]
    const details = render(<ComparisonDetails {...detailsProps} />)
    expect(details.container.textContent).toContain('details.significance')
    expect(details.container.textContent).toContain('-20%')
    expect(details.container.querySelectorAll('[role="row"]')).toHaveLength(7)
  })

  it('suppresses numbers when a successful payload fails the evidence gate', () => {
    const detailsProps = owner(comparison(-99)) as Parameters<typeof ComparisonDetails>[0]
    const details = render(<ComparisonDetails {...detailsProps} />)
    expect(details.container.textContent).toContain('row.unavailable')
    expect(details.container.textContent).not.toContain('-99%')
    expect(details.container.querySelector('[data-state="unavailable"]')).not.toBeNull()
  })
})
