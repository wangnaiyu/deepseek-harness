# PTO 实验

[English](pto-experiments.md) | 中文

[`@deepseek-ai/dsh-pto-experiments`](../../packages/pto/pto-experiments) 负责持久化的 PTO 实验提案、Workspace 内查询、可信 Host 执行准入、应用自有的 L2 指标采集和证据门控的比较。模型可以规划、查询和比较；只有 Host 调用方能执行完整的 identity/approval/reservation/run/terminal 回路。

源码：[`packages/pto/pto-experiments/src/index.ts`](../../packages/pto/pto-experiments/src/index.ts)

## 公开操作类型

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

## Dashboard wire 类型

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

Dashboard gateway 源码为 [`packages/host/pto-experiment-dashboard/src/index.ts`](../../packages/host/pto-experiment-dashboard/src/index.ts)。它只接受 Session identity；由 Host 自有 Session 元数据选择 Workspace cwd。读取独立于 transcript retention，绝不创建或恢复运行时状态。执行还要求该 Session 的 live Agent，并把精确 optimistic revision 交给 registry 可信准入闭环。临时 Host controller 暴露 active/cancellable 状态，视图卸载后仍存活，只允许原发起 Session 取消，并在取消返回前等待 executor 结算。

## 持久规划与查询边界

`plan()` 要求存在 Session Workspace、已有的来源目录，以及由 `@deepseek-ai/dsh-tool-pto-run` 识别出的已有 PTO 基线 run。候选路径必须尚不存在，同时位于 Workspace 和来源树之内，并与基线互不包含。服务把归属检查和持久写入串行化，由 Host 分配实验 id，记录精确 command 和 timeout，并追加初始 `planned@0` 账本事件。

规划只观察 absence；它不占用 output、不授权也不运行。返回的视图会移除仅供存储使用的 Workspace 和文件系统 target key。`get()` 与 `list()` 会重新解析调用者的 Workspace，不会泄露跨 Workspace 的记录是否存在。

## 执行准入边界

`execute()` 是一个非模型 Host 操作；不存在细粒度 authorize、begin、complete 或 fail 入口。它只接受 expected `planned` revision，并要求审批 Agent Session 拥有同一 Workspace。审批前，它会重新验证 path identity、containment、candidate absence、baseline recognition、干净已提交的 Git `HEAD` 以及固定 Python/PyPTO environment probe。审批会显示精确 revision、已绑定 identity、output、已存储 command 和 timeout、declared change、stop condition 与 rollback plan。

`allowed-once` 后，executor 重复每项可变检查，通过 `ctx.fs` 原子占用不存在的 candidate directory，并在开始 command 前提交 service 签发的 approval id、可信 identity、reservation fact 和 `running` state。command 在 source 中以 `danger-full-access` 运行，并携带 Host 管理的 experiment/output 环境变量。只有精确 candidate directory 被识别为 L2/L3 PTO run 时，zero exit 才会变成 `completed`；其他 outcome 落为 `failed` 或 `cancelled`。不持久化 output 内容。Host restart 会把任何持久前台 `running` record 恢复为 failed。

candidate parent 必须已存在，因为 reservation 不递归。reservation 成功后的 storage 失败可能留下空 orphan directory，但 workload 不会开始，且 path 保持不可复用。当前 environment identity 不绑定 driver、device serial、compiler binary 或 workload-specific dependency。

## 指标采集与比较

一次已识别的 L2 run 完成后，固定的 `pypto-chip-swimlane-makespan-v1` 适配器只在该精确的已注册 run 中查找当前 PyPTO 产物：`dfx_outputs/chip_swimlane_records.json` 和 `compiled_meta.json`。两个路径都必须位于 run 内，且大小有界。Python probe 导入 PyPTO 官方的 `simpler_setup.tools.swimlane_converter.read_perf_data()` 转换路径，要求 chip-swimlane level 不小于 2，并持久一个以微秒计的 `device-dispatch-makespan` 观测值，其定义为最晚 finish 减去最早 dispatch。它还持久 metric-definition、compiled task-contract、hardware-topology、source、environment、command 和 artifact identity。证据缺失、为 legacy/L3、格式错误或不受支持时，结果为 `not-observed` 或 `invalid`；它不会把已识别的成功 run 变为失败实验。

`compare()` 只接受已完成实验的 expected revision，而且只有 baseline run 是同一 Workspace 内另一条已完成记录的 actual output 时才能找到它。只有 metric、task、hardware、environment、command、source root 和固定 Git committed-diff identity 全部可用且匹配时，才会放行组合 delta。否则结果为 `incomparable`，且没有 delta。放行的单次观测 delta 会报告方向和相对变化，但仍是 `inconclusive`：服务不拥有用户的 threshold、repetition count 或 significance rule，因此绝不会声称实验已获支持或应被拒绝。

## 对比展示边界

`@deepseek-ai/dsh-client-ui-pto-experiments` 在 transcript 和已选 call details 中展示持久化的 `pto_experiment_compare` 结果。它只消费 Session log 中已经存在的冻结 Tool result；不会再次调用本服务、读取 artifact 或维护另一份 experiment projection。只有闭合 schema 同时含有两个 app-owned collected metric、七个一致身份、已登记 baseline，且差值算术与两边数值一致时，Client 才展示数值 delta。格式异常或不一致的 success output 只显示为依据不可用，绝不成为部分结论。

该包把 details 内容注册到 `ui-tool` 的 keyed `tool.result.detailview` seam。`ui-tool` 仍是整个 `conversation.details.tool` 面板的唯一 owner，并为所有其他 Tool 保留通用 fallback。跨实验聚合与用户触发执行使用 dashboard gateway 和既有 Session 作用域 `conversation.view`；审批继续使用现有 approval surface。root-scoped 全局 overlay 与自动轮询/push invalidation 仍不属于该边界。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
