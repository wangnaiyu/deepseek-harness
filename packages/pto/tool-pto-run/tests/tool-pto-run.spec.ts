import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as ToolPtoRun from '@deepseek-ai/dsh-tool-pto-run'

const active: Array<{ ctx: Context; root: string }> = []

async function fixtureFile(root: string, relativePath: string, content = ''): Promise<void> {
  const path = join(root, relativePath)
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, content)
}

async function mount(config: ToolPtoRun.Config = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-tool-pto-run-'))
  const ctx = new Context()
  active.push({ ctx, root })
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(LocalFileSystem, { cwd: root })
  await ctx.plugin(ToolPtoRun, config)
  let calls = 0
  const agent = { session: { header: { cwd: root } } } as unknown as Agent
  return {
    ctx,
    root,
    call: (name: string, arguments_: unknown, caller: Agent | null = agent) => ctx.tools.execute({
      name,
      arguments: arguments_,
      callId: ToolCallId(`pto-${++calls}`),
      signal: new AbortController().signal,
      ...caller === null ? {} : { agent: caller },
    }),
  }
}

afterEach(async () => {
  await Promise.all(active.splice(0).map(async ({ ctx, root }) => {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }))
})

describe('PTO run discovery', () => {
  it('recognizes L2 and L3 by content, prunes known heavy roots, and does not explode next_levels', async () => {
    const mounted = await mount()
    await fixtureFile(mounted.root, 'ops/a/build_output/odd-name/kernel_config.py')
    await fixtureFile(mounted.root, 'capture/distributed/orchestration/host_orch.py')
    await fixtureFile(mounted.root, 'capture/distributed/next_levels/rank0/kernel_config.py')
    await fixtureFile(mounted.root, 'node_modules/fake/kernel_config.py')

    const result = await mounted.call('pto_run_discover', {})

    expect(result.isError).toBe(false)
    expect(result.value).toMatchObject({ truncated: false })
    expect((result.value as unknown as ToolPtoRun.PtoRunDiscovery).runs).toEqual([
      expect.objectContaining({ relativePath: 'capture/distributed', kind: 'l3', recognitionMarker: 'orchestration/host_orch.py' }),
      expect.objectContaining({ relativePath: 'ops/a/build_output/odd-name', kind: 'l2', recognitionMarker: 'kernel_config.py' }),
    ])
  })

  it('reports a bounded scan instead of silently claiming completeness', async () => {
    const mounted = await mount({ maxDepth: 0 })
    await fixtureFile(mounted.root, 'nested/run/kernel_config.py')

    const result = await mounted.call('pto_run_discover', {})

    expect(result.value).toMatchObject({ visitedDirectories: 1, truncated: true, runs: [] })
  })
})

