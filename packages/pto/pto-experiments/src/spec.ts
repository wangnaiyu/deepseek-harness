/**
 * Zod-validated durable records for PTO experiment planning and later trusted transitions.
 * @module @deepseek-ai/dsh-pto-experiments/src/spec
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

/** Closed lifecycle vocabulary validated at the durable boundary. */
export const ptoExperimentStatusSchema = z.union([
  z.literal('planned'),
  z.literal('authorized'),
  z.literal('running'),
  z.literal('completed'),
  z.literal('failed'),
  z.literal('cancelled'),
])

/** Persisted experiment lifecycle state. */
export type PtoExperimentStatus = z.infer<typeof ptoExperimentStatusSchema>

const timestampSchema = z.string().refine(
  value => Number.isFinite(Date.parse(value)),
  'must be an ISO-8601 timestamp',
)

const identitySchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('unverified'),
    value: z.null(),
    adapter: z.null(),
    evidence: z.array(z.string()),
    trust: z.literal('none'),
  }),
  z.object({
    status: z.literal('verified'),
    value: z.string().min(1),
    adapter: z.string().min(1),
    evidence: z.array(z.string().min(1)),
    trust: z.literal('trusted-adapter'),
  }),
])

const authorizationReceiptSchema = z.object({
  actor: z.string().min(1),
  approvalId: z.string().min(1),
  sessionId: z.string().min(1),
  authorizedAt: timestampSchema,
  trust: z.literal('user-approval'),
})

const eventSchema = z.object({
  revision: z.number().int().nonnegative(),
  type: z.union([
    z.literal('planned'),
    z.literal('identities-bound'),
    z.literal('authorized'),
    z.literal('execution-started'),
    z.literal('execution-completed'),
    z.literal('execution-failed'),
    z.literal('cancelled'),
  ]),
  state: ptoExperimentStatusSchema,
  actor: z.string().min(1),
  at: timestampSchema,
  details: z.record(z.string(), z.json()),
})

const metricIdentitySchema = z.object({
  value: z.string().min(1),
  adapter: z.string().min(1),
  evidence: z.array(z.string().min(1)),
})

const collectedMetricSchema = z.object({
  status: z.literal('collected'),
  adapter: z.literal('pypto-chip-swimlane-makespan-v1'),
  identity: z.string().min(1),
  definition: z.literal('device-dispatch-makespan'),
  unit: z.literal('us'),
  scope: z.literal('single-l2-run'),
  aggregation: z.literal('latest-finish-minus-earliest-dispatch'),
  value: z.number().nonnegative(),
  sampleCount: z.literal(1),
  collection: z.object({
    chipSwimlaneLevel: z.number().int().min(2).max(4),
    artifactPath: z.string().min(1),
    artifactDigest: z.string().min(1),
    compiledMetaPath: z.string().min(1),
    compiledMetaDigest: z.string().min(1),
  }),
  taskIdentity: metricIdentitySchema,
  hardwareIdentity: metricIdentitySchema,
  lineage: z.object({
    sourceRoot: z.string().min(1),
    sourceHead: z.string().regex(/^[0-9a-f]{7,64}$/u),
    sourceIdentity: z.string().min(1),
    environmentIdentity: z.string().min(1),
    executionCommandHash: z.string().min(1),
  }),
})

const unavailableMetricSchema = z.object({
  status: z.union([z.literal('not-observed'), z.literal('invalid')]),
  adapter: z.literal('pypto-chip-swimlane-makespan-v1'),
  reason: z.string().min(1),
  evidence: z.array(z.string().min(1)),
})

/** App-owned result of deterministic metric collection for one actual run. */
export const ptoExperimentMetricSchema = z.discriminatedUnion('status', [
  collectedMetricSchema,
  unavailableMetricSchema,
])

/** Durable metric observation inferred from the app-owned adapter schema. */
export type PtoExperimentMetric = z.infer<typeof ptoExperimentMetricSchema>

/** Full durable record shared by planning and the trusted Host executor. */
export const ptoExperimentRecordSchema = z.object({
  schemaVersion: z.literal(2),
  id: z.string().min(1),
  workspaceKey: z.string().min(1),
  workspacePath: z.string().min(1),
  status: ptoExperimentStatusSchema,
  revision: z.number().int().nonnegative(),
  baseline: z.object({
    path: z.string().min(1),
    targetKey: z.string().min(1),
    kind: z.union([z.literal('l2'), z.literal('l3')]),
    marker: z.union([z.literal('kernel_config.py'), z.literal('orchestration/host_orch.py')]),
    identityStatus: z.union([z.literal('unverified'), z.literal('registry-bound')]),
    observedAt: timestampSchema,
  }),
  source: z.object({
    path: z.string().min(1),
    targetKey: z.string().min(1),
    identity: identitySchema,
  }),
  environment: z.object({ identity: identitySchema }),
  candidateOutput: z.object({
    path: z.string().min(1),
    targetKey: z.string().min(1),
    precondition: z.union([z.literal('absent-observed'), z.literal('reserved')]),
    observedAt: timestampSchema,
  }),
  change: z.object({
    summary: z.string().min(1),
    evidenceRefs: z.array(z.string().min(1)),
  }),
  controls: z.object({
    stopConditions: z.string().min(1),
    rollbackPlan: z.string().min(1),
  }),
  execution: z.object({
    command: z.string().min(1),
    timeoutMs: z.number().int().positive(),
  }).nullable().optional(),
  authorization: authorizationReceiptSchema.nullable(),
  actualRun: z.object({
    path: z.string().min(1),
    targetKey: z.string().min(1),
    kind: z.union([z.literal('l2'), z.literal('l3')]),
    marker: z.union([z.literal('kernel_config.py'), z.literal('orchestration/host_orch.py')]),
    identityStatus: z.literal('registry-bound'),
    metric: ptoExperimentMetricSchema,
    observedAt: timestampSchema,
  }).nullable(),
  failure: z.object({
    reason: z.string().min(1),
    observedAt: timestampSchema,
  }).nullable(),
  events: z.array(eventSchema).min(1),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
}).superRefine((record, ctx) => {
  if (record.events.length !== record.revision + 1) {
    ctx.addIssue({ code: 'custom', path: ['events'], message: 'event ledger length must equal revision + 1' })
  }
  for (const [index, event] of record.events.entries()) {
    if (event.revision !== index) {
      ctx.addIssue({ code: 'custom', path: ['events', index, 'revision'], message: 'event revisions must be contiguous from zero' })
    }
  }
  const first = record.events[0]
  if (first?.type !== 'planned' || first.state !== 'planned') {
    ctx.addIssue({ code: 'custom', path: ['events', 0], message: 'event ledger must start with planned@planned' })
  }
  const last = record.events.at(-1)
  if (last?.revision !== record.revision || last.state !== record.status) {
    ctx.addIssue({ code: 'custom', path: ['events'], message: 'last event must match materialized revision and status' })
  }
})

/** Durable PTO experiment record inferred from the zod schema. */
export type PtoExperimentRecord = z.infer<typeof ptoExperimentRecordSchema>

/** Domain specification routed by the deployment's storage-domain configuration. */
export const ptoExperimentDomainSpec = defineDomain({
  name: 'pto_experiments',
  version: 2,
  tables: { experiments: domainTable<string, PtoExperimentRecord>(ptoExperimentRecordSchema) },
})
