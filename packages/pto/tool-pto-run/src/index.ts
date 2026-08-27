/**
 * Workspace-confined model tools for PyPTO 3.0 run discovery and inspection.
 * @module @deepseek-ai/dsh-tool-pto-run
 */

import type { Context } from '@deepseek-ai/cordis'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import z from '@deepseek-ai/schemastery'
import { defineTool, type JsonValue, type ToolExecution } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import {
  discoverPtoRuns,
  inspectPtoRun,
  type ScanLimits,
} from './run-artifacts.ts'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'tool-pto-run'

/** Services required by the deterministic PTO artifact tools. */
export const inject = ['tools', 'fs', 'systemPrompt']

const DEFAULT_LIMITS: ScanLimits = {
  maxDepth: 8,
  maxDirectories: 5_000,
  maxRuns: 200,
  maxArtifactEntries: 2_000,
}

/** Deployment-owned discovery and inspection bounds. */
export interface Config {
  /** Maximum directory depth below the Session workspace root. Defaults to 8. */
  maxDepth?: number
  /** Maximum directories visited by one discovery call. Defaults to 5000. */
  maxDirectories?: number
  /** Maximum recognized runs returned by one discovery call. Defaults to 200. */
  maxRuns?: number
  /** Maximum file entries inventoried by one inspection call. Defaults to 2000. */
  maxArtifactEntries?: number
}

/** Schemastery config for Loader defaults and generated configuration docs. */
export const Config: z<Config> = z.object({
  maxDepth: z.number().step(1).min(0).default(DEFAULT_LIMITS.maxDepth),
  maxDirectories: z.number().step(1).min(1).default(DEFAULT_LIMITS.maxDirectories),
  maxRuns: z.number().step(1).min(1).default(DEFAULT_LIMITS.maxRuns),
  maxArtifactEntries: z.number().step(1).min(1).default(DEFAULT_LIMITS.maxArtifactEntries),
})

const JSON_OUTPUT = {
  schema: { type: 'json' as const },
  render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
}

function resolveLimits(config: Config): ScanLimits {
  const limits = {
    maxDepth: config.maxDepth ?? DEFAULT_LIMITS.maxDepth,
    maxDirectories: config.maxDirectories ?? DEFAULT_LIMITS.maxDirectories,
    maxRuns: config.maxRuns ?? DEFAULT_LIMITS.maxRuns,
    maxArtifactEntries: config.maxArtifactEntries ?? DEFAULT_LIMITS.maxArtifactEntries,
  }
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < (key === 'maxDepth' ? 0 : 1)) {
      throw new TypeError(`tool-pto-run: ${key} must be a ${key === 'maxDepth' ? 'non-negative' : 'positive'} safe integer`)
    }
  }
  return limits
}

async function workspaceRoot(ctx: Context, exec: ToolExecution): Promise<{ cwd: string; target: FsTarget }> {
  const cwd = exec.agent?.session.header.cwd
  if (cwd === undefined || cwd === '') throw new Error('PTO run tools require a Session workspace')
  const target = await ctx.fs.resolve(cwd, { signal: exec.signal })
  const info = await ctx.fs.stat(target, exec.signal)
  if (info?.type !== 'directory') throw new Error('PTO run tools require an existing Session workspace directory')
  return { cwd, target }
}

async function resolveRunTarget(
  ctx: Context,
  exec: ToolExecution,
  runPath: string,
): Promise<{ workspace: FsTarget; run: FsTarget }> {
  const { cwd, target: workspace } = await workspaceRoot(ctx, exec)
  const run = await ctx.fs.resolve(runPath, { cwd, signal: exec.signal })
  if (!ctx.fs.contains(workspace, run)) throw new Error('run_path must stay inside the Session workspace')
  const info = await ctx.fs.stat(run, exec.signal)
  if (info?.type !== 'directory') throw new Error('run_path must name an existing directory')
  return { workspace, run }
}

/** Register read-only PTO run discovery and inspection tools. */
export function apply(ctx: Context, config: Config = {}): void {
  const limits = resolveLimits(config)
  ctx.systemPrompt.section({
    name: 'tool:pto-run',
    order: 114,
    text: 'Use pto_run_discover to find PyPTO 3.0 run directories in the current Session workspace and pto_run_inspect to probe one run before choosing a PTO analysis workflow. Recognition and capability results are artifact observations, not causal conclusions.',
  })

  ctx.tools.register(defineTool({
    name: 'pto_run_discover',
    description: 'Discover PyPTO 3.0 L2/L3 run directories inside the current Session workspace using artifact markers, not path names.',
    parameters: {},
    output: JSON_OUTPUT,
    isConcurrencySafe: () => true,
    async execute(_args, exec) {
      const { target } = await workspaceRoot(ctx, exec)
      return discoverPtoRuns(ctx.fs, target, limits, exec.signal) as unknown as Promise<JsonValue>
    },
  }))

  ctx.tools.register(defineTool({
    name: 'pto_run_inspect',
    description: 'Inspect one workspace-contained PyPTO 3.0 run for evidence, compile health, collection literals, and rerun capabilities without reading artifact contents.',
    parameters: {
      run_path: { type: 'string', required: true, description: 'Run path from pto_run_discover, relative to or inside the current Session workspace.' },
    },
    output: JSON_OUTPUT,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const runPath = typeof args.run_path === 'string' ? args.run_path.trim() : ''
      if (runPath === '') throw new Error('run_path must be a non-empty string')
      const { workspace, run } = await resolveRunTarget(ctx, exec, runPath)
      const result = await inspectPtoRun(
        ctx.fs,
        run,
        runPath,
        limits.maxArtifactEntries,
        exec.signal,
      )
      if (!ctx.fs.contains(workspace, run)) throw new Error('run_path escaped the Session workspace')
      return result as unknown as JsonValue
    },
  }))
}

export {
  discoverPtoRuns,
  inspectPtoRun,
  recognizePtoRun,
  type PtoEvidenceCollection,
  type PtoRunCapability,
  type PtoRunDiscovery,
  type PtoRunHealth,
  type PtoRunInspection,
  type PtoRunKind,
  type PtoRunRecognition,
  type PtoRunSummary,
  type PtoSubBuild,
  type ScanLimits,
} from './run-artifacts.ts'
