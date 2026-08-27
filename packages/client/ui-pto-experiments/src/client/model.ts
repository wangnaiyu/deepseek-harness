/** Strict, browser-local projection of the durable PTO comparison result. */
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-chat/client'

/** Ordered identity dimensions emitted by the Host comparison contract. */
export const COMPARISON_DIMENSIONS = [
  'metric',
  'task',
  'hardware',
  'environment',
  'executionCommand',
  'sourceLineage',
  'changeSet',
] as const

/** One closed comparison identity name. */
export type ComparisonDimensionName = typeof COMPARISON_DIMENSIONS[number]
/** Evidence match state for one identity dimension. */
export type ComparisonStatus = 'matched' | 'unmatched' | 'unavailable'

/** Side-by-side values and evidence state for one identity dimension. */
export interface ComparisonDimension {
  status: ComparisonStatus
  baseline: string | null
  candidate: string | null
}

/** Current app-owned, single-L2-run makespan observation admitted by the UI. */
export interface CollectedMetric {
  status: 'collected'
  adapter: 'pypto-chip-swimlane-makespan-v1'
  identity: string
  definition: 'device-dispatch-makespan'
  unit: 'us'
  scope: 'single-l2-run'
  aggregation: 'latest-finish-minus-earliest-dispatch'
  value: number
  sampleCount: 1
}

/** App-owned metric collection attempt that yielded no usable value. */
export interface UnavailableMetric {
  status: 'not-observed' | 'invalid'
  adapter: 'pypto-chip-swimlane-makespan-v1'
  reason: string
}

/** Metric state available on either side of a comparison. */
export type ComparisonMetric = CollectedMetric | UnavailableMetric

/** Closed durable evidence shape the PTO comparison UI may present. */
export interface PtoComparisonEvidence {
  experimentId: string
  baselineExperimentId: string | null
  result: 'incomparable' | 'inconclusive'
  reasons: readonly string[]
  identity: Record<ComparisonDimensionName, ComparisonDimension>
  baseline: { runPath: string; metric: ComparisonMetric | null }
  candidate: { runPath: string; metric: ComparisonMetric | null }
  delta: null | {
    absolute: number
    relativePct: number | null
    direction: 'improved' | 'regressed' | 'unchanged'
    significance: 'needs-user-confirmation'
  }
}

/** Fail-closed lifecycle and evidence states rendered by the comparison UI. */
export type ComparisonViewModel =
  | { state: 'running'; experimentId: string }
  | { state: 'error'; experimentId: string; message: string }
  | { state: 'unavailable'; experimentId: string; reason: string }
  | { state: 'evidence'; evidence: PtoComparisonEvidence }

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function firstLine(value: string): string {
  return value.split('\n', 1)[0] ?? value
}

function experimentIdFromArgs(block: ToolCallBlock): string {
  const raw = ('kind' in block ? block.call?.argsRaw : block.argsRaw) ?? ''
  try {
    const args = record(JSON.parse(raw) as unknown)
    if (args !== null && nonempty(args.experiment_id)) return firstLine(args.experiment_id)
    if (args !== null && nonempty(args.experimentId)) return firstLine(args.experimentId)
  } catch {
    // A running call may expose a truncated JSON prefix.
  }
  return block.callId
}

function resultText(block: Extract<ToolCallBlock, { kind: string }>): string {
  const parts = block.content.map(item => item.type === 'text' ? item.text : JSON.stringify(item))
  if (parts.length === 0 && block.error !== undefined) parts.push(`${block.error.name}: ${block.error.code}`)
  return parts.join('\n')
}

function parseDimension(value: unknown): ComparisonDimension | null {
  const candidate = record(value)
  if (candidate === null
    || !['matched', 'unmatched', 'unavailable'].includes(String(candidate.status))
    || !nullableString(candidate.baseline)
    || !nullableString(candidate.candidate)) return null
  return {
    status: candidate.status as ComparisonStatus,
    baseline: candidate.baseline,
    candidate: candidate.candidate,
  }
}

function parseMetric(value: unknown): ComparisonMetric | null | undefined {
  if (value === null) return null
  const metric = record(value)
  if (metric === null || metric.adapter !== 'pypto-chip-swimlane-makespan-v1') return undefined
  if (metric.status === 'collected') {
    if (!nonempty(metric.identity)
      || metric.definition !== 'device-dispatch-makespan'
      || metric.unit !== 'us'
      || metric.scope !== 'single-l2-run'
      || metric.aggregation !== 'latest-finish-minus-earliest-dispatch'
      || !finite(metric.value)
      || metric.value < 0
      || metric.sampleCount !== 1) return undefined
    return metric as unknown as CollectedMetric
  }
  if ((metric.status === 'not-observed' || metric.status === 'invalid') && nonempty(metric.reason)) {
    return metric as unknown as UnavailableMetric
  }
  return undefined
}

