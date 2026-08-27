import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import PtoExperimentStore, {
  type PtoExperimentList,
  type PtoExperimentView,
} from '@deepseek-ai/dsh-pto-experiments'

interface Mounted {
  ctx: Context
  workspace: string
  storageRoot: string
  agent: Agent
  call(name: string, arguments_: unknown): ReturnType<Context['tools']['execute']>
}

const active: Array<{ ctx: Context; root: string }> = []

async function fixtureFile(root: string, relativePath: string): Promise<void> {
  const path = join(root, relativePath)
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, '')
}

async function mount(root?: string): Promise<Mounted> {
  const temporary = root ?? await mkdtemp(join(tmpdir(), 'dsh-pto-experiments-'))
  const workspace = join(temporary, 'workspace')
  const storageRoot = join(temporary, 'storage')
  await mkdir(workspace, { recursive: true })
  const ctx = new Context()
  active.push({ ctx, root: temporary })
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: storageRoot })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(LocalFileSystem, { cwd: workspace })
  await ctx.plugin(PtoExperimentStore)
  const agent = { session: { header: { cwd: workspace } } } as unknown as Agent
  let calls = 0
  return {
    ctx,
    workspace,
    storageRoot,
    agent,
    call: (name, arguments_) => ctx.tools.execute({
      name,
      arguments: arguments_,
      callId: ToolCallId(`pto-experiment-${++calls}`),
      signal: new AbortController().signal,
      agent,
    }),
  }
}

afterEach(async () => {
  const roots = new Set<string>()
  await Promise.all(active.splice(0).map(async ({ ctx, root }) => {
    roots.add(root)
    await ctx.fiber.dispose()
  }))
  await Promise.all([...roots].map(root => rm(root, { recursive: true, force: true })))
})

function proposal(workspace: string) {
  return {
    source_workspace_path: join(workspace, 'source'),
    baseline_run_path: join(workspace, 'baseline'),
    candidate_output_path: join(workspace, 'source', 'build_output', 'candidate'),
    declared_change: 'Change one tiling choice while retaining the baseline inputs.',
    evidence_refs: ['analysis#claim-3'],
    stop_conditions: 'Stop on compile, runtime, or correctness failure.',
    rollback_plan: 'Discard the recoverable candidate working copy.',
    execution_command: 'python3 run_experiment.py',
  }
}

describe('PTO experiment planning', () => {
  it('persists a bounded proposal without authorization, mutation, or output reservation', async () => {
    const mounted = await mount()
    await mkdir(join(mounted.workspace, 'source'), { recursive: true })
    await fixtureFile(mounted.workspace, 'baseline/kernel_config.py')

    const result = await mounted.call('pto_experiment_plan', proposal(mounted.workspace))

    expect(result.isError).toBe(false)
    const record = result.value as unknown as PtoExperimentView
    expect(record).toMatchObject({
      status: 'planned',
      revision: 0,
      baseline: { kind: 'l2', marker: 'kernel_config.py', identityStatus: 'unverified' },
      source: { identity: { status: 'unverified', trust: 'none' } },
      environment: { identity: { status: 'unverified', trust: 'none' } },
      candidateOutput: { precondition: 'absent-observed' },
      authorization: null,
      actualRun: null,
    })
    expect(record).not.toHaveProperty('workspaceKey')
    expect(record.baseline).not.toHaveProperty('targetKey')
    expect(record.source).not.toHaveProperty('targetKey')
    expect(record.candidateOutput).not.toHaveProperty('targetKey')
    expect(await mounted.ctx.fs.stat(await mounted.ctx.fs.resolve(record.candidateOutput.path))).toBeUndefined()

    const listed = await mounted.call('pto_experiment_list', {})
    expect(listed.value).toMatchObject({ total: 1, truncated: false })
    expect((listed.value as unknown as PtoExperimentList).experiments.map(item => item.id)).toEqual([record.id])
  })

  it('serializes candidate ownership and rejects overwrite-shaped plans', async () => {
    const mounted = await mount()
    await mkdir(join(mounted.workspace, 'source'), { recursive: true })
    await fixtureFile(mounted.workspace, 'baseline/kernel_config.py')

    const [first, second] = await Promise.all([
      mounted.call('pto_experiment_plan', proposal(mounted.workspace)),
      mounted.call('pto_experiment_plan', proposal(mounted.workspace)),
    ])
    expect([first.isError, second.isError].sort()).toEqual([false, true])
    const failed = first.isError ? first : second
    expect(failed.content.map(block => block.type === 'text' ? block.text : '').join('')).toMatch(/already owned/)

    const overlap = await mounted.call('pto_experiment_plan', {
      ...proposal(mounted.workspace),
      source_workspace_path: mounted.workspace,
      candidate_output_path: join(mounted.workspace, 'baseline', 'candidate'),
    })
    expect(overlap.isError).toBe(true)
    expect(overlap.content.map(block => block.type === 'text' ? block.text : '').join('')).toMatch(/disjoint/)
  })

  it('restores records after restart and denies another Workspace', async () => {
    const mounted = await mount()
    await mkdir(join(mounted.workspace, 'source'), { recursive: true })
    await fixtureFile(mounted.workspace, 'baseline/orchestration/host_orch.py')
    const planned = await mounted.call('pto_experiment_plan', proposal(mounted.workspace))
    const record = planned.value as unknown as PtoExperimentView
    const root = join(mounted.workspace, '..')
    await mounted.ctx.fiber.dispose()
    active.splice(active.findIndex(item => item.ctx === mounted.ctx), 1)

    const reopened = await mount(root)
    const get = await reopened.call('pto_experiment_get', { experiment_id: record.id })
    expect(get.isError).toBe(false)
    expect(get.value).toMatchObject({ id: record.id, baseline: { kind: 'l3' } })

    const other = join(root, 'other-workspace')
    await mkdir(other)
    ;(reopened.agent as unknown as { session: { header: { cwd: string } } }).session.header.cwd = other
    const denied = await reopened.call('pto_experiment_get', { experiment_id: record.id })
    expect(denied.isError).toBe(true)
    expect(denied.content.map(block => block.type === 'text' ? block.text : '').join('')).toMatch(/another Workspace/)
  })
})

describe('registration', () => {
  it('publishes proposal, query, and evidence-gated comparison tools', async () => {
    const mounted = await mount()
    expect(mounted.ctx.tools.schemas().map(schema => schema.name)).toEqual([
      'pto_experiment_plan',
      'pto_experiment_get',
      'pto_experiment_list',
      'pto_experiment_compare',
    ])
    const prompt = await mounted.ctx.systemPrompt.assemble()
    expect(prompt.sections.find(section => section.name === 'tool:pto-experiments')?.text)
      .toContain('does not authorize work, reserve the output, modify source, or execute a workload')
  })
})
