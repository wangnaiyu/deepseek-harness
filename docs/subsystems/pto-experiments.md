# PTO Experiments

English | [中文](pto-experiments.zh.md)

[`@deepseek-ai/dsh-pto-experiments`](../../packages/pto/pto-experiments) owns durable PTO experiment proposals, Workspace-local queries, trusted Host execution admission, app-owned L2 metric collection, and evidence-gated comparison. Models can plan, query, and compare; only a Host caller can execute the complete identity/approval/reservation/run/terminal loop.

Source: [`packages/pto/pto-experiments/src/index.ts`](../../packages/pto/pto-experiments/src/index.ts)

## Public operation types

```ts type-equiv
/** Input accepted by the durable planning operation. */
interface PtoExperimentPlanInput {
  sourceWorkspacePath: string
  baselineRunPath: string
  candidateOutputPath: string
  declaredChange: string
  evidenceRefs: readonly string[]
  stopConditions: string
  rollbackPlan: string
  executionCommand: string
  executionTimeoutMs?: number
}
```

```ts type-equiv
/** Caller-owned Workspace and cancellation context for one operation. */
interface PtoExperimentScope {
  cwd: string
  signal?: AbortSignal
}
```

```ts type-equiv
/** Trusted Host caller context for the complete execution-admission loop. */
interface PtoExperimentExecutionScope extends PtoExperimentScope {
  agent: Agent
  callId?: ToolCallId
}
```

```ts type-equiv
/** Optimistic identity of the planned record selected for execution. */
interface PtoExperimentExecuteInput {
  experimentId: string
  expectedRevision: number
}
```

```ts type-equiv
/** Optimistic identity of a completed experiment selected for comparison. */
interface PtoExperimentCompareInput {
  experimentId: string
  expectedRevision: number
}
```

```ts type-equiv
/** One comparison dimension backed by app-owned identities. */
interface PtoExperimentComparisonDimension {
  status: 'matched' | 'unmatched' | 'unavailable'
  baseline: string | null
  candidate: string | null
}
```

```ts type-equiv
/** Evidence-gated comparison of a completed candidate with its registered baseline. */
interface PtoExperimentComparison {
  experimentId: string
  baselineExperimentId: string | null
  result: 'incomparable' | 'inconclusive'
  reasons: string[]
  identity: {
    metric: PtoExperimentComparisonDimension
    task: PtoExperimentComparisonDimension
    hardware: PtoExperimentComparisonDimension
    environment: PtoExperimentComparisonDimension
    executionCommand: PtoExperimentComparisonDimension
    sourceLineage: PtoExperimentComparisonDimension
    changeSet: PtoExperimentComparisonDimension
  }
  baseline: { runPath: string; metric: PtoExperimentMetric | null }
  candidate: { runPath: string; metric: PtoExperimentMetric | null }
  delta: {
    absolute: number
    relativePct: number | null
    direction: 'improved' | 'regressed' | 'unchanged'
    significance: 'needs-user-confirmation'
  } | null
}
```

```ts type-equiv
/** Bounded Workspace-local list result. */
interface PtoExperimentList {
  experiments: PtoExperimentView[]
  total: number
  truncated: boolean
}
```

```ts type-equiv
/** Model- and caller-visible record with opaque filesystem keys removed. */
type PtoExperimentView = Omit<
  PtoExperimentRecord,
  'workspaceKey' | 'baseline' | 'source' | 'candidateOutput' | 'actualRun'
> & {
  baseline: Omit<PtoExperimentRecord['baseline'], 'targetKey'>
  source: Omit<PtoExperimentRecord['source'], 'targetKey'>
  candidateOutput: Omit<PtoExperimentRecord['candidateOutput'], 'targetKey'>
  actualRun: null | Omit<NonNullable<PtoExperimentRecord['actualRun']>, 'targetKey'>
}
```

## Dashboard wire types

```ts type-equiv
/** Session-addressed, bounded dashboard request. */
interface PtoExperimentDashboardRequest {
  readonly sessionId: string
  readonly limit?: number
}
```

```ts type-equiv
/** Session-authorized optimistic request to execute one planned experiment. */
interface PtoExperimentDashboardExecuteRequest {
  readonly sessionId: string
  readonly experimentId: string
  readonly expectedRevision: number
}
```

```ts type-equiv
/** Session-authorized request to cancel an execution started by that Session. */
interface PtoExperimentDashboardCancelRequest {
  readonly sessionId: string
  readonly experimentId: string
}
```

```ts type-equiv
/** Confirmation returned after the active executor has observed cancellation and settled. */
interface PtoExperimentDashboardCancelResult {
  readonly cancelled: true
}
```

