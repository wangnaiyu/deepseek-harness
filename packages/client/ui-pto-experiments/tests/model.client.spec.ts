import { describe, expect, it } from 'vitest'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-chat/client'
import { comparisonViewModel } from '../src/client/model.ts'

const dimension = (status: 'matched' | 'unmatched' | 'unavailable' = 'matched') => ({
  status,
  baseline: status === 'unavailable' ? null : 'same',
  candidate: status === 'unavailable' ? null : status === 'matched' ? 'same' : 'different',
})

const metric = (value: number) => ({
  status: 'collected',
  adapter: 'pypto-chip-swimlane-makespan-v1',
  identity: 'metric-v1',
  definition: 'device-dispatch-makespan',
  unit: 'us',
  scope: 'single-l2-run',
  aggregation: 'latest-finish-minus-earliest-dispatch',
  value,
  sampleCount: 1,
})

function evidence() {
  return {
    experimentId: 'candidate-2',
    baselineExperimentId: 'baseline-1',
    result: 'inconclusive',
    reasons: ['no user-owned threshold or repetition/significance rule is registered'],
    identity: {
      metric: dimension(), task: dimension(), hardware: dimension(), environment: dimension(),
      executionCommand: dimension(), sourceLineage: dimension(), changeSet: dimension(),
    },
    baseline: { runPath: 'build_output/baseline', metric: metric(100) },
    candidate: { runPath: 'build_output/candidate', metric: metric(80) },
    delta: {
      absolute: -20,
      relativePct: -20,
      direction: 'improved',
      significance: 'needs-user-confirmation',
    },
  }
}

function settled(value: unknown, isError = false): ToolCallBlock {
  return {
    kind: 'tool-result',
    seq: 3,
    callId: 'call-1',
    isError,
    content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }],
    call: { name: 'pto_experiment_compare', argsRaw: '{"experiment_id":"candidate-2"}' },
    subCalls: [],
  } as unknown as ToolCallBlock
}

describe('comparisonViewModel', () => {
  it('admits a consistent seven-dimension comparison without upgrading its conclusion', () => {
    const model = comparisonViewModel(settled(evidence()))
    expect(model).toMatchObject({
      state: 'evidence',
      evidence: { result: 'inconclusive', delta: { relativePct: -20, significance: 'needs-user-confirmation' } },
    })
  })

  it('fails closed when the durable delta disagrees with the admitted metrics', () => {
    const value = evidence()
    value.delta.relativePct = -99
    expect(comparisonViewModel(settled(value))).toEqual({
      state: 'unavailable',
      experimentId: 'candidate-2',
      reason: 'Comparison result did not match the evidence schema.',
    })
  })

  it('admits an incomparable result only without a combined delta', () => {
    const admitted = evidence()
    const value = {
      ...admitted,
      result: 'incomparable',
      baselineExperimentId: null,
      identity: { ...admitted.identity, task: dimension('unmatched') },
      delta: null,
    }
    expect(comparisonViewModel(settled(value))).toMatchObject({
      state: 'evidence',
      evidence: { result: 'incomparable', delta: null },
    })
  })

  it('keeps a failed tool result out of the evidence path', () => {
    expect(comparisonViewModel(settled('comparison failed\nmore detail', true))).toEqual({
      state: 'error',
      experimentId: 'candidate-2',
      message: 'comparison failed',
    })
  })
})
