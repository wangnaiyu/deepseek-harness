import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import SandboxPolicyService from '@deepseek-ai/dsh-sandbox-policy'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import ShellExecutor from '@deepseek-ai/dsh-shell'
import type { ShellExecRequest, ShellExecSpec, ShellProcess, ShellRunResult } from '@deepseek-ai/dsh-shell'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import SubprocessRuntime from '@deepseek-ai/dsh-subprocess'
import type {
  SubprocessHandle,
  SubprocessSpawnSpec,
  SubprocessTerminalHandle,
  SubprocessTerminalSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import PtoExperimentStore from '@deepseek-ai/dsh-pto-experiments'

class ProbeSubprocess extends SubprocessRuntime {
  dirty = false
  head = 'a'.repeat(40)
  metricValue = 100
  taskSignature = 'd'.repeat(64)

  override resolveExecutable(command: string): Promise<string> {
    return Promise.resolve(command)
  }

  override spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    const args = spec.argv.slice(1)
    let stdout = ''
    if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') stdout = spec.cwd
    else if (args[0] === 'rev-parse' && args[1] === 'HEAD') stdout = this.head
    else if (args[0] === 'status') stdout = this.dirty ? ' M kernel.py' : ''
    else if (args[0] === 'diff') stdout = ':100644 100644 aaaaaaa bbbbbbb M\0kernel.py\0'
    else if (args[0] === '-c' && args.length > 2) {
      stdout = JSON.stringify({
        artifactDigest: 'c'.repeat(64),
        chipSwimlaneLevel: 4,
        hardware: { clockFreqHz: 50_000_000, coreTypes: ['aic', 'aiv'], numCores: 2 },
        makespanUs: this.metricValue,
        taskCount: 2,
        taskSignature: this.taskSignature,
      })
    } else if (args[0] === '-c') {
      stdout = JSON.stringify({
        executable: '/trusted/python3',
        platform: 'test-platform',
        pyptoOrigin: '/trusted/site-packages/pypto/__init__.py',
        pyptoVersion: '3.test',
        pythonVersion: '3.test',
      })
    } else {
      return this.handle('', `unexpected probe: ${spec.argv.join(' ')}`, 1)
    }
    return this.handle(stdout, '', 0)
  }

  override spawnTerminal(_spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle> {
    return Promise.reject(new Error('terminal probes are not used'))
  }

  private handle(stdout: string, stderr: string, exitCode: number): SubprocessHandle {
    const reader = (text: string) => ({
      readFrom: (_offset: number) => ({ text, nextOffset: Buffer.byteLength(text), lossy: false }),
    })
    return {
      pid: 1,
      stdin: undefined,
      stdout: undefined,
      stderr: undefined,
      collected: { stdout: reader(stdout), stderr: reader(stderr) },
      done: Promise.resolve({ exitCode, signal: null }),
      terminate: () => undefined,
      waitForExit: () => Promise.resolve(true),
    }
  }
}

class ExperimentShell extends ShellExecutor {
  behavior: 'recognized' | 'missing-marker' | 'failed' | 'wait-for-abort' = 'recognized'
  writeMetricArtifacts = true
  lastSpec?: ShellExecSpec

  override resolve(request: ShellExecRequest): ShellExecSpec {
    return {
      command: request.command,
      workdir: request.workdir ?? process.cwd(),
      timeoutMs: request.timeoutMs ?? 60_000,
      stdoutMaxBytes: request.stdoutMaxBytes ?? 64 * 1_024,
      sandboxPolicy: request.sandboxPolicy,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
      ...(request.dshEnv === undefined ? {} : { dshEnv: request.dshEnv }),
    }
  }

  override async run(spec: ShellExecSpec): Promise<ShellRunResult> {
    this.lastSpec = spec
    if (this.behavior === 'wait-for-abort') {
      await new Promise<void>((resolve) => {
        if (spec.signal?.aborted === true) resolve()
        else spec.signal?.addEventListener('abort', () => { resolve() }, { once: true })
      })
      return {
        exitCode: null,
        signal: 'SIGTERM',
        timedOut: false,
        aborted: true,
        timeoutMs: spec.timeoutMs,
        stdout: { text: '', truncated: false },
        stderr: { text: '', truncated: false },
      }
    }
    if (this.behavior === 'recognized') {
      const output = spec.dshEnv?.['DSH_PTO_EXPERIMENT_OUTPUT_DIR']
      if (output === undefined) throw new Error('missing managed candidate output')
      await writeFile(join(output, 'kernel_config.py'), '')
      if (this.writeMetricArtifacts) {
        await writeFile(join(output, 'compiled_meta.json'), JSON.stringify({
          schema: 1,
          params: [{ name: 'x', direction: 'In', shape: [128, 128], dtype: 'fp32' }],
          num_return_types: 1,
          platform: 'a2a3',
          backend_type: 'Ascend910B',
        }))
        await mkdir(join(output, 'dfx_outputs'))
        await writeFile(join(output, 'dfx_outputs', 'chip_swimlane_records.json'), '{}')
      }
    }
    return {
      exitCode: this.behavior === 'failed' ? 2 : 0,
      signal: null,
      timedOut: false,
      aborted: false,
      timeoutMs: spec.timeoutMs,
      stdout: { text: '', truncated: false },
      stderr: { text: '', truncated: false },
    }
  }

  override start(_spec: ShellExecSpec): ShellProcess {
    throw new Error('background execution is not used')
  }
}

interface Mounted {
  ctx: Context
  root: string
  workspace: string
  source: string
  candidate: string
  agent: Agent
  approvalEvents: Array<{ type: string; data: Record<string, unknown> }>
  probes: ProbeSubprocess
  shell: ExperimentShell
}

const mounted: Mounted[] = []

async function mount(): Promise<Mounted> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-pto-executor-'))
  const workspace = join(root, 'workspace')
  const source = join(workspace, 'source')
  const candidate = join(source, 'build_output', 'candidate')
  await mkdir(join(source, 'build_output'), { recursive: true })
  await mkdir(join(workspace, 'baseline'), { recursive: true })
  await writeFile(join(workspace, 'baseline', 'kernel_config.py'), '')

  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: join(root, 'storage') })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(LocalFileSystem, { cwd: workspace })
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: workspace })
  await ctx.plugin(ApprovalService)
  await ctx.plugin(ProbeSubprocess)
  await ctx.plugin(ExperimentShell)
  await ctx.plugin(PtoExperimentStore)

  const approvalEvents: Array<{ type: string; data: Record<string, unknown> }> = []
  const events: Array<{ type: string }> = [{ type: 'turn/start' }]
  const agent = {
    session: {
      id: 'pto-executor-session',
      header: { cwd: workspace },
      events,
      append(type: string, data: Record<string, unknown>) {
        approvalEvents.push({ type, data })
        events.push({ type })
      },
    },
  } as unknown as Agent
  const value = {
    ctx,
    root,
    workspace,
    source,
    candidate,
    agent,
    approvalEvents,
    probes: ctx.subprocess as ProbeSubprocess,
    shell: ctx.shell as ExperimentShell,
  }
  mounted.push(value)
  return value
}