function parseSide(value: unknown): PtoComparisonEvidence['baseline'] | null {
  const side = record(value)
  if (side === null || !nonempty(side.runPath)) return null
  const metric = parseMetric(side.metric)
  return metric === undefined ? null : { runPath: side.runPath, metric }
}

function parseEvidence(value: unknown): PtoComparisonEvidence | null {
  const input = record(value)
  if (input === null
    || !nonempty(input.experimentId)
    || !nullableString(input.baselineExperimentId)
    || (input.result !== 'incomparable' && input.result !== 'inconclusive')
    || !Array.isArray(input.reasons)
    || !input.reasons.every(nonempty)) return null

  const rawIdentity = record(input.identity)
  if (rawIdentity === null) return null
  const identity = {} as Record<ComparisonDimensionName, ComparisonDimension>
  for (const name of COMPARISON_DIMENSIONS) {
    const dimension = parseDimension(rawIdentity[name])
    if (dimension === null) return null
    identity[name] = dimension
  }
  const baseline = parseSide(input.baseline)
  const candidate = parseSide(input.candidate)
  if (baseline === null || candidate === null) return null

  if (input.result === 'incomparable') {
    if (input.delta !== null || input.reasons.length === 0) return null
    return {
      experimentId: input.experimentId,
      baselineExperimentId: input.baselineExperimentId,
      result: input.result,
      reasons: input.reasons,
      identity,
      baseline,
      candidate,
      delta: null,
    }
  }

  const delta = record(input.delta)
  const allMatched = COMPARISON_DIMENSIONS.every(name => identity[name].status === 'matched')
  if (!allMatched
    || input.baselineExperimentId === null
    || baseline.metric?.status !== 'collected'
    || candidate.metric?.status !== 'collected'
    || delta === null
    || !finite(delta.absolute)
    || !(delta.relativePct === null || finite(delta.relativePct))
    || !['improved', 'regressed', 'unchanged'].includes(String(delta.direction))
    || delta.significance !== 'needs-user-confirmation') return null

  const expectedAbsolute = candidate.metric.value - baseline.metric.value
  const expectedDirection = expectedAbsolute < 0 ? 'improved' : expectedAbsolute > 0 ? 'regressed' : 'unchanged'
  const expectedRelative = baseline.metric.value === 0 ? null : expectedAbsolute / baseline.metric.value * 100
  const close = (left: number, right: number): boolean => Math.abs(left - right) <= 1e-9 * Math.max(1, Math.abs(left), Math.abs(right))
  if (!close(delta.absolute, expectedAbsolute)
    || delta.direction !== expectedDirection
    || (expectedRelative === null
      ? delta.relativePct !== null
      : delta.relativePct === null || !close(delta.relativePct, expectedRelative))) {
    return null
  }

  return {
    experimentId: input.experimentId,
    baselineExperimentId: input.baselineExperimentId,
    result: input.result,
    reasons: input.reasons,
    identity,
    baseline,
    candidate,
    delta: {
      absolute: delta.absolute,
      relativePct: delta.relativePct,
      direction: delta.direction as 'improved' | 'regressed' | 'unchanged',
      significance: 'needs-user-confirmation',
    },
  }
}

/**
 * Build the fail-closed comparison UI model from one frozen durable call.
 * @param block - running call or settled durable Tool result from the transcript.
 * @returns a lifecycle state or fully admitted comparison evidence.
 */
export function comparisonViewModel(block: ToolCallBlock): ComparisonViewModel {
  const experimentId = experimentIdFromArgs(block)
  if (!('kind' in block)) return { state: 'running', experimentId }
  const text = resultText(block)
  if (block.isError) return { state: 'error', experimentId, message: firstLine(text) || 'Tool call failed' }
  try {
    const evidence = parseEvidence(JSON.parse(text) as unknown)
    if (evidence !== null) return { state: 'evidence', evidence }
  } catch {
    // The success channel is not evidence unless it is the closed schema.
  }
  return { state: 'unavailable', experimentId, reason: 'Comparison result did not match the evidence schema.' }
}