describe('PTO run inspection', () => {
  it('reports evidence and rerun capabilities without turning absence into a cause', async () => {
    const mounted = await mount()
    await fixtureFile(mounted.root, 'run/orchestration/host_orch.py')
    await fixtureFile(mounted.root, 'run/dfx_outputs/chip_swimlane_records.json')
    await fixtureFile(mounted.root, 'run/dfx_outputs/args_dump/args_dump.json')
    await fixtureFile(mounted.root, 'run/dfx_outputs/scope_stats/scope_stats.jsonl')
    await fixtureFile(mounted.root, 'run/passes_dump/00_before.py')
    await fixtureFile(mounted.root, 'run/report/perf_hints.log')
    await fixtureFile(mounted.root, 'run/report/compile.stderr')
    await fixtureFile(mounted.root, 'run/debug/run.py')
    await fixtureFile(mounted.root, 'run/next_levels/program0/compiled_meta.json')
    await fixtureFile(mounted.root, 'run/next_levels/program0/kernel_config.py')

    const result = await mounted.call('pto_run_inspect', { run_path: 'run' })

    expect(result.isError).toBe(false)
    const inspection = result.value as unknown as ToolPtoRun.PtoRunInspection
    expect(inspection).toMatchObject({
      kind: 'l3',
      recognitionMarker: 'orchestration/host_orch.py',
      identityStatus: 'unverified',
      artifactInventoryTruncated: false,
      subBuilds: [{ name: 'program0', relativePath: 'next_levels/program0', rerunFromDir: true }],
      runHealth: {
        compileStatus: 'unknown',
        compileEvidence: ['passes_dump/00_before.py'],
        diagnosticArtifacts: ['report/compile.stderr', 'report/perf_hints.log'],
      },
    })
    expect(inspection.capabilities).toEqual(expect.arrayContaining([
      {
        name: 'timeline',
        status: 'available',
        evidence: ['dfx_outputs/chip_swimlane_records.json'],
        collection: {
          runConfigLiteral: 'RunConfig.enable_chip_swimlane',
          pytestLiterals: ['--enable-chip-swimlane', '--chip-swimlane-level N'],
          costNote: 'workload-runs-twice',
        },
      },
      {
        name: 'tensorValues',
        status: 'available',
        evidence: ['dfx_outputs/args_dump/args_dump.json'],
        collection: { runConfigLiteral: 'RunConfig.enable_dump_args', pytestLiterals: ['--dump-args [LEVEL]'] },
      },
      {
        name: 'hardwareCounters',
        status: 'not-observed',
        evidence: [],
        collection: { runConfigLiteral: 'RunConfig.enable_pmu', pytestLiterals: ['--enable-pmu [N]'] },
      },
      {
        name: 'scopeStats',
        status: 'available',
        evidence: ['dfx_outputs/scope_stats/scope_stats.jsonl'],
        collection: { runConfigLiteral: 'RunConfig.enable_scope_stats', pytestLiterals: ['--enable-scope-stats'] },
      },
      { name: 'irLowering', status: 'available', evidence: ['passes_dump/00_before.py'] },
    ]))
    expect(inspection.rerunCapabilities).toEqual([
      { name: 'rerunFromDir', status: 'available', evidence: ['next_levels/program0/compiled_meta.json'] },
      { name: 'rerunFromScript', status: 'available', evidence: ['debug/run.py'] },
      { name: 'fullRecompile', status: 'unknown', evidence: [] },
    ])
  })

  it('separates incomplete compile evidence from optional DFX collection', async () => {
    const mounted = await mount()
    await fixtureFile(mounted.root, 'partial/kernel_config.py')

    const result = await mounted.call('pto_run_inspect', { run_path: 'partial' })

    expect(result.isError).toBe(false)
    const inspection = result.value as unknown as ToolPtoRun.PtoRunInspection
    expect(inspection.runHealth).toEqual({
      compileStatus: 'incomplete-or-failed',
      compileEvidence: [],
      diagnosticArtifacts: [],
    })
    expect(inspection.capabilities.find(item => item.name === 'timeline')).toMatchObject({
      status: 'not-observed',
      collection: {
        runConfigLiteral: 'RunConfig.enable_chip_swimlane',
        pytestLiterals: ['--enable-chip-swimlane', '--chip-swimlane-level N'],
        costNote: 'workload-runs-twice',
      },
    })
  })

  it('keeps compile health unknown when the bounded artifact inventory truncates', async () => {
    const mounted = await mount({ maxArtifactEntries: 1 })
    await fixtureFile(mounted.root, 'bounded/kernel_config.py')
    await fixtureFile(mounted.root, 'bounded/unrelated.txt')

    const result = await mounted.call('pto_run_inspect', { run_path: 'bounded' })

    expect(result.isError).toBe(false)
    expect(result.value).toMatchObject({
      artifactInventoryTruncated: true,
      runHealth: { compileStatus: 'unknown' },
    })
  })

  it('rejects non-runs, paths outside the workspace, and calls without a Session workspace', async () => {
    const mounted = await mount()
    await mkdir(join(mounted.root, 'ordinary'), { recursive: true })

    const nonRun = await mounted.call('pto_run_inspect', { run_path: 'ordinary' })
    const outside = await mounted.call('pto_run_inspect', { run_path: join(mounted.root, '..') })
    const noSession = await mounted.call('pto_run_discover', {}, null)

    expect(nonRun.isError).toBe(true)
    expect(outside.isError).toBe(true)
    expect(noSession.isError).toBe(true)
  })
})

describe('registration', () => {
  it('publishes exactly two read-only tools and model guidance', async () => {
    const mounted = await mount()
    expect(mounted.ctx.tools.schemas().map(schema => schema.name)).toEqual([
      'pto_run_discover',
      'pto_run_inspect',
    ])
    const prompt = await mounted.ctx.systemPrompt.assemble()
    expect(prompt.sections.map(section => section.name)).toContain('tool:pto-run')
  })
})