async function plan(
  value: Mounted,
  options: { baseline?: string; candidate?: string } = {},
) {
  return value.ctx.ptoExperiments.plan({ cwd: value.workspace }, {
    sourceWorkspacePath: value.source,
    baselineRunPath: options.baseline ?? join(value.workspace, 'baseline'),
    candidateOutputPath: options.candidate ?? value.candidate,
    declaredChange: 'Change one committed tiling choice.',
    evidenceRefs: ['analysis#claim-1'],
    stopConditions: 'Stop on any compile, runtime, or correctness failure.',
    rollbackPlan: 'Return to the clean source commit and retain failed artifacts.',
    executionCommand: 'python3 run_experiment.py',
    executionTimeoutMs: 120_000,
  })
}

afterEach(async () => {
  await Promise.all(mounted.splice(0).map(async (value) => {
    await value.ctx.fiber.dispose()
    await rm(value.root, { recursive: true, force: true })
  }))
})

describe('trusted PTO experiment executor', () => {
  it('binds adapter identities and approval receipt before a reserved recognized run completes', async () => {
    const value = await mount()
    value.ctx.on('approval/request', () => Promise.resolve<ApprovalOutcome>('allowed-once'))
    const proposal = await plan(value)

    const result = await value.ctx.ptoExperiments.execute(
      { cwd: value.workspace, agent: value.agent, callId: 'execute-call' as ToolCallId },
      { experimentId: proposal.id, expectedRevision: 0 },
    )

    expect(result).toMatchObject({
      status: 'completed',
      revision: 4,
      baseline: { identityStatus: 'registry-bound' },
      source: { identity: { status: 'verified', adapter: 'git-clean-head-v1', trust: 'trusted-adapter' } },
      environment: { identity: { status: 'verified', adapter: 'pypto-python-environment-v1', trust: 'trusted-adapter' } },
      candidateOutput: { precondition: 'reserved' },
      authorization: { trust: 'user-approval', sessionId: 'pto-executor-session' },
      actualRun: {
        path: value.candidate,
        kind: 'l2',
        marker: 'kernel_config.py',
        identityStatus: 'registry-bound',
        metric: { status: 'collected', definition: 'device-dispatch-makespan', value: 100 },
      },
    })
    expect(result.actualRun).not.toHaveProperty('targetKey')
    const asked = value.approvalEvents.find(event => event.type === 'approval/asked')
    const decided = value.approvalEvents.find(event => event.type === 'approval/decided')
    expect(result.authorization?.approvalId).toBe(asked?.data['id'])
    expect(decided?.data).toEqual({ id: asked?.data['id'], outcome: 'allowed-once' })
    expect(value.shell.lastSpec).toMatchObject({
      command: 'python3 run_experiment.py',
      dshEnv: {
        DSH_PTO_EXPERIMENT_ID: proposal.id,
        DSH_PTO_EXPERIMENT_OUTPUT_DIR: value.candidate,
      },
    })
    expect(value.shell.lastSpec?.sandboxPolicy).toEqual({
      mode: 'danger-full-access',
      workspaceRoot: (await value.ctx.fs.resolve(value.workspace)).targetKey,
      sessionId: 'pto-executor-session',
    })
    expect(result.events.map(event => event.type)).toEqual([
      'planned',
      'identities-bound',
      'authorized',
      'execution-started',
      'execution-completed',
    ])
  })

  it('completes a recognized run while recording a missing metric artifact as not observed', async () => {
    const value = await mount()
    value.shell.writeMetricArtifacts = false
    value.ctx.on('approval/request', () => Promise.resolve<ApprovalOutcome>('allowed-once'))
    const proposal = await plan(value)

    const result = await value.ctx.ptoExperiments.execute(
      { cwd: value.workspace, agent: value.agent },
      { experimentId: proposal.id, expectedRevision: 0 },
    )

    expect(result).toMatchObject({
      status: 'completed',
      actualRun: {
        metric: {
          status: 'not-observed',
          adapter: 'pypto-chip-swimlane-makespan-v1',
          reason: 'dfx_outputs/chip_swimlane_records.json was not observed',
        },
      },
    })
  })

  it('compares only app-owned baseline and candidate metrics with verified committed change identity', async () => {
    const value = await mount()
    value.ctx.on('approval/request', () => Promise.resolve<ApprovalOutcome>('allowed-once'))
    const first = await plan(value)
    const baseline = await value.ctx.ptoExperiments.execute(
      { cwd: value.workspace, agent: value.agent },
      { experimentId: first.id, expectedRevision: 0 },
    )
    expect(baseline.actualRun?.metric).toMatchObject({ status: 'collected', value: 100 })
    await expect(value.ctx.ptoExperiments.compare(
      { cwd: value.workspace },
      { experimentId: first.id, expectedRevision: baseline.revision },
    )).resolves.toMatchObject({
      baselineExperimentId: null,
      result: 'incomparable',
      delta: null,
    })

    value.probes.head = 'b'.repeat(40)
    value.probes.metricValue = 80
    const secondCandidate = join(value.source, 'build_output', 'candidate-2')
    const second = await plan(value, { baseline: value.candidate, candidate: secondCandidate })
    const candidate = await value.ctx.ptoExperiments.execute(
      { cwd: value.workspace, agent: value.agent },
      { experimentId: second.id, expectedRevision: 0 },
    )
    const comparison = await value.ctx.ptoExperiments.compare(
      { cwd: value.workspace },
      { experimentId: second.id, expectedRevision: candidate.revision },
    )

    expect(comparison).toMatchObject({
      baselineExperimentId: first.id,
      result: 'inconclusive',
      identity: {
        metric: { status: 'matched' },
        task: { status: 'matched' },
        hardware: { status: 'matched' },
        environment: { status: 'matched' },
        executionCommand: { status: 'matched' },
        sourceLineage: { status: 'matched' },
        changeSet: { status: 'matched' },
      },
      baseline: { metric: { status: 'collected', value: 100 } },
      candidate: { metric: { status: 'collected', value: 80 } },
      delta: {
        absolute: -20,
        relativePct: -20,
        direction: 'improved',
        significance: 'needs-user-confirmation',
      },
    })

    value.probes.head = 'c'.repeat(40)
    value.probes.metricValue = 70
    value.probes.taskSignature = 'e'.repeat(64)
    const thirdCandidate = join(value.source, 'build_output', 'candidate-3')
    const third = await plan(value, { baseline: secondCandidate, candidate: thirdCandidate })
    const changedTask = await value.ctx.ptoExperiments.execute(
      { cwd: value.workspace, agent: value.agent },
      { experimentId: third.id, expectedRevision: 0 },
    )
    await expect(value.ctx.ptoExperiments.compare(
      { cwd: value.workspace },
      { experimentId: third.id, expectedRevision: changedTask.revision },
    )).resolves.toMatchObject({
      result: 'incomparable',
      identity: { task: { status: 'unmatched' } },
      delta: null,
    })
  })

  it('keeps a rejected request planned and leaves the candidate absent', async () => {
    const value = await mount()
    value.ctx.on('approval/request', () => Promise.resolve<ApprovalOutcome>('rejected'))
    const proposal = await plan(value)

    await expect(value.ctx.ptoExperiments.execute(
      { cwd: value.workspace, agent: value.agent },
      { experimentId: proposal.id, expectedRevision: 0 },
    )).rejects.toThrow(/not authorized: rejected/)

    await expect(value.ctx.fs.stat(await value.ctx.fs.resolve(value.candidate))).resolves.toBeUndefined()
    await expect(value.ctx.ptoExperiments.get({ cwd: value.workspace }, proposal.id))
      .resolves.toMatchObject({ status: 'planned', revision: 0, authorization: null })
  })

  it('fails before approval and reservation when the trusted Git adapter sees a dirty source', async () => {
    const value = await mount()
    value.probes.dirty = true
    let approvals = 0
    value.ctx.on('approval/request', () => { approvals += 1; return Promise.resolve<ApprovalOutcome>('allowed-once') })
    const proposal = await plan(value)

    await expect(value.ctx.ptoExperiments.execute(
      { cwd: value.workspace, agent: value.agent },
      { experimentId: proposal.id, expectedRevision: 0 },
    )).rejects.toThrow(/clean Git worktree/)

    expect(approvals).toBe(0)
    await expect(value.ctx.fs.stat(await value.ctx.fs.resolve(value.candidate))).resolves.toBeUndefined()
  })

  it('records failure when a zero-exit command does not create a recognized run', async () => {
    const value = await mount()
    value.shell.behavior = 'missing-marker'
    value.ctx.on('approval/request', () => Promise.resolve<ApprovalOutcome>('allowed-once'))
    const proposal = await plan(value)

    const result = await value.ctx.ptoExperiments.execute(
      { cwd: value.workspace, agent: value.agent },
      { experimentId: proposal.id, expectedRevision: 0 },
    )

    expect(result).toMatchObject({
      status: 'failed',
      revision: 4,
      actualRun: null,
      failure: { reason: 'experiment command succeeded but candidate output is not a recognized PTO run' },
    })
    expect(result.events.at(-1)?.type).toBe('execution-failed')
  })

  it('records a cancelled terminal outcome after the workload signal aborts', async () => {
    const value = await mount()
    value.shell.behavior = 'wait-for-abort'
    value.ctx.on('approval/request', () => Promise.resolve<ApprovalOutcome>('allowed-once'))
    const proposal = await plan(value)
    const controller = new AbortController()

    const execution = value.ctx.ptoExperiments.execute(
      { cwd: value.workspace, agent: value.agent, signal: controller.signal },
      { experimentId: proposal.id, expectedRevision: 0 },
    )
    await expect.poll(() => value.shell.lastSpec).toBeDefined()
    controller.abort(new Error('cancel from dashboard'))

    await expect(execution).resolves.toMatchObject({
      status: 'cancelled',
      revision: 4,
      actualRun: null,
      failure: { reason: 'experiment execution was cancelled' },
    })
    await expect(value.ctx.ptoExperiments.get({ cwd: value.workspace }, proposal.id))
      .resolves.toMatchObject({ status: 'cancelled', revision: 4 })
  })
})
