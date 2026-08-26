/**
 * REAL-composition proof: a test-only cordis.yml mounts the catalog with its
 * four required service seats through the vendored Loader, then serves a
 * draft without creating a Session or Agent.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as ComposerCatalogPlugin from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

function WorkspaceRegistrySeat(ctx: Context): void {
  ctx.provide('workspaceRegistry', { get: () => undefined } as never)
}

function AgentPresetsSeat(ctx: Context): void {
  ctx.provide('agentPresets', {
    standingKeyFor: () => Promise.reject(new Error('ungrouped draft must not resolve a preset')),
    serviceForStanding: () => undefined,
  } as never)
}

async function loadYaml(): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-composer-catalog-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-commands'",
    "- name: '@deepseek-ai/dsh-skill'",
    "- name: 'test:workspace-registry'",
    "- name: 'test:agent-presets'",
    "- name: '@deepseek-ai/dsh-host-composer-catalog'",
    '',
  ].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-commands', CommandRuntime],
    ['@deepseek-ai/dsh-skill', SkillRegistry],
    ['test:workspace-registry', WorkspaceRegistrySeat],
    ['test:agent-presets', AgentPresetsSeat],
    ['@deepseek-ai/dsh-host-composer-catalog', ComposerCatalogPlugin],
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
  return context
}

describe('real Loader composition', () => {
  it('loads the Web-bundle service shape and serves an ungrouped draft', async () => {
    const loaded = await loadYaml()
    const unloaded = [...loaded.loader.entries()]
      .filter(entry => entry.fiber === undefined && !entry.disabled)
      .map(entry => entry.options.name)
    expect(unloaded).toEqual([])

    loaded.commands.register({
      name: 'feedback',
      description: 'Send feedback',
      handler: () => ({ kind: 'success' }),
    })
    loaded.skills.register({
      name: 'explain',
      description: 'Explain the current project',
      source: 'bundled',
      invocation: { modelInvocable: true, userInvocable: true },
      content: 'Explain it.',
    })

    const catalog = loaded.get('composerCatalog') as ComposerCatalogPlugin.ComposerCatalogGateway
    const result = await catalog.listDraft({})
    expect(result.commands.map(command => command.name)).toEqual(['feedback'])
    expect(result.skills.map(skill => [skill.name, skill.origin.label])).toEqual([
      ['explain', 'DSH'],
    ])
  })
})