```ts type-equiv
/** Ephemeral Host execution activity overlaid on a durable registry entry. */
interface PtoExperimentDashboardExecutionActivity {
  readonly active: boolean
  readonly cancellable: boolean
}
```

```ts type-equiv
/** Minimal app-owned metric presentation retained by the dashboard. */
type PtoExperimentDashboardMetric =
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
```

```ts type-equiv
/** One durable experiment projected without storage or filesystem identity keys. */
interface PtoExperimentDashboardEntry {
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
```

```ts type-equiv
/** Newest-first bounded dashboard snapshot for one existing Session. */
interface PtoExperimentDashboardSnapshot {
  readonly experiments: readonly PtoExperimentDashboardEntry[]
  readonly total: number
  readonly truncated: boolean
}
```

The dashboard gateway source is [`packages/host/pto-experiment-dashboard/src/index.ts`](../../packages/host/pto-experiment-dashboard/src/index.ts). It accepts only a Session identity; Host-owned Session metadata selects the Workspace cwd. Reads remain independent of transcript retention and never create or resume runtime state. Execution additionally requires that Session's live Agent and forwards the exact optimistic revision into the registry's trusted admission loop. An ephemeral Host controller exposes active/cancellable state, survives view unmount, restricts cancellation to the initiating Session, and waits for executor settlement before cancellation returns.

## Durable planning and query boundary

`plan()` requires a Session Workspace, an existing source directory, and an existing PTO baseline run recognized through `@deepseek-ai/dsh-tool-pto-run`. The candidate path must be absent, remain inside both the Workspace and source tree, and stay disjoint from the baseline. The service serializes ownership checks with the durable write, assigns the experiment id, records the exact command and timeout, and appends the initial `planned@0` ledger event.

Planning only observes absence; it does not reserve output, authorize, or run. Returned views remove storage-only Workspace and filesystem target keys. `get()` and `list()` resolve the caller's Workspace again and do not reveal cross-Workspace record existence.

## Execution admission boundary

`execute()` is one non-model Host operation; there are no granular authorize, begin, complete, or fail entry points. It accepts only the expected `planned` revision and requires the approving Agent Session to own the same Workspace. Before approval it revalidates path identity, containment, candidate absence, baseline recognition, a clean committed Git `HEAD`, and a fixed Python/PyPTO environment probe. Approval displays the exact revision, bound identities, output, stored command and timeout, declared change, stop conditions, and rollback plan.

After an `allowed-once` decision, the executor repeats every mutable check, atomically reserves the absent candidate directory through `ctx.fs`, and commits the service-issued approval id, trusted identities, reservation fact, and `running` state before starting the command. The command runs in source under `danger-full-access` with Host-managed experiment/output environment variables. A zero exit becomes `completed` only when the exact candidate directory is recognized as an L2/L3 PTO run; all other outcomes settle to `failed` or `cancelled`. Output content is not persisted. A Host restart recovers any durable foreground `running` record as failed.

The candidate parent must exist because reservation is non-recursive. A storage failure after successful reservation may leave an empty orphan directory, but no workload starts and the path remains non-reusable. The current environment identity does not bind drivers, device serials, compiler binaries, or workload-specific dependencies.

## Metric collection and comparison

After a recognized L2 run completes, the fixed `pypto-chip-swimlane-makespan-v1` adapter looks only for current PyPTO artifacts in that exact registered run: `dfx_outputs/chip_swimlane_records.json` and `compiled_meta.json`. Both paths remain inside the run and have bounded sizes. The Python probe imports PyPTO's official `simpler_setup.tools.swimlane_converter.read_perf_data()` conversion path, requires chip-swimlane level 2 or greater, and stores one `device-dispatch-makespan` observation in microseconds as latest finish minus earliest dispatch. It also persists metric-definition, compiled task-contract, hardware-topology, source, environment, command, and artifact identities. Missing, legacy, L3, malformed, or unsupported evidence produces `not-observed` or `invalid`; it does not turn a recognized successful run into a failed experiment.

`compare()` accepts only the expected revision of a completed experiment and finds its baseline only when that run is the actual output of another completed record owned by the same Workspace. A combined delta is admitted only when the metric, task, hardware, environment, command, source root, and fixed Git committed-diff identities are all available and matched. Otherwise the result is `incomparable` with no delta. An admitted single-observation delta reports direction and relative change, but remains `inconclusive`: the service has no user-owned threshold, repetition count, or significance rule and therefore never claims that an experiment is supported or rejected.

## Comparison presentation boundary

