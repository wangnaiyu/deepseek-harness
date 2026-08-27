import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import CommandRuntime, { type CommandDefinition } from '@deepseek-ai/dsh-commands'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { agentPresetProjectionDefinition } from '@deepseek-ai/dsh-agent-presets'
import { createScope, type ScopeKey } from '@deepseek-ai/dsh-scope'
import SkillRegistry, { type SkillCandidate, type SkillLookupOptions, type SkillProvider } from '@deepseek-ai/dsh-skill'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import ComposerCatalogGateway, {
  DraftComposerWorkspaceNotFound,
  type Config,
} from '../src/index.ts'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

function command(name: string, description = `Command ${name}`, provider?: string): CommandDefinition {
  return {
    name,
    description,
    ...provider === undefined ? {} : { provider },
    handler: () => ({ kind: 'success' }),
  }
}

function candidate(
  provider: string,
  name: string,
  source: string,
  invocation = { modelInvocable: true, userInvocable: true },
): SkillCandidate {
  return {
    name,
    description: `Skill ${name}`,
    invocation,
    source,
    provider,
    rank: 100,
    locator: name,
  }
}

function provider(name: string, list: SkillProvider['list']): SkillProvider {
  return {
    name,
    list,
    get: () => Promise.resolve(undefined),
  }
}

interface HarnessOptions {
  readonly config?: Config
  readonly presetFailure?: Error
  readonly isolatedSkills?: SkillRegistry
  readonly providers?: readonly SkillProvider[]
}

async function harness(options: HarnessOptions = {}): Promise<{
  ctx: Context
  catalog: ComposerCatalogGateway
  standingKey: ScopeKey
  skillLookups: SkillLookupOptions[]
  standingKeyFor: ReturnType<typeof vi.fn>
}> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  ctx.sessionProjections.register(agentPresetProjectionDefinition)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(SkillRegistry)
  const standingKey = { preset: 'code' }
  const skillLookups: SkillLookupOptions[] = []
  for (const registered of options.providers ?? []) {
    ctx.skills.registerProvider(() => ({
      ...registered,
      list: async (lookup) => {
        skillLookups.push(lookup)
        return await registered.list(lookup)
      },
    }))
  }
  const workspaceId = WorkspaceId('workspace-1')
  const workspace = {
    id: workspaceId,
    path: '/work/reviewer',
    title: 'Reviewer Workspace',
    sessionIds: [SessionId('session-final')],
  }
  ctx.provide('workspaceRegistry', {
    get: (id: WorkspaceId) => id === workspaceId ? workspace : undefined,
    list: () => [workspace],
  } as never)
  const standingKeyFor = vi.fn(() => options.presetFailure === undefined
    ? Promise.resolve(standingKey)
    : Promise.reject(options.presetFailure))
  ctx.provide('agentPresets', {
    standingKeyFor,
    serviceForStanding: vi.fn((_key: ScopeKey, name: string) =>
      name === 'skills' ? options.isolatedSkills : undefined),
    serviceFor: vi.fn(() => undefined),
  } as never)
  await ctx.plugin(ComposerCatalogGateway, options.config)
  return {
    ctx,
    catalog: ctx.get('composerCatalog') as ComposerCatalogGateway,
    standingKey,
    skillLookups,
    standingKeyFor,
  }
}

