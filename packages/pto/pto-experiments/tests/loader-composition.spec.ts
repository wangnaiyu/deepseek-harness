/** REAL-composition proof for durable PTO experiment planning through Loader YAML. */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import type { Agent } from '@deepseek-ai/dsh-agent'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import PtoExperimentStore from '@deepseek-ai/dsh-pto-experiments'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('PTO experiments through real Loader composition', () => {
  it('boots cordis.yml and lands a model-created proposal in JSON domain storage', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-pto-experiments-loader-'))
    const workspace = join(root, 'workspace')
    await mkdir(join(workspace, 'source'), { recursive: true })
    await mkdir(join(workspace, 'baseline'), { recursive: true })
    await writeFile(join(workspace, 'baseline', 'kernel_config.py'), '')
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-system-prompt'",
      "- name: '@deepseek-ai/dsh-tools'",
      "- name: '@deepseek-ai/dsh-storage'",
      "- name: '@deepseek-ai/dsh-storage-json'",
      '  config:',
      `    root: ${JSON.stringify(join(root, 'storage'))}`,
      "- name: '@deepseek-ai/dsh-storage-domain'",
      '  config:',
      '    backend: json',
      "- name: '@deepseek-ai/dsh-fs-local'",
      '  config:',
      `    cwd: ${JSON.stringify(workspace)}`,
      "- name: '@deepseek-ai/dsh-pto-experiments'",
      '',
    ].join('\n'))

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
      ['@deepseek-ai/dsh-tools', ToolRuntime],
      ['@deepseek-ai/dsh-storage', Storage],
      ['@deepseek-ai/dsh-storage-json', StorageJson],
      ['@deepseek-ai/dsh-storage-domain', StorageDomain],
      ['@deepseek-ai/dsh-fs-local', LocalFileSystem],
      ['@deepseek-ai/dsh-pto-experiments', PtoExperimentStore],
    ])
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({
      name: 'cordis:include',
      config: { path: pathToFileURL(configPath).href },
    })
    await context.loader.await()

    const unloaded = [...context.loader.entries()]
      .filter(entry => entry.fiber === undefined && !entry.disabled)
      .map(entry => entry.options.name)
    expect(unloaded).toEqual([])
    const agent = { session: { header: { cwd: workspace } } } as unknown as Agent
    const result = await context.tools.execute({
      name: 'pto_experiment_plan',
      arguments: {
        source_workspace_path: 'source',
        baseline_run_path: 'baseline',
        candidate_output_path: 'source/candidate',
        declared_change: 'Change one bounded setting.',
        evidence_refs: [],
        stop_conditions: 'Stop on failure.',
        rollback_plan: 'Discard the candidate.',
        execution_command: 'python3 run_experiment.py',
      },
      callId: ToolCallId('loader-pto-experiment'),
      signal: new AbortController().signal,
      agent,
    })
    expect(result.isError).toBe(false)
    await expect(context.fs.stat(await context.fs.resolve('source/candidate', { cwd: workspace }))).resolves.toBeUndefined()
    await expect(context.ptoExperiments.list({ cwd: workspace })).resolves.toMatchObject({ total: 1, truncated: false })
  })
})
