/**
 * Durable, Workspace-confined PTO experiment planning, execution, metric, and comparison service.
 * @module @deepseek-ai/dsh-pto-experiments
 */

import { createHash, randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { z as zod } from 'zod'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ShellRunResult } from '@deepseek-ai/dsh-shell'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { recognizePtoRun } from '@deepseek-ai/dsh-tool-pto-run'
import { defineTool, type ToolExecution } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { ptoExperimentDomainSpec } from './spec.ts'
import type { PtoExperimentMetric, PtoExperimentRecord } from './spec.ts'

export {
  ptoExperimentDomainSpec,
  ptoExperimentRecordSchema,
  ptoExperimentMetricSchema,
  ptoExperimentStatusSchema,
} from './spec.ts'
export type { PtoExperimentMetric, PtoExperimentRecord, PtoExperimentStatus } from './spec.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    ptoExperiments: PtoExperimentStore
  }
}

/** Input accepted by the durable planning operation. */
export interface PtoExperimentPlanInput {
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

/** Caller-owned Workspace and cancellation context for one operation. */
export interface PtoExperimentScope {
  cwd: string
  signal?: AbortSignal
}

/** Trusted Host caller context for the complete execution-admission loop. */
export interface PtoExperimentExecutionScope extends PtoExperimentScope {
  agent: Agent
  callId?: ToolCallId
}

/**
 * Detach terminal audit settlement from the workload's cancellation signal.
 * Once a record reached `running`, aborting the command must not also abort
 * the read/validate/write sequence that records its `cancelled` outcome.
 */
function terminalSettlementScope(scope: PtoExperimentExecutionScope): PtoExperimentExecutionScope {
  return {
    cwd: scope.cwd,
    agent: scope.agent,
    ...(scope.callId === undefined ? {} : { callId: scope.callId }),
  }
}

/** Optimistic identity of the planned record selected for execution. */
export interface PtoExperimentExecuteInput {
  experimentId: string
  expectedRevision: number
}

/** Optimistic identity of a completed experiment selected for comparison. */
export interface PtoExperimentCompareInput {
  experimentId: string
  expectedRevision: number
}

/** One comparison dimension backed by app-owned identities. */
export interface PtoExperimentComparisonDimension {
  status: 'matched' | 'unmatched' | 'unavailable'
  baseline: string | null
  candidate: string | null
}

/** Evidence-gated comparison of a completed candidate with its registered baseline. */
export interface PtoExperimentComparison {
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

/** Bounded Workspace-local list result. */
export interface PtoExperimentList {
  experiments: PtoExperimentView[]
  total: number
  truncated: boolean
}

/** Model- and caller-visible record with opaque filesystem keys removed. */
export type PtoExperimentView = Omit<
  PtoExperimentRecord,
  'workspaceKey' | 'baseline' | 'source' | 'candidateOutput' | 'actualRun'
> & {
  baseline: Omit<PtoExperimentRecord['baseline'], 'targetKey'>
  source: Omit<PtoExperimentRecord['source'], 'targetKey'>
  candidateOutput: Omit<PtoExperimentRecord['candidateOutput'], 'targetKey'>
  actualRun: null | Omit<NonNullable<PtoExperimentRecord['actualRun']>, 'targetKey'>
}

/** Deployment-owned executables and execution/metric-collection bounds. */
export interface Config {
  /** Trusted Git executable used only with fixed identity-probe arguments. */
  gitCommand?: string
  /** Trusted Python executable used only with the fixed PyPTO environment probe. */
  pythonCommand?: string
  /** Maximum accepted planned workload timeout in milliseconds. */
  maxExecutionTimeoutMs?: number
  /** Maximum chip-swimlane artifact size admitted by metric collection. */
  maxMetricArtifactBytes?: number
}

const MAX_TEXT_LENGTH = 4_096
const MAX_EVIDENCE_REFS = 64
const MAX_EVIDENCE_REF_LENGTH = 1_024
const MAX_LIST_RESULTS = 100
const DEFAULT_EXECUTION_TIMEOUT_MS = 60 * 60 * 1_000
const DEFAULT_MAX_EXECUTION_TIMEOUT_MS = 24 * 60 * 60 * 1_000
const DEFAULT_MAX_METRIC_ARTIFACT_BYTES = 64 * 1_024 * 1_024
const MAX_COMPILED_META_BYTES = 1 * 1_024 * 1_024
const PROBE_MAX_BYTES = 64 * 1_024
const PROBE_GRACE_MS = 5_000
const PYTHON_ENVIRONMENT_PROBE = `
import importlib.metadata
import importlib.util
import json
import platform
import sys

spec = importlib.util.find_spec("pypto")
if spec is None:
    raise SystemExit("pypto module is unavailable")
try:
    version = importlib.metadata.version("pypto")
except importlib.metadata.PackageNotFoundError:
    version = None
print(json.dumps({
    "executable": sys.executable,
    "platform": platform.platform(),
    "pyptoOrigin": spec.origin,
    "pyptoVersion": version,
    "pythonVersion": platform.python_version(),
}, sort_keys=True))
`.trim()

const PYTHON_METRIC_PROBE = `
import hashlib
import json
import sys

from simpler_setup.tools.swimlane_converter import read_perf_data

path = sys.argv[1]
parsed = read_perf_data(path)
tasks = [task for task in parsed.get("tasks", [])
         if task.get("dispatch_time_us", 0) > 0 and task.get("finish_time_us", 0) > 0]
if int(parsed.get("chip_swimlane_level", 0)) < 2:
    raise SystemExit("chip swimlane level 2 or greater is required")
if not tasks:
    raise SystemExit("chip swimlane contains no joined dispatch/finish tasks")
rows = sorted([
    [int(task["task_id"]), int(task["core_id"]), str(task["core_type"]), int(task["ring_id"])]
    for task in tasks
])
raw = json.load(open(path, encoding="utf-8"))
metadata = raw.get("metadata") or {}
hardware = {
    "clockFreqHz": int(metadata.get("clock_freq_hz") or 0),
    "coreTypes": list(metadata.get("core_types") or []),
    "numCores": int(metadata.get("num_cores") or 0),
}
if hardware["clockFreqHz"] <= 0 or hardware["numCores"] <= 0 or not hardware["coreTypes"]:
    raise SystemExit("chip swimlane metadata omitted the hardware clock/core topology")
payload = json.dumps(rows, separators=(",", ":"), sort_keys=True).encode()
print(json.dumps({
    "artifactDigest": hashlib.sha256(open(path, "rb").read()).hexdigest(),
    "chipSwimlaneLevel": int(parsed["chip_swimlane_level"]),
    "hardware": hardware,
    "makespanUs": max(float(task["finish_time_us"]) for task in tasks)
                  - min(float(task["dispatch_time_us"]) for task in tasks),
    "taskCount": len(tasks),
    "taskSignature": hashlib.sha256(payload).hexdigest(),
}, separators=(",", ":"), sort_keys=True))
`.trim()

type VerifiedIdentity = Extract<PtoExperimentRecord['source']['identity'], { status: 'verified' }>

interface BoundIdentities {
  source: VerifiedIdentity
  environment: VerifiedIdentity
  sourceRoot: string
  sourceHead: string
}

const compiledMetaSchema = zod.object({
  schema: zod.number().int().nonnegative(),
  params: zod.array(zod.object({
    name: zod.string().min(1),
    direction: zod.string().min(1),
    shape: zod.array(zod.number().int()).nullable(),
    dtype: zod.string().min(1),
  })).max(1_024),
  num_return_types: zod.number().int().nonnegative(),
  platform: zod.string().min(1),
  backend_type: zod.string().min(1),
})

const metricProbeResultSchema = zod.object({
  artifactDigest: zod.string().regex(/^[0-9a-f]{64}$/u),
  chipSwimlaneLevel: zod.number().int().min(2).max(4),
  hardware: zod.object({
    clockFreqHz: zod.number().int().positive(),
    coreTypes: zod.array(zod.string().min(1)).min(1),
    numCores: zod.number().int().positive(),
  }),
  makespanUs: zod.number().nonnegative(),
  taskCount: zod.number().int().positive(),
  taskSignature: zod.string().regex(/^[0-9a-f]{64}$/u),
})

interface ExecutionTargets {
  workspace: FsTarget
  source: FsTarget
  baseline: FsTarget
  candidate: FsTarget
  baselineRecognition: NonNullable<Awaited<ReturnType<typeof recognizePtoRun>>>
}

const JSON_OUTPUT = {
  schema: { type: 'json' as const },
  render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
}

function requiredText(value: string, field: string, maxLength = MAX_TEXT_LENGTH): string {
  const normalized = value.trim()
  if (normalized === '') throw new TypeError(`${field} must be a non-empty string`)
  if (normalized.length > maxLength) throw new TypeError(`${field} exceeds ${maxLength} characters`)
  return normalized
}

function evidenceRefs(value: readonly string[]): string[] {
  if (value.length > MAX_EVIDENCE_REFS) {
    throw new TypeError(`evidence_refs exceeds ${MAX_EVIDENCE_REFS} items`)
  }
  return value.map((item, index) => requiredText(item, `evidence_refs[${index}]`, MAX_EVIDENCE_REF_LENGTH))
}

function listLimit(value: number | undefined): number {
  const limit = value ?? 20
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIST_RESULTS) {
    throw new TypeError(`limit must be a positive safe integer no greater than ${MAX_LIST_RESULTS}`)
  }
  return limit
}

function executionTimeout(value: number | undefined, maximum: number): number {
  const timeout = value ?? DEFAULT_EXECUTION_TIMEOUT_MS
  if (!Number.isSafeInteger(timeout) || timeout <= 0 || timeout > maximum) {
    throw new TypeError(`execution_timeout_ms must be a positive safe integer no greater than ${maximum}`)
  }
  return timeout
}

function expectedRevision(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('expected_revision must be a non-negative safe integer')
  return value
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function boundedFailure(reason: string): string {
  const normalized = reason.trim() || 'experiment execution failed'
  return normalized.length <= MAX_TEXT_LENGTH ? normalized : `${normalized.slice(0, MAX_TEXT_LENGTH - 3)}...`
}

function comparisonDimension(
  baseline: string | null,
  candidate: string | null,
): PtoExperimentComparisonDimension {
  return {
    status: baseline === null || candidate === null
      ? 'unavailable'
      : baseline === candidate ? 'matched' : 'unmatched',
    baseline,
    candidate,
  }
}

function recordView(record: PtoExperimentRecord): PtoExperimentView {
  const { workspaceKey: _workspaceKey, baseline, source, candidateOutput, actualRun, ...visible } = record
  const { targetKey: _baselineTargetKey, ...visibleBaseline } = baseline
  const { targetKey: _sourceTargetKey, ...visibleSource } = source
  const { targetKey: _candidateTargetKey, ...visibleCandidateOutput } = candidateOutput
  const visibleActualRun = actualRun === null
    ? null
    : (({ targetKey: _actualRunTargetKey, ...value }) => value)(actualRun)
  return structuredClone({
    ...visible,
    baseline: visibleBaseline,
    source: visibleSource,
    candidateOutput: visibleCandidateOutput,
    actualRun: visibleActualRun,
  })
}

async function directory(
  fs: Context['fs'],
  path: string,
  cwd: string,
  label: string,
  signal?: AbortSignal,
): Promise<FsTarget> {
  const target = await fs.resolve(path, { cwd, ...(signal === undefined ? {} : { signal }) })
  const info = await fs.stat(target, signal)
  if (info?.type !== 'directory') throw new Error(`${label} must name an existing directory`)
  return target
}

/** Durable owner of PTO experiment lifecycle, metric observations, and comparison views. */
export class PtoExperimentStore extends Service {
  static Config: z<Config> = z.object({
    gitCommand: z.string().default('git'),
    pythonCommand: z.string().default('python3'),
    maxExecutionTimeoutMs: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER)
      .default(DEFAULT_MAX_EXECUTION_TIMEOUT_MS),
    maxMetricArtifactBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER)
      .default(DEFAULT_MAX_METRIC_ARTIFACT_BYTES),
  })
  static inject = ['fs', 'storageDomain', 'systemPrompt', 'tools']

