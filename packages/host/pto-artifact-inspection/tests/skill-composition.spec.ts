import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import { agentEvents, type Agent } from '@deepseek-ai/dsh-agent'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import type { WebRoute, WebServer } from '@deepseek-ai/dsh-host-webserver'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import PtoArtifactInspectionGateway from '../src/index.ts'
import * as ToolSkill from '@deepseek-ai/dsh-tool-skill/src/index.ts'

const active: Array<{ ctx: Context; root: string }> = []

async function fixtureFile(root: string, relativePath: string, content: string): Promise<void> {
  const path = join(root, relativePath)
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, content)
}

interface HarnessOptions {
  readonly config?: ConstructorParameters<typeof PtoArtifactInspectionGateway>[1]
  readonly toolSkillFirst?: boolean
  readonly gestureSkill?: unknown
  readonly agent?: unknown
  readonly skill?: unknown
}

async function harness(options: HarnessOptions = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-pto-artifact-inspection-'))
  const ctx = new Context()
  active.push({ ctx, root })
  await ctx.plugin(LocalFileSystem, { cwd: root }).await()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime).await()
  const routes = new Map<string, WebRoute>()
  ctx.provide('webServer', {
    register(route: WebRoute) {
      if (routes.has(route.path)) throw new Error(`duplicate route ${route.path}`)
      routes.set(route.path, route)
      return () => { routes.delete(route.path) }
    },
  } as WebServer)
  ctx.provide('agents', { get: () => options.agent } as never)
  ctx.provide('skills', { getQualified: async () => options.skill, get: async () => options.gestureSkill ?? options.skill, snapshot: async () => ({ skills: [], complete: true }) } as never)
  ctx.provide('subprocess', {} as never)
  if (options.toolSkillFirst) await ctx.plugin(ToolSkill).await()
  await ctx.plugin(PtoArtifactInspectionGateway, options.config ?? {}).await()
  if (!options.toolSkillFirst) await ctx.plugin(ToolSkill).await()
  return { ctx, root, routes, gateway: ctx.ptoArtifactInspection }
}

afterEach(async () => {
  await Promise.all(active.splice(0).map(async ({ ctx, root }) => {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }))
})

describe('PtoArtifactInspectionGateway', () => {
  it.each([
    { first: false, conflict: 'none' }, { first: true, conflict: 'none' },
    { first: false, conflict: 'provider' }, { first: true, conflict: 'provider' },
    { first: false, conflict: 'body' }, { first: true, conflict: 'body' },
  ])('keeps one qualified injection or refuses conflict: %j', async ({ first, conflict }) => {
    const sessionId = 'session-analysis'
    const provider = 'pypto-official-af1d7a016ce5'
    const revision = 'af1d7a016ce50ba109c4b4224580a6b758bde7da'
    const skill = {
      name: 'dependency-redundancy',
      provider,
      description: 'Inspect redundant dependency edges.',
      invocation: { modelInvocable: true, userInvocable: true },
      source: 'bundled',
      content: 'Use the dependency reducer and report bounded evidence.',
    }
    const agent = {
      id: sessionId,
      ctx: new Context(),
      session: { header: { cwd: '/' }, seq: 0, surface: { nodes: [] }, snapshotEvents: () => [] },
    } as unknown as Agent
    const { ctx, root, gateway } = await harness({
      agent,
      skill,
      toolSkillFirst: first,
      gestureSkill: { ...skill, ...conflict === 'provider' ? { provider: 'shadow' } : {}, ...conflict === 'body' ? { content: 'Changed Skill body' } : {} },
      config: {
        officialDependencySkillProvider: provider,
        officialDependencySkillRevision: revision,
        dependencyAnalysisToolRevision: '77fa0171c24a',
      },
    })
    await fixtureFile(root, 'pack/deps.json', JSON.stringify({ tasks: [], tensors: [], edges: [] }))
    const record = await gateway.inspect({ path: join(root, 'pack') })
    const action = record.actions.find(candidate => candidate.actionId === 'analyze.dependency-redundancy')
    expect(action).toMatchObject({
      kind: 'analysis',
      status: 'available',
      skill: { name: skill.name, provider, revision },
    })
    const request = {
      requestId: 'request-1',
      sessionId,
      recordId: record.recordId,
      revision: record.profile.revision,
      actionId: 'analyze.dependency-redundancy',
      requestedSkill: { name: skill.name, provider, revision },
    }
    const receipt = await gateway.admitAnalysis(request)
    expect(receipt).toMatchObject({
      requestId: request.requestId,
      sessionId,
      recordId: record.recordId,
      recordRevision: record.profile.revision,
      skill: request.requestedSkill,
      tool: { name: 'pto_dependency_redundancy', revision: '77fa0171c24a' },
    })
    await expect(gateway.admitAnalysis(request)).resolves.toBe(receipt)
    await expect(gateway.admitAnalysis({ ...request, sessionId: 'other-session' }))
      .rejects.toThrow('already used with another payload')

    const direct = createUserMessage({
      content: [{ type: 'text', text: '/skill dependency-redundancy Analyze this PTO dependency graph.' }],
      source: { kind: 'user' },
    })
    const pending = agentEvents(ctx, agent).waterfall(
      'agent/pre-step',
      { messages: [direct], turn: 1, step: 1, signal: new AbortController().signal },
      () => Promise.resolve({ kind: 'enter' as const, messages: [direct] }),
    )
    if (conflict !== 'none') {
      await expect(pending).rejects.toThrow('does not match the admitted qualified definition')
      return
    }
    const decision = await pending
    expect(decision.kind).toBe('enter')
    if (decision.kind !== 'enter') throw new Error('expected analysis pre-step to enter')
    const sources = decision.messages.map(message => message.source)
    expect(sources.filter(source => source.kind === 'skill-invocation')).toHaveLength(1)

  })
})