describe('ComposerCatalogGateway', () => {
  it('publishes direct draft and formal Session catalog methods', async () => {
    const { catalog } = await harness()
    expect(catalog.typertRemote).toMatchObject({
      serviceKey: 'composerCatalog',
      namespace: 'composerCatalog',
    })
    expect(remoteMethods(catalog)).toEqual([
      { method: 'listDraft', invocation: { kind: 'direct' } },
      { method: 'listSession', invocation: { kind: 'direct' } },
    ])
  })

  it('projects global and scoped winners with trusted product origins and no Session', async () => {
    const filesystemList = vi.fn(async (lookup: SkillLookupOptions) => [
      candidate('filesystem', 'user-first', 'user-dsh'),
      candidate('filesystem', 'pto-analyze', 'bundled'),
      candidate('filesystem', 'workspace-review', 'project-dsh'),
      candidate('filesystem', 'hidden-skill', 'bundled', { modelInvocable: true, userInvocable: false }),
      ...lookup.cwd === undefined ? [] : [candidate('filesystem', 'workspace-cwd', 'project-agents')],
    ])
    const thirdPartyList = vi.fn(() => Promise.resolve([
      candidate('third-party', 'plugin-skill', 'registry'),
    ]))
    const { ctx, catalog, standingKey } = await harness({
      config: {
        providerOrigins: [
          { provider: 'pto.commands', kind: 'pto' },
          { provider: 'filesystem', source: 'bundled', kind: 'pto' },
          { provider: 'third-party', kind: 'plugin', label: 'Profiler' },
        ],
      },
      providers: [provider('filesystem', filesystemList), provider('third-party', thirdPartyList)],
    })
    ctx.commands.register(command('archive'))
    ctx.commands.register(command('feedback'))
    ctx.commands.register(command('pto-panel', 'Open the PTO panel', 'pto.commands'))
    ctx.commands.register(command('extension', 'Plugin command', 'unknown-plugin'))
    const standing = createScope(ctx, standingKey)
    await standing.ctx.plugin(Object.assign((inner: Context) => {
      inner.commands.register({
        name: 'feedback',
        description: 'Command feedback',
        handler: () => ({ kind: 'success' }),
      })
      inner.commands.register(command('compact'))
    }, { inject: ['commands'] }))

    const sessionsBefore = ctx.sessions.list()
    const result = await catalog.listDraft({ workspaceId: WorkspaceId('workspace-1'), agentPreset: 'code' })

    expect(ctx.sessions.list()).toEqual(sessionsBefore)
    expect(result.commands).toEqual([
      expect.objectContaining({ name: 'archive', origin: { kind: 'dsh', label: 'DSH' } }),
      expect.objectContaining({ name: 'compact', origin: { kind: 'agent', label: 'Agent' } }),
      expect.objectContaining({ name: 'feedback', origin: { kind: 'agent', label: 'Agent' } }),
      expect.objectContaining({ name: 'pto-panel', origin: { kind: 'pto', label: 'PTO' } }),
      expect.objectContaining({ name: 'extension', origin: { kind: 'plugin', label: 'Plugin' } }),
    ])
    expect(result.skills.map(skill => [skill.name, skill.origin.label, skill.modelInvocable])).toEqual([
      ['user-first', 'User', true],
      ['pto-analyze', 'PTO', true],
      ['workspace-cwd', 'Reviewer Workspace', true],
      ['workspace-review', 'Reviewer Workspace', true],
      ['plugin-skill', 'Profiler', true],
    ])
    expect(result.partialErrors).toBeUndefined()
    expect(result.revision).toMatch(/^[a-f0-9]{20}$/u)
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.commands)).toBe(true)
    expect(Object.isFrozen(result.skills)).toBe(true)
  })

  it('projects the formal Session scope and Workspace origin without creating another Session', async () => {
    const list = vi.fn(() => Promise.resolve([
      candidate('filesystem', 'workspace-final', 'project-dsh'),
      candidate('filesystem', 'pto-final', 'bundled'),
    ]))
    const { ctx, catalog, standingKey } = await harness({
      config: { providerOrigins: [{ provider: 'filesystem', source: 'bundled', kind: 'pto' }] },
      providers: [provider('filesystem', list)],
    })
    ctx.commands.register(command('global'))
    const standing = createScope(ctx, standingKey)
    await standing.ctx.plugin(Object.assign((inner: Context) => {
      inner.commands.register(command('session-command'))
    }, { inject: ['commands'] }))
    ctx.sessions.create(SessionId('session-final'), {
      meta: { cwd: '/work/reviewer', agentPreset: 'code' },
    })

    const before = ctx.sessions.list()
    const result = await catalog.listSession({ sessionId: 'session-final' })

    expect(ctx.sessions.list()).toEqual(before)
    expect(result.commands).toEqual([
      expect.objectContaining({ name: 'global', origin: { kind: 'dsh', label: 'DSH' } }),
      expect.objectContaining({ name: 'session-command', origin: { kind: 'agent', label: 'Agent' } }),
    ])
    expect(result.skills.map(skill => [skill.name, skill.origin.label])).toEqual([
      ['pto-final', 'PTO'],
      ['workspace-final', 'Reviewer Workspace'],
    ])
  })

  it('rejects a missing formal Session', async () => {
    const { catalog } = await harness()
    await expect(catalog.listSession({ sessionId: 'missing' }))
      .rejects.toThrow("composer catalog session 'missing' does not exist")
  })

  it('keeps ungrouped discovery global and passes a real undefined cwd', async () => {
    const list = vi.fn((lookup: SkillLookupOptions) => Promise.resolve([
      candidate('filesystem', 'user-skill', 'user-agents'),
      candidate('filesystem', 'project-leak', 'project-dsh'),
      candidate('filesystem', 'custom-skill', 'custom'),
      ...lookup.cwd === undefined ? [candidate('filesystem', 'global-skill', 'bundled')] : [],
    ]))
    const { ctx, catalog, standingKey, skillLookups, standingKeyFor } = await harness({
      providers: [provider('filesystem', list)],
    })
    ctx.commands.register(command('global'))
    const standing = createScope(ctx, standingKey)
    await standing.ctx.plugin(Object.assign((inner: Context) => {
      inner.commands.register(command('agent-only'))
    }, { inject: ['commands'] }))

    const result = await catalog.listDraft({})

    expect(result.commands.map(item => item.name)).toEqual(['global'])
    expect(result.skills.map(item => [item.name, item.origin.label])).toEqual([
      ['custom-skill', 'User'],
      ['user-skill', 'User'],
      ['global-skill', 'DSH'],
    ])
    expect(skillLookups).toHaveLength(1)
    expect(skillLookups[0]?.cwd).toBeUndefined()
    expect(standingKeyFor).not.toHaveBeenCalled()
  })

  it('uses an isolated standing Skill registry instead of the Host root', async () => {
    const isolatedContext = new Context()
    contexts.push(isolatedContext)
    await isolatedContext.plugin(SkillRegistry)
    isolatedContext.skills.register({
      name: 'isolated-only',
      description: 'Isolated Skill',
      source: 'bundled',
      invocation: { modelInvocable: true, userInvocable: true },
      content: 'isolated',
    })
    const { ctx, catalog } = await harness({ isolatedSkills: isolatedContext.skills })
    ctx.skills.register({
      name: 'root-decoy',
      description: 'Root decoy',
      source: 'bundled',
      invocation: { modelInvocable: true, userInvocable: true },
      content: 'root',
    })

    const result = await catalog.listDraft({ workspaceId: WorkspaceId('workspace-1') })

    expect(result.skills.map(item => item.name)).toEqual(['isolated-only'])
  })

  it('retains successful providers and commands when one Skill provider rejects', async () => {
    const { ctx, catalog } = await harness({
      providers: [
        provider('working', () => Promise.resolve([candidate('working', 'available', 'registry')])),
        provider('failing', () => Promise.reject(new Error('provider unavailable'))),
      ],
    })
    vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)
    ctx.commands.register(command('global'))

    const result = await catalog.listDraft({})

    expect(result.commands.map(item => item.name)).toEqual(['global'])
    expect(result.skills.map(item => item.name)).toEqual(['available'])
    expect(result.partialErrors).toEqual([{
      area: 'skills',
      code: 'skill-catalog-incomplete',
      message: 'One or more Skill sources did not complete; successful entries remain available.',
    }])
  })

  it('contains preset resolution failure while preserving global entries', async () => {
    const { ctx, catalog } = await harness({ presetFailure: new Error('preset is broken') })
    ctx.commands.register(command('global'))
    ctx.skills.register({
      name: 'root-skill',
      description: 'Root Skill',
      source: 'user-dsh',
      invocation: { modelInvocable: true, userInvocable: true },
      content: 'root',
    })

    const result = await catalog.listDraft({ workspaceId: WorkspaceId('workspace-1'), agentPreset: 'broken' })

    expect(result.commands.map(item => item.name)).toEqual(['global'])
    expect(result.skills.map(item => item.name)).toEqual(['root-skill'])
    expect(result.partialErrors).toHaveLength(2)
    expect(result.partialErrors?.map(error => error.area)).toEqual(['commands', 'skills'])
    expect(result.partialErrors?.every(error => error.origin?.label === 'Agent')).toBe(true)
  })

  it('rejects an unknown Workspace without accepting a path fallback', async () => {
    const { catalog } = await harness()
    await expect(catalog.listDraft({ workspaceId: WorkspaceId('missing') }))
      .rejects.toBeInstanceOf(DraftComposerWorkspaceNotFound)
  })

  it('bounds wire descriptions and changes revision when the effective catalog changes', async () => {
    const { ctx, catalog } = await harness()
    const dispose = ctx.commands.register(command('long', 'x'.repeat(1_010)))
    const first = await catalog.listDraft({})
    expect(first.commands[0]?.description).toHaveLength(1_000)
    expect(first.commands[0]?.description.endsWith('...')).toBe(true)

    dispose()
    const second = await catalog.listDraft({})
    expect(second.revision).not.toBe(first.revision)
  })

  it('rejects duplicate trusted provider/source origin declarations', async () => {
    await expect(harness({
      config: {
        providerOrigins: [
          { provider: 'same', source: 'bundled', kind: 'pto' },
          { provider: 'same', source: 'bundled', kind: 'dsh' },
        ],
      },
    })).rejects.toThrow("composer catalog origin for provider 'same' source 'bundled' is already configured")
  })
})