  private table?: KvTable<string, PtoExperimentRecord>
  private operationTail: Promise<void> = Promise.resolve()
  private readonly activeExecutions = new Set<string>()
  private readonly config: Required<Config>

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'ptoExperiments')
    this.config = {
      gitCommand: config.gitCommand ?? 'git',
      pythonCommand: config.pythonCommand ?? 'python3',
      maxExecutionTimeoutMs: config.maxExecutionTimeoutMs ?? DEFAULT_MAX_EXECUTION_TIMEOUT_MS,
      maxMetricArtifactBytes: config.maxMetricArtifactBytes ?? DEFAULT_MAX_METRIC_ARTIFACT_BYTES,
    }
    for (const field of ['maxExecutionTimeoutMs', 'maxMetricArtifactBytes'] as const) {
      if (!Number.isSafeInteger(this.config[field]) || this.config[field] <= 0) {
        throw new TypeError(`${field} must be a positive safe integer`)
      }
    }
  }

  /** Open durable storage, recover interrupted runs, and publish proposal/read/comparison tools. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(ptoExperimentDomainSpec)
    this.ctx.effect(() => () => domain.close(), 'ptoExperiments.domainClose')
    this.table = domain.table('experiments')
    await this.recoverInterruptedExecutions()

    this.ctx.systemPrompt.section({
      name: 'tool:pto-experiments',
      order: 114,
      text: 'Use pto_experiment_plan to persist a bounded PTO experiment proposal before requesting authorization. Planning records the exact future execution command and only observes that the candidate output is absent; it does not authorize work, reserve the output, modify source, or execute a workload. Execution is a trusted Host action, not a model tool. Completed L2 runs may carry an app-owned chip-swimlane metric; use pto_experiment_compare only when both candidate and baseline were collected by this registry.',
    })

    this.ctx.tools.register(defineTool({
      name: 'pto_experiment_plan',
      description: 'Persist a Workspace-confined PTO experiment proposal with an immutable recognized baseline, one declared change, a new candidate output path, and explicit stop and rollback controls. This does not authorize or execute the experiment.',
      parameters: {
        source_workspace_path: { type: 'string', required: true, description: 'Existing source workspace directory inside the current Session workspace.' },
        baseline_run_path: { type: 'string', required: true, description: 'Existing recognized PyPTO 3.0 baseline run inside the current Session workspace.' },
        candidate_output_path: { type: 'string', required: true, description: 'Currently absent output path inside the source workspace and disjoint from the baseline.' },
        declared_change: { type: 'string', required: true, description: 'The single material change or explicitly bound change set proposed for the candidate.' },
        evidence_refs: { type: 'array', items: { type: 'string' }, description: 'Evidence references supporting the proposal. Defaults to an empty list.' },
        stop_conditions: { type: 'string', required: true, description: 'Conditions that stop execution or invalidate the candidate.' },
        rollback_plan: { type: 'string', required: true, description: 'How a future executor restores or discards the recoverable source working copy.' },
        execution_command: { type: 'string', required: true, description: 'Exact command a trusted Host executor may run only after identity binding and user approval. It must write a recognized run directly into $DSH_PTO_EXPERIMENT_OUTPUT_DIR.' },
        execution_timeout_ms: { type: 'integer', description: `Positive timeout in milliseconds. Defaults to ${DEFAULT_EXECUTION_TIMEOUT_MS} and is capped at ${this.config.maxExecutionTimeoutMs}.` },
      },
      output: JSON_OUTPUT,
      isConcurrencySafe: () => false,
      execute: async (args, exec) => this.plan(scopeFromExecution(exec), {
        sourceWorkspacePath: args.source_workspace_path,
        baselineRunPath: args.baseline_run_path,
        candidateOutputPath: args.candidate_output_path,
        declaredChange: args.declared_change,
        evidenceRefs: args.evidence_refs ?? [],
        stopConditions: args.stop_conditions,
        rollbackPlan: args.rollback_plan,
        executionCommand: args.execution_command,
        ...(args.execution_timeout_ms === undefined ? {} : { executionTimeoutMs: args.execution_timeout_ms }),
      }) as unknown as Promise<JsonValue>,
    }))

    this.ctx.tools.register(defineTool({
      name: 'pto_experiment_get',
      description: 'Read one PTO experiment record owned by the current Session workspace.',
      parameters: {
        experiment_id: { type: 'string', required: true, description: 'Host-generated experiment id.' },
      },
      output: JSON_OUTPUT,
      isConcurrencySafe: () => true,
      execute: async (args, exec) => this.get(
        scopeFromExecution(exec),
        requiredText(args.experiment_id, 'experiment_id', 256),
      ) as unknown as Promise<JsonValue>,
    }))

    this.ctx.tools.register(defineTool({
      name: 'pto_experiment_list',
      description: 'List the newest PTO experiment records owned by the current Session workspace.',
      parameters: {
        limit: { type: 'integer', description: `Maximum records to return, from 1 to ${MAX_LIST_RESULTS}. Defaults to 20.` },
      },
      output: JSON_OUTPUT,
      isConcurrencySafe: () => true,
      execute: async (args, exec) => this.list(
        scopeFromExecution(exec),
        listLimit(args.limit),
      ) as unknown as Promise<JsonValue>,
    }))

    this.ctx.tools.register(defineTool({
      name: 'pto_experiment_compare',
      description: 'Compare a completed experiment candidate with its app-owned registered baseline using collected chip-swimlane identities. Identity mismatches return incomparable without a combined delta.',
      parameters: {
        experiment_id: { type: 'string', required: true, description: 'Host-generated completed experiment id.' },
        expected_revision: { type: 'integer', required: true, description: 'Exact current completed-record revision.' },
      },
      output: JSON_OUTPUT,
      isConcurrencySafe: () => true,
      execute: async (args, exec) => this.compare(scopeFromExecution(exec), {
        experimentId: args.experiment_id,
        expectedRevision: args.expected_revision,
      }) as unknown as Promise<JsonValue>,
    }))
  }

  /**
   * Persist one proposal after resolving all paths through the active filesystem.
   * The operation serializes candidate ownership checks with the durable put.
   * It records only an absence observation; no output directory is created or reserved.
   * @param scope - Session Workspace and cancellation context.
   * @param input - Proposed experiment identities, change, and controls.
   * @returns a detached public view of the durable planned record.
   */
  plan(scope: PtoExperimentScope, input: PtoExperimentPlanInput): Promise<PtoExperimentView> {
    return this.enqueueOperation(async () => {
      const fs = this.ctx.fs
      const cwd = requiredText(scope.cwd, 'cwd')
      const workspace = await directory(fs, cwd, cwd, 'Session workspace', scope.signal)
      const source = await directory(
        fs,
        requiredText(input.sourceWorkspacePath, 'source_workspace_path'),
        cwd,
        'source_workspace_path',
        scope.signal,
      )
      const baseline = await directory(
        fs,
        requiredText(input.baselineRunPath, 'baseline_run_path'),
        cwd,
        'baseline_run_path',
        scope.signal,
      )
      const candidate = await fs.resolve(
        requiredText(input.candidateOutputPath, 'candidate_output_path'),
        { cwd, ...(scope.signal === undefined ? {} : { signal: scope.signal }) },
      )

      if (!fs.contains(workspace, source) || !fs.contains(workspace, baseline)
        || !fs.contains(workspace, candidate) || !fs.contains(source, candidate)) {
        throw new Error('source, baseline, and candidate output must stay inside the Session workspace; candidate output must stay inside source')
      }
      if (fs.contains(baseline, candidate) || fs.contains(candidate, baseline)) {
        throw new Error('candidate output must be disjoint from the immutable baseline run')
      }
      if (await fs.stat(candidate, scope.signal) !== undefined) {
        throw new Error('candidate_output_path must not exist when the experiment is planned')
      }
      const recognition = await recognizePtoRun(fs, baseline, scope.signal)
      if (recognition === undefined) {
        throw new Error('baseline_run_path is not a recognized PyPTO 3.0 run')
      }

      const table = this.requireTable()
      for (const [, current] of table.entries()) {
        if (current.workspaceKey === String(workspace.targetKey)
          && current.candidateOutput.targetKey === String(candidate.targetKey)) {
          throw new Error(`candidate output is already owned by experiment ${current.id}`)
        }
      }

      const id = `pto-exp-${randomUUID()}`
      const at = new Date().toISOString()
      const record: PtoExperimentRecord = {
        schemaVersion: 2,
        id,
        workspaceKey: String(workspace.targetKey),
        workspacePath: workspace.displayPath,
        status: 'planned',
        revision: 0,
        baseline: {
          path: baseline.displayPath,
          targetKey: String(baseline.targetKey),
          kind: recognition.kind,
          marker: recognition.recognitionMarker,
          identityStatus: 'unverified',
          observedAt: at,
        },
        source: {
          path: source.displayPath,
          targetKey: String(source.targetKey),
          identity: { status: 'unverified', value: null, adapter: null, evidence: [], trust: 'none' },
        },
        environment: {
          identity: { status: 'unverified', value: null, adapter: null, evidence: [], trust: 'none' },
        },
        candidateOutput: {
          path: candidate.displayPath,
          targetKey: String(candidate.targetKey),
          precondition: 'absent-observed',
          observedAt: at,
        },
        change: {
          summary: requiredText(input.declaredChange, 'declared_change'),
          evidenceRefs: evidenceRefs(input.evidenceRefs),
        },
        controls: {
          stopConditions: requiredText(input.stopConditions, 'stop_conditions'),
          rollbackPlan: requiredText(input.rollbackPlan, 'rollback_plan'),
        },
        execution: {
          command: requiredText(input.executionCommand, 'execution_command'),
          timeoutMs: executionTimeout(input.executionTimeoutMs, this.config.maxExecutionTimeoutMs),
        },
        authorization: null,
        actualRun: null,
        failure: null,
        events: [{
          revision: 0,
          type: 'planned',
          state: 'planned',
          actor: 'agent-proposal',
          at,
          details: { outputPrecondition: 'absent-observed', identityStatus: 'unverified' },
        }],
        createdAt: at,
        updatedAt: at,
      }
      ptoExperimentDomainSpec.tables.experiments.valueSchema.parse(record)
      await table.put(id, record)
      return recordView(record)
    })
  }

  /**
   * Read one record only when it belongs to the supplied Workspace.
   * @param scope - Session Workspace and cancellation context.
   * @param id - Host-generated experiment id.
   * @returns a detached public record view.
   */
  async get(scope: PtoExperimentScope, id: string): Promise<PtoExperimentView> {
    const workspace = await this.resolveWorkspace(scope)
    const record = this.requireTable().get(id)
    if (record === undefined) throw new Error(`unknown experiment ${id}`)
    if (record.workspaceKey !== String(workspace.targetKey)) {
      throw new Error(`experiment ${id} belongs to another Workspace`)
    }
    return recordView(record)
  }

  /**
   * List the newest bounded records owned by the supplied Workspace.
   * @param scope - Session Workspace and cancellation context.
   * @param limit - Inclusive result cap from 1 to 100.
   * @returns detached records plus total and truncation facts.
   */
  async list(scope: PtoExperimentScope, limit: number = 20): Promise<PtoExperimentList> {
    const bounded = listLimit(limit)
    const workspace = await this.resolveWorkspace(scope)
    const matching = [...this.requireTable().entries()]
      .map(([, record]) => record)
      .filter(record => record.workspaceKey === String(workspace.targetKey))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
    return {
      experiments: matching.slice(0, bounded).map(recordView),
      total: matching.length,
      truncated: matching.length > bounded,
    }
  }

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
  async compare(
    scope: PtoExperimentScope,
    input: PtoExperimentCompareInput,
  ): Promise<PtoExperimentComparison> {
    const id = requiredText(input.experimentId, 'experiment_id', 256)
    const revision = expectedRevision(input.expectedRevision)
    const workspace = await this.resolveWorkspace(scope)
    const candidateRecord = this.requireTable().get(id)
    if (candidateRecord === undefined || candidateRecord.workspaceKey !== String(workspace.targetKey)) {
      throw new Error(`unknown experiment ${id}`)
    }
    if (candidateRecord.status !== 'completed' || candidateRecord.actualRun === null) {
      throw new Error(`experiment ${id} is not completed`)
    }
    if (candidateRecord.revision !== revision) {
      throw new Error(`experiment ${id} revision changed: expected ${revision}, current ${candidateRecord.revision}`)
    }

    const baselineRecord = [...this.requireTable().entries()]
      .map(([, record]) => record)
      .find(record => record.id !== candidateRecord.id
        && record.workspaceKey === candidateRecord.workspaceKey
        && record.status === 'completed'
        && record.actualRun?.targetKey === candidateRecord.baseline.targetKey)
    const candidateMetric = candidateRecord.actualRun.metric
    const baselineMetric = baselineRecord?.actualRun?.metric ?? null
    const candidateCollected = candidateMetric.status === 'collected' ? candidateMetric : null
    const baselineCollected = baselineMetric?.status === 'collected' ? baselineMetric : null
    const reasons: string[] = []
    if (baselineRecord === undefined) reasons.push('baseline run is not owned by a completed PTO experiment')
    if (baselineCollected === null) reasons.push('baseline has no valid app-owned metric collection')
    if (candidateCollected === null) reasons.push('candidate has no valid app-owned metric collection')

    const metric = comparisonDimension(
      baselineCollected?.identity ?? null,
      candidateCollected?.identity ?? null,
    )
    const task = comparisonDimension(
      baselineCollected?.taskIdentity.value ?? null,
      candidateCollected?.taskIdentity.value ?? null,
    )
    const hardware = comparisonDimension(
      baselineCollected?.hardwareIdentity.value ?? null,
      candidateCollected?.hardwareIdentity.value ?? null,
    )
    const environment = comparisonDimension(
      baselineCollected?.lineage.environmentIdentity ?? null,
      candidateCollected?.lineage.environmentIdentity ?? null,
    )
    const executionCommand = comparisonDimension(
      baselineCollected?.lineage.executionCommandHash ?? null,
      candidateCollected?.lineage.executionCommandHash ?? null,
    )
    const sourceLineage = comparisonDimension(
      baselineCollected?.lineage.sourceRoot ?? null,
      candidateCollected?.lineage.sourceRoot ?? null,
    )

    let changeSet = comparisonDimension(null, null)
    if (baselineCollected !== null && candidateCollected !== null && sourceLineage.status === 'matched') {
      const baselineHead = baselineCollected.lineage.sourceHead
      const candidateHead = candidateCollected.lineage.sourceHead
      if (baselineHead === candidateHead) {
        changeSet = comparisonDimension('different-committed-tree', 'same-committed-tree')
      } else {
        const source = await directory(
          this.ctx.fs,
          candidateRecord.source.path,
          candidateRecord.workspacePath,
          'recorded source workspace',
          scope.signal,
        )
        if (String(source.targetKey) !== candidateRecord.source.targetKey) {
          throw new Error('recorded source filesystem identity changed before comparison')
        }
        const raw = await this.runProbe(
          [this.config.gitCommand, 'diff', '--raw', '-z', '--no-abbrev', baselineHead, candidateHead, '--'],
          source.displayPath,
          scope.signal,
          true,
        )
        changeSet = raw === ''
          ? comparisonDimension('non-empty-committed-diff', 'empty-committed-diff')
          : comparisonDimension(`git-tree-diff:${sha256(raw)}`, `git-tree-diff:${sha256(raw)}`)
      }
    }

    const identity = { metric, task, hardware, environment, executionCommand, sourceLineage, changeSet }
    for (const [name, dimension] of Object.entries(identity)) {
      if (dimension.status !== 'matched') reasons.push(`${name} identity is ${dimension.status}`)
    }
    if (reasons.length > 0 || baselineRecord === undefined
      || baselineCollected === null || candidateCollected === null) {
      return {
        experimentId: id,
        baselineExperimentId: baselineRecord?.id ?? null,
        result: 'incomparable',
        reasons: [...new Set(reasons)],
        identity,
        baseline: { runPath: candidateRecord.baseline.path, metric: baselineMetric },
        candidate: { runPath: candidateRecord.actualRun.path, metric: candidateMetric },
        delta: null,
      }
    }

    const absolute = candidateCollected.value - baselineCollected.value
    return {
      experimentId: id,
      baselineExperimentId: baselineRecord.id,
      result: 'inconclusive',
      reasons: ['no user-owned threshold or repetition/significance rule is registered'],
      identity,
      baseline: { runPath: candidateRecord.baseline.path, metric: baselineMetric },
      candidate: { runPath: candidateRecord.actualRun.path, metric: candidateMetric },
      delta: {
        absolute,
        relativePct: baselineCollected.value === 0 ? null : absolute / baselineCollected.value * 100,
        direction: absolute < 0 ? 'improved' : absolute > 0 ? 'regressed' : 'unchanged',
        significance: 'needs-user-confirmation',
      },
    }
  }

  /**
   * Execute one planned proposal through the complete trusted admission loop.
   * This Host API is intentionally not registered as a model-facing tool.
   * @param scope - live Agent, Workspace, call identity, and cancellation.
   * @param input - experiment id and optimistic planned revision.
   * @returns the terminal durable record view, or throws before workload start.
   */
  async execute(
    scope: PtoExperimentExecutionScope,
    input: PtoExperimentExecuteInput,
  ): Promise<PtoExperimentView> {
    const id = requiredText(input.experimentId, 'experiment_id', 256)
    const revision = expectedRevision(input.expectedRevision)
    if (this.activeExecutions.has(id)) throw new Error(`experiment ${id} already has an active executor`)
    this.activeExecutions.add(id)
    try {
      const snapshot = await this.ownedRecord(scope, id)
      this.requireExecutablePlan(snapshot, revision)
      const targets = await this.executionTargets(scope, snapshot, true)
      const identities = await this.bindIdentities(targets.source, scope.signal)
      const decision = await this.requireApproval().requestDecision({
        agent: scope.agent,
        toolName: 'pto-experiment-executor',
        ...scope.callId === undefined ? {} : { callId: scope.callId },
        reason: this.approvalReason(snapshot, identities),
        ...scope.signal === undefined ? {} : { signal: scope.signal },
      })
      if (decision.outcome !== 'allowed-once') {
        throw new Error(`experiment execution was not authorized: ${decision.outcome}`)
      }

      const running = await this.enqueueOperation(async () => {
        const current = await this.ownedRecord(scope, id)
        this.requireExecutablePlan(current, revision)
        const currentTargets = await this.executionTargets(scope, current, true)
        const currentIdentities = await this.bindIdentities(currentTargets.source, scope.signal)
        if (currentIdentities.source.value !== identities.source.value
          || currentIdentities.environment.value !== identities.environment.value) {
          throw new Error('source or environment identity changed while approval was pending')
        }
        const policy = this.requireSandboxPolicy().resolve({ session: scope.agent.session, mode: 'workspace-write' })
        const reservation = await this.ctx.fs.reserveDirectory(currentTargets.candidate, scope.signal, policy)
        const at = new Date().toISOString()
        const authorization = {
          actor: 'session-user',
          approvalId: String(decision.id),
          sessionId: String(scope.agent.session.id),
          authorizedAt: at,
          trust: 'user-approval' as const,
        }
        const next: PtoExperimentRecord = {
          ...current,
          status: 'running',
          revision: current.revision + 3,
          baseline: { ...current.baseline, identityStatus: 'registry-bound' },
          source: { ...current.source, identity: currentIdentities.source },
          environment: { identity: currentIdentities.environment },
          candidateOutput: {
            ...current.candidateOutput,
            precondition: 'reserved',
            observedAt: at,
          },
          authorization,
          events: [
            ...current.events,
            {
              revision: current.revision + 1,
              type: 'identities-bound',
              state: 'planned',
              actor: 'trusted-identity-adapter',
              at,
              details: {
                sourceIdentity: currentIdentities.source.value,
                environmentIdentity: currentIdentities.environment.value,
              },
            },
            {
              revision: current.revision + 2,
              type: 'authorized',
              state: 'authorized',
              actor: 'user-approval',
              at,
              details: { approvalId: String(decision.id), sessionId: String(scope.agent.session.id) },
            },
            {
              revision: current.revision + 3,
              type: 'execution-started',
              state: 'running',
              actor: 'experiment-executor',
              at,
              details: {
                outputReservationVersion: String(reservation.version),
                commandHash: sha256(current.execution?.command ?? ''),
              },
            },
          ],
          updatedAt: at,
        }
        await this.putValidated(next)
        return { record: next, targets: currentTargets }
      })

      let result: ShellRunResult
      try {
        const execution = running.record.execution
        if (execution === null || execution === undefined) throw new Error('experiment has no execution specification')
        const shell = this.requireShell()
        result = await shell.run(shell.resolve({
          command: execution.command,
          workdir: running.targets.source.displayPath,
          timeoutMs: execution.timeoutMs,
          signal: scope.signal,
          dshEnv: {
            DSH_PTO_EXPERIMENT_ID: running.record.id,
            DSH_PTO_EXPERIMENT_OUTPUT_DIR: running.targets.candidate.displayPath,
          },
          sandboxPolicy: this.requireSandboxPolicy().resolve({ session: scope.agent.session, mode: 'danger-full-access' }),
        }))
      } catch (error: unknown) {
        return await this.finishExecution(terminalSettlementScope(scope), running.record, running.targets, {
          kind: scope.signal?.aborted ? 'cancelled' : 'failed',
          reason: `executor infrastructure failure: ${String(error)}`,
        })
      }

      if (result.aborted || scope.signal?.aborted) {
        return await this.finishExecution(terminalSettlementScope(scope), running.record, running.targets, {
          kind: 'cancelled',
          reason: 'experiment execution was cancelled',
        })
      }
      if (result.exitCode !== 0 || result.signal !== null || result.timedOut
        || result.sandbox?.denied === true || result.sandbox?.runnerFailed === true) {
        return await this.finishExecution(terminalSettlementScope(scope), running.record, running.targets, {
          kind: 'failed',
          reason: result.timedOut
            ? `experiment execution exceeded ${result.timeoutMs}ms`
            : `experiment command failed (exit=${String(result.exitCode)}, signal=${String(result.signal)}, sandboxDenied=${String(result.sandbox?.denied === true)})`,
        })
      }
      return await this.finishExecution(terminalSettlementScope(scope), running.record, running.targets, { kind: 'completed' })
    } finally {
      this.activeExecutions.delete(id)
    }
  }

  private async ownedRecord(scope: PtoExperimentExecutionScope, id: string): Promise<PtoExperimentRecord> {
    const workspace = await this.resolveWorkspace(scope)
    const agentCwd = requiredText(scope.agent.session.header.cwd ?? '', 'Agent Session workspace')
    const agentWorkspace = await directory(
      this.ctx.fs,
      agentCwd,
      agentCwd,
      'Agent Session workspace',
      scope.signal,
    )
    if (String(workspace.targetKey) !== String(agentWorkspace.targetKey)) {
      throw new Error('execution scope Workspace must match the approving Agent Session workspace')
    }
    const record = this.requireTable().get(id)
    if (record === undefined || record.workspaceKey !== String(workspace.targetKey)) {
      throw new Error(`unknown experiment ${id}`)
    }
    return record
  }

  private requireExecutablePlan(record: PtoExperimentRecord, revision: number): void {
    if (record.revision !== revision) {
      throw new Error(`experiment ${record.id} revision changed: expected ${revision}, current ${record.revision}`)
    }
    if (record.status !== 'planned') throw new Error(`cannot execute experiment ${record.id} in status ${record.status}`)
    if (record.execution === null || record.execution === undefined) {
      throw new Error(`experiment ${record.id} predates the trusted execution specification`)
    }
  }

  private async executionTargets(
    scope: PtoExperimentExecutionScope,
    record: PtoExperimentRecord,
    candidateMustBeAbsent: boolean,
  ): Promise<ExecutionTargets> {
    const fs = this.ctx.fs
    const workspace = await this.resolveWorkspace(scope)
    const source = await directory(fs, record.source.path, record.workspacePath, 'recorded source workspace', scope.signal)
    const baseline = await directory(fs, record.baseline.path, record.workspacePath, 'recorded baseline run', scope.signal)
    const candidate = await fs.resolve(record.candidateOutput.path, {
      cwd: record.workspacePath,
      ...(scope.signal === undefined ? {} : { signal: scope.signal }),
    })
    if (String(source.targetKey) !== record.source.targetKey
      || String(baseline.targetKey) !== record.baseline.targetKey
      || String(candidate.targetKey) !== record.candidateOutput.targetKey) {
      throw new Error('recorded filesystem identity changed before execution')
    }
    if (!fs.contains(workspace, source) || !fs.contains(workspace, baseline)
      || !fs.contains(workspace, candidate) || !fs.contains(source, candidate)
      || fs.contains(baseline, candidate) || fs.contains(candidate, baseline)) {
      throw new Error('recorded execution paths no longer satisfy Workspace containment and baseline disjointness')
    }
    if (candidateMustBeAbsent && await fs.stat(candidate, scope.signal) !== undefined) {
      throw new Error('candidate output is no longer absent before reservation')
    }
    const baselineRecognition = await recognizePtoRun(fs, baseline, scope.signal)
    if (baselineRecognition === undefined
      || baselineRecognition.kind !== record.baseline.kind
      || baselineRecognition.recognitionMarker !== record.baseline.marker) {
      throw new Error('recorded baseline is no longer the same recognized PTO run kind')
    }
    return { workspace, source, baseline, candidate, baselineRecognition }
  }

  private async bindIdentities(source: FsTarget, signal?: AbortSignal): Promise<BoundIdentities> {
    const cwd = source.displayPath
    const root = await this.runProbe([this.config.gitCommand, 'rev-parse', '--show-toplevel'], cwd, signal)
    const head = await this.runProbe([this.config.gitCommand, 'rev-parse', 'HEAD'], cwd, signal)
    const status = await this.runProbe(
      [this.config.gitCommand, 'status', '--porcelain=v1', '--untracked-files=all'],
      cwd,
      signal,
      true,
    )
    if (status !== '') {
      throw new Error('source identity requires a clean Git worktree, including no untracked files')
    }
    const sourceFacts = JSON.stringify({ root, head })
    const environmentRaw = await this.runProbe(
      [this.config.pythonCommand, '-c', PYTHON_ENVIRONMENT_PROBE],
      cwd,
      signal,
    )
    let environmentFacts: Record<string, unknown>
    try {
      const parsed = JSON.parse(environmentRaw) as unknown
      if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('not an object')
      environmentFacts = parsed as Record<string, unknown>
    } catch (error: unknown) {
      throw new Error('trusted Python environment probe returned invalid JSON', { cause: error })
    }
    for (const field of ['executable', 'platform', 'pyptoOrigin', 'pythonVersion']) {
      if (typeof environmentFacts[field] !== 'string' || environmentFacts[field] === '') {
        throw new Error(`trusted Python environment probe omitted ${field}`)
      }
    }
    const canonicalEnvironment = JSON.stringify(environmentFacts, Object.keys(environmentFacts).sort())
    return {
      source: {
        status: 'verified',
        value: `git-clean-head:${sha256(sourceFacts)}`,
        adapter: 'git-clean-head-v1',
        evidence: [`root=${root}`, `head=${head}`, 'worktree=clean'],
        trust: 'trusted-adapter',
      },
      environment: {
        status: 'verified',
        value: `pypto-python:${sha256(canonicalEnvironment)}`,
        adapter: 'pypto-python-environment-v1',
        evidence: [
          `python=${String(environmentFacts['executable'])}`,
          `pythonVersion=${String(environmentFacts['pythonVersion'])}`,
          `pyptoOrigin=${String(environmentFacts['pyptoOrigin'])}`,
          `pyptoVersion=${typeof environmentFacts['pyptoVersion'] === 'string' ? environmentFacts['pyptoVersion'] : 'unknown'}`,
          `platform=${String(environmentFacts['platform'])}`,
        ],
        trust: 'trusted-adapter',
      },
      sourceRoot: root,
      sourceHead: head,
    }
  }

  private async collectMetric(
    record: PtoExperimentRecord,
    run: FsTarget,
    kind: 'l2' | 'l3',
    signal?: AbortSignal,
  ): Promise<PtoExperimentMetric> {
    const adapter = 'pypto-chip-swimlane-makespan-v1' as const
    if (kind === 'l3') {
      return { status: 'not-observed', adapter, reason: 'metric adapter supports only L2 runs', evidence: [] }
    }
    const artifact = await this.ctx.fs.resolve('dfx_outputs/chip_swimlane_records.json', {
      cwd: run.displayPath,
      ...(signal === undefined ? {} : { signal }),
    })
    const artifactInfo = await this.ctx.fs.stat(artifact, signal)
    if (artifactInfo?.type !== 'file') {
      return {
        status: 'not-observed',
        adapter,
        reason: 'dfx_outputs/chip_swimlane_records.json was not observed',
        evidence: [],
      }
    }
    if (!this.ctx.fs.contains(run, artifact)) {
      return { status: 'invalid', adapter, reason: 'metric artifact escaped the registered run', evidence: [] }
    }
    if (artifactInfo.size === undefined || artifactInfo.size > this.config.maxMetricArtifactBytes) {
      return {
        status: 'invalid',
        adapter,
        reason: `chip swimlane artifact exceeds ${this.config.maxMetricArtifactBytes} bytes`,
        evidence: [artifact.displayPath],
      }
    }

    const compiledMeta = await this.ctx.fs.resolve('compiled_meta.json', {
      cwd: run.displayPath,
      ...(signal === undefined ? {} : { signal }),
    })
    const compiledMetaInfo = await this.ctx.fs.stat(compiledMeta, signal)
    if (compiledMetaInfo?.type !== 'file') {
      return {
        status: 'not-observed',
        adapter,
        reason: 'compiled_meta.json was not observed',
        evidence: [artifact.displayPath],
      }
    }
    if (!this.ctx.fs.contains(run, compiledMeta)
      || compiledMetaInfo.size === undefined || compiledMetaInfo.size > MAX_COMPILED_META_BYTES) {
      return {
        status: 'invalid',
        adapter,
        reason: 'compiled_meta.json escaped the run or exceeded its bounded size',
        evidence: [compiledMeta.displayPath],
      }
    }

    try {
      const metaText = await this.ctx.fs.readText(compiledMeta, signal)
      const meta = compiledMetaSchema.parse(JSON.parse(metaText) as unknown)
      const rawProbe = await this.runProbe(
        [this.config.pythonCommand, '-c', PYTHON_METRIC_PROBE, this.ctx.fs.processPath(artifact)],
        run.displayPath,
        signal,
      )
      const probe = metricProbeResultSchema.parse(JSON.parse(rawProbe) as unknown)
      const compiledContract = {
        schema: meta.schema,
        params: meta.params,
        numReturnTypes: meta.num_return_types,
      }
      const compiledMetaDigest = sha256(metaText)
      const taskIdentityValue = `pypto-l2-task:${sha256(JSON.stringify({
        compiledContract,
        taskSignature: probe.taskSignature,
      }))}`
      const hardwareIdentityValue = `pypto-platform:${sha256(JSON.stringify({
        backendType: meta.backend_type,
        hardware: probe.hardware,
        platform: meta.platform,
      }))}`
      const metricIdentity = `pto-metric:${sha256(JSON.stringify({
        adapter,
        aggregation: 'latest-finish-minus-earliest-dispatch',
        chipSwimlaneLevel: probe.chipSwimlaneLevel,
        definition: 'device-dispatch-makespan',
        scope: 'single-l2-run',
        unit: 'us',
      }))}`
      const sourceIdentity = record.source.identity
      const environmentIdentity = record.environment.identity
      if (sourceIdentity.status !== 'verified' || environmentIdentity.status !== 'verified') {
        throw new Error('metric collection requires trusted source and environment identities')
      }
      const sourceRoot = sourceIdentity.evidence.find(item => item.startsWith('root='))?.slice(5)
      const sourceHead = sourceIdentity.evidence.find(item => item.startsWith('head='))?.slice(5)
      if (sourceRoot === undefined || sourceRoot === '' || sourceHead === undefined || sourceHead === '') {
        throw new Error('trusted source identity omitted root or head evidence')
      }
      return {
        status: 'collected',
        adapter,
        identity: metricIdentity,
        definition: 'device-dispatch-makespan',
        unit: 'us',
        scope: 'single-l2-run',
        aggregation: 'latest-finish-minus-earliest-dispatch',
        value: probe.makespanUs,
        sampleCount: 1,
        collection: {
          chipSwimlaneLevel: probe.chipSwimlaneLevel,
          artifactPath: artifact.displayPath,
          artifactDigest: probe.artifactDigest,
          compiledMetaPath: compiledMeta.displayPath,
          compiledMetaDigest,
        },
        taskIdentity: {
          value: taskIdentityValue,
          adapter: 'pypto-chip-swimlane-task-contract-v1',
          evidence: [`tasks=${probe.taskCount}`, `compiledMeta=${compiledMetaDigest}`],
        },
        hardwareIdentity: {
          value: hardwareIdentityValue,
          adapter: 'pypto-compiled-platform-v1',
          evidence: [
            `platform=${meta.platform}`,
            `backend=${meta.backend_type}`,
            `clockFreqHz=${probe.hardware.clockFreqHz}`,
            `numCores=${probe.hardware.numCores}`,
          ],
        },
        lineage: {
          sourceRoot,
          sourceHead,
          sourceIdentity: sourceIdentity.value,
          environmentIdentity: environmentIdentity.value,
          executionCommandHash: sha256(record.execution?.command ?? ''),
        },
      }
    } catch (error: unknown) {
      return {
        status: 'invalid',
        adapter,
        reason: boundedFailure(`metric collection failed: ${String(error)}`),
        evidence: [artifact.displayPath, compiledMeta.displayPath],
      }
    }
  }

  private async runProbe(
    argv: readonly [string, ...string[]],
    cwd: string,
    signal?: AbortSignal,
    allowEmpty = false,
  ): Promise<string> {
    const subprocess = this.requireSubprocess()
    const executable = await subprocess.resolveExecutable(argv[0], undefined, signal)
    const child = subprocess.spawn({
      argv: [executable, ...argv.slice(1)],
      cwd,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: PROBE_MAX_BYTES },
        stderr: { maxBytes: PROBE_MAX_BYTES },
      },
      graceMs: PROBE_GRACE_MS,
      ...(signal === undefined ? {} : { signal }),
    })
    const outcome = await child.done
    const stdout = child.collected.stdout?.readFrom(0)
    const stderr = child.collected.stderr?.readFrom(0)
    if (outcome.exitCode !== 0 || outcome.signal !== null) {
      throw new Error(`identity probe failed (exit=${String(outcome.exitCode)}, signal=${String(outcome.signal)}): ${stderr?.text.trim() ?? ''}`)
    }
    if (stdout?.lossy === true || stderr?.lossy === true) throw new Error('identity probe exceeded its bounded output budget')
    const value = stdout?.text.trim() ?? ''
    if (!allowEmpty && value === '') throw new Error('identity probe returned no output')
    return value
  }

  private approvalReason(record: PtoExperimentRecord, identities: BoundIdentities): string {
    const execution = record.execution
    if (execution === null || execution === undefined) throw new Error('experiment has no execution specification')
    return [
      `Authorize PTO experiment ${record.id}@${record.revision}.`,
      `Source identity: ${identities.source.value}.`,
      `Environment identity: ${identities.environment.value}.`,
      `Candidate output: ${record.candidateOutput.path}.`,
      `Command (danger-full-access, timeout ${execution.timeoutMs}ms): ${execution.command}`,
      `Declared change: ${record.change.summary}`,
      `Stop conditions: ${record.controls.stopConditions}`,
      `Rollback plan: ${record.controls.rollbackPlan}`,
    ].join('\n')
  }

  private finishExecution(
    scope: PtoExperimentExecutionScope,
    running: PtoExperimentRecord,
    targets: ExecutionTargets,
    outcome: { kind: 'completed' } | { kind: 'failed' | 'cancelled'; reason: string },
  ): Promise<PtoExperimentView> {
    return this.enqueueOperation(async () => {
      const current = await this.ownedRecord(scope, running.id)
      if (current.status !== 'running' || current.revision !== running.revision) {
        throw new Error(`experiment ${running.id} changed while its executor was running`)
      }
      const at = new Date().toISOString()
      let kind = outcome.kind
      let failureReason = outcome.kind === 'completed' ? undefined : boundedFailure(outcome.reason)
      let actualRun: PtoExperimentRecord['actualRun'] = null
      if (kind === 'completed') {
        const recognition = await recognizePtoRun(this.ctx.fs, targets.candidate, scope.signal)
        if (recognition === undefined) {
          kind = 'failed'
          failureReason = 'experiment command succeeded but candidate output is not a recognized PTO run'
        } else {
          const metric = await this.collectMetric(current, targets.candidate, recognition.kind, scope.signal)
          actualRun = {
            path: targets.candidate.displayPath,
            targetKey: String(targets.candidate.targetKey),
            kind: recognition.kind,
            marker: recognition.recognitionMarker,
            identityStatus: 'registry-bound',
            metric,
            observedAt: at,
          }
        }
      }
      const state = kind === 'completed' ? 'completed' : kind
      const eventType = kind === 'completed'
        ? 'execution-completed' as const
        : kind === 'cancelled'
          ? 'cancelled' as const
          : 'execution-failed' as const
      const next: PtoExperimentRecord = {
        ...current,
        status: state,
        revision: current.revision + 1,
        actualRun,
        failure: failureReason === undefined ? null : { reason: failureReason, observedAt: at },
        events: [...current.events, {
          revision: current.revision + 1,
          type: eventType,
          state,
          actor: 'experiment-executor',
          at,
          details: failureReason === undefined
            ? {
              actualRunPath: targets.candidate.displayPath,
              metricStatus: actualRun?.metric.status ?? 'not-observed',
              ...(actualRun?.metric.status === 'collected'
                ? { metricIdentity: actualRun.metric.identity }
                : {}),
            }
            : { reason: failureReason },
        }],
        updatedAt: at,
      }
      await this.putValidated(next)
      return recordView(next)
    })
  }

  private async recoverInterruptedExecutions(): Promise<void> {
    const table = this.requireTable()
    for (const [, current] of table.entries()) {
      if (current.status !== 'running') continue
      const at = new Date().toISOString()
      const reason = 'executor process stopped before recording a terminal outcome'
      const next: PtoExperimentRecord = {
        ...current,
        status: 'failed',
        revision: current.revision + 1,
        failure: { reason, observedAt: at },
        events: [...current.events, {
          revision: current.revision + 1,
          type: 'execution-failed',
          state: 'failed',
          actor: 'experiment-executor-recovery',
          at,
          details: { reason },
        }],
        updatedAt: at,
      }
      await this.putValidated(next)
    }
  }

  private async putValidated(record: PtoExperimentRecord): Promise<void> {
    ptoExperimentDomainSpec.tables.experiments.valueSchema.parse(record)
    await this.requireTable().put(record.id, record)
  }

  private requireApproval(): Context['approval'] {
    const service = this.ctx.get('approval')
    if (service === undefined) throw new Error('trusted PTO execution requires ctx.approval')
    return service
  }

  private requireSandboxPolicy(): Context['sandboxPolicy'] {
    const service = this.ctx.get('sandboxPolicy')
    if (service === undefined) throw new Error('trusted PTO execution requires ctx.sandboxPolicy')
    return service
  }

  private requireShell(): Context['shell'] {
    const service = this.ctx.get('shell')
    if (service === undefined) throw new Error('trusted PTO execution requires ctx.shell')
    return service
  }

  private requireSubprocess(): Context['subprocess'] {
    const service = this.ctx.get('subprocess')
    if (service === undefined) throw new Error('trusted PTO execution requires ctx.subprocess')
    return service
  }

  private async resolveWorkspace(scope: PtoExperimentScope): Promise<FsTarget> {
    const cwd = requiredText(scope.cwd, 'cwd')
    return directory(this.ctx.fs, cwd, cwd, 'Session workspace', scope.signal)
  }

  private requireTable(): KvTable<string, PtoExperimentRecord> {
    if (this.table === undefined) throw new Error('PTO experiment store is not active')
    return this.table
  }

  private enqueueOperation<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.operationTail.then(operation, operation)
    this.operationTail = run.then(() => undefined, () => undefined)
    return run
  }
}

function scopeFromExecution(exec: ToolExecution): PtoExperimentScope {
  const cwd = exec.agent?.session.header.cwd
  if (cwd === undefined || cwd === '') throw new Error('PTO experiment tools require a Session workspace')
  return { cwd, signal: exec.signal }
}

export default PtoExperimentStore