`@deepseek-ai/dsh-client-ui-pto-experiments` renders the durable `pto_experiment_compare` result in the transcript and selected-call details. It consumes only the frozen Tool result already in the session log; it does not call this service again, read artifacts, or maintain another experiment projection. The client admits numeric delta presentation only when the closed schema contains two collected app-owned metrics, all seven matched identities, a registered baseline, and arithmetic consistent with the two values. Malformed or inconsistent success output is presented as unavailable evidence, never as a partial conclusion.

The package registers its details body under `ui-tool`'s keyed `tool.result.detailview` seam. `ui-tool` remains the single owner of the whole `conversation.details.tool` panel and preserves its generic fallback for every other Tool. Cross-experiment aggregation and user-triggered execution use the dashboard gateway and existing Session-scoped `conversation.view`; approval remains on the existing approval surface. A root-scoped global overlay and automatic polling/push invalidation remain outside this boundary.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxptoexperimentdashboard--ptoexperimentdashboardgateway"></a>

### `ctx.ptoExperimentDashboard` — `PtoExperimentDashboardGateway`

Session-authorized Remote edge over the durable PTO experiment registry.

```ts cordis-catalog
/**
 * List one existing Session's newest durable experiments. The caller supplies
 * no path: Host-owned Session metadata selects the Workspace, and the read
 * never creates or resumes an Agent, Session, or turn.
 * @param request - existing Session identity and optional bounded limit.
 * @returns minimal dashboard projection without storage identity keys.
 */
@Remote('listSession') async listSession(request: PtoExperimentDashboardRequest): Promise<PtoExperimentDashboardSnapshot>

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
@Remote('executeSession') async executeSession(request: PtoExperimentDashboardExecuteRequest): Promise<PtoExperimentDashboardEntry>

/**
 * Cancel an active execution owned by the same initiating Session. The call
 * returns only after the long execution Remote has settled its Host state.
 * @param request - initiating Session and active experiment identity.
 * @returns cancellation confirmation after executor settlement.
 */
@Remote('cancelSession') async cancelSession(request: PtoExperimentDashboardCancelRequest): Promise<PtoExperimentDashboardCancelResult>
```

Source: [`packages/host/pto-experiment-dashboard/src/index.ts`](../../packages/host/pto-experiment-dashboard/src/index.ts)

<a id="ctxptoexperiments--ptoexperimentstore"></a>

### `ctx.ptoExperiments` — `PtoExperimentStore`

Durable owner of PTO experiment lifecycle, metric observations, and comparison views.

```ts cordis-catalog
/**
 * Persist one proposal after resolving all paths through the active filesystem.
 * The operation serializes candidate ownership checks with the durable put.
 * It records only an absence observation; no output directory is created or reserved.
 * @param scope - Session Workspace and cancellation context.
 * @param input - Proposed experiment identities, change, and controls.
 * @returns a detached public view of the durable planned record.
 */
plan(scope: PtoExperimentScope, input: PtoExperimentPlanInput): Promise<PtoExperimentView>

/**
 * Read one record only when it belongs to the supplied Workspace.
 * @param scope - Session Workspace and cancellation context.
 * @param id - Host-generated experiment id.
 * @returns a detached public record view.
 */
async get(scope: PtoExperimentScope, id: string): Promise<PtoExperimentView>

/**
 * List the newest bounded records owned by the supplied Workspace.
 * @param scope - Session Workspace and cancellation context.
 * @param limit - Inclusive result cap from 1 to 100.
 * @returns detached records plus total and truncation facts.
 */
async list(scope: PtoExperimentScope, limit: number = 20): Promise<PtoExperimentList>

/**
 * Compare one completed candidate only with an app-owned registered baseline.
 * Every admitted identity comes from stored adapter output or a fixed Git
 * probe. Any missing or unequal dimension returns `incomparable` without a
 * combined delta; an admitted delta remains `inconclusive` without a
 * user-owned threshold and repetition rule.
 * @param scope - Session Workspace and cancellation context.
 * @param input - completed experiment id and optimistic record revision.
 * @returns identity checks, side-by-side metrics, and an optional derived delta.
 */
async compare( scope: PtoExperimentScope, input: PtoExperimentCompareInput, ): Promise<PtoExperimentComparison>

/**
 * Execute one planned proposal through the complete trusted admission loop.
 * This Host API is intentionally not registered as a model-facing tool.
 * @param scope - live Agent, Workspace, call identity, and cancellation.
 * @param input - experiment id and optimistic planned revision.
 * @returns the terminal durable record view, or throws before workload start.
 */
async execute( scope: PtoExperimentExecutionScope, input: PtoExperimentExecuteInput, ): Promise<PtoExperimentView>
```

Source: [`packages/pto/pto-experiments/src/index.ts`](../../packages/pto/pto-experiments/src/index.ts)
<!-- END GENERATED cordis-surface -->
