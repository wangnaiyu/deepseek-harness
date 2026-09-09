import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import { agentEvents, type Agent } from '@deepseek-ai/dsh-agent'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import type { WebRoute, WebServer } from '@deepseek-ai/dsh-host-webserver'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import PtoArtifactInspectionGateway from '../src/index.ts'

const active: Array<{ ctx: Context; root: string }> = []

async function fixtureFile(root: string, relativePath: string, content: string): Promise<void> {
  const path = join(root, relativePath)
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, content)
}

interface HarnessOptions {
  readonly config?: ConstructorParameters<typeof PtoArtifactInspectionGateway>[1]
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
  ctx.provide('skills', { getQualified: async () => options.skill } as never)
  ctx.provide('subprocess', {} as never)
  await ctx.plugin(PtoArtifactInspectionGateway, options.config ?? {}).await()
  return { ctx, root, routes, gateway: ctx.ptoArtifactInspection }
}

async function readRoute(route: WebRoute): Promise<{ status: number; headers: Record<string, string | number>; body: string }> {
  let status = 0
  let headers: Record<string, string | number> = {}
  let body = ''
  let writableEnded = false
  const response = {
    get writableEnded() { return writableEnded },
    writeHead(code: number, values: Record<string, string | number>) { status = code; headers = values },
    write(chunk: string) { body += chunk; return true },
    end(chunk?: string) { if (chunk !== undefined) body += chunk; writableEnded = true },
    once() { return response },
  }
  await route.handler({ method: 'GET' } as never, response as never)
  return { status, headers, body }
}

afterEach(async () => {
  await Promise.all(active.splice(0).map(async ({ ctx, root }) => {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }))
})

describe('PtoArtifactInspectionGateway', () => {
  it('publishes the explicit record and viewer lifecycle', async () => {
    const { gateway } = await harness()
    expect(remoteMethods(gateway)).toEqual([
      { method: 'inspect', invocation: { kind: 'direct' } },
      { method: 'refresh', invocation: { kind: 'direct' } },
      { method: 'open', invocation: { kind: 'direct' } },
      { method: 'close', invocation: { kind: 'direct' } },
      { method: 'admitAnalysis', invocation: { kind: 'direct' } },
    ])
  })

  it('profiles a markerless pack and serves only the registered exact HTML file', async () => {
    const { root, routes, gateway } = await harness()
    const html = '<!doctype html><title>deps fixture</title><p>safe fixture</p>'
    await fixtureFile(root, 'pack/deps.json', JSON.stringify({ tasks: [], tensors: [], edges: [] }))
    await fixtureFile(root, 'pack/deps_viewer.html', html)
    await fixtureFile(root, 'pack/secret.txt', 'not served')

    const record = await gateway.inspect({ path: join(root, 'pack') })
    expect(record.recordId).toMatch(/^pto-record-/u)
    expect(record.profile).toMatchObject({ id: record.recordId, kind: 'evidence-pack' })
    expect(JSON.stringify(record)).not.toContain('secret.txt')

    const opened = await gateway.open({
      recordId: record.recordId,
      revision: record.profile.revision,
      actionId: 'open.dependency-graph',
    })
    const route = routes.get(opened.urlPath)
    expect(route).toBeDefined()
    const response = await readRoute(route!)
    expect(response.status).toBe(200)
    expect(response.body).toBe(html)
    expect(response.headers['Content-Security-Policy']).toContain('sandbox allow-scripts')
    expect(response.headers['Cache-Control']).toBe('no-store')
    expect([...routes.keys()]).toEqual([opened.urlPath])
    expect(gateway.close({ handleId: opened.handleId })).toEqual({ closed: true })
    expect(routes.has(opened.urlPath)).toBe(false)
  })

  it('fails closed on stale revisions and unsupported paths', async () => {
    const { root, gateway } = await harness()
    await fixtureFile(root, 'pack/deps.json', JSON.stringify({ tasks: [] }))
    await fixtureFile(root, 'pack/deps_viewer.html', '<title>one</title>')
    const record = await gateway.inspect({ path: join(root, 'pack') })
    await fixtureFile(root, 'pack/deps_viewer.html', '<title>changed</title>')

    await expect(gateway.open({
      recordId: record.recordId,
      revision: record.profile.revision,
      actionId: 'open.dependency-graph',
    })).rejects.toThrow('changed; refresh')
    await expect(gateway.inspect({ path: join(root, 'missing') })).rejects.toThrow('existing directory')
    await expect(gateway.refresh('unknown')).rejects.toThrow('not registered')
  })

  it('serves self-contained memory and IR HTML but leaves JSON-only legacy viewers unavailable', async () => {
    const { root, routes, gateway } = await harness()
    await fixtureFile(root, 'compile/memory_map.html', '<!doctype html><title>memory</title>')
    await fixtureFile(root, 'compile/model_ir_trace.html', '<!doctype html><title>ir</title>')
    await fixtureFile(root, 'compile/merged_swimlane.json', '[]')
    await fixtureFile(root, 'compile/program.json', '{}')
    const record = await gateway.inspect({ path: join(root, 'compile') })
    expect(record.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ actionId: 'open.memory-map', status: 'available' }),
      expect.objectContaining({ actionId: 'open.ir-lowering', status: 'available' }),
      expect.objectContaining({ actionId: 'open.timeline', status: 'unavailable' }),
      expect.objectContaining({ actionId: 'open.program-graph', status: 'unavailable' }),
    ]))
    for (const [actionId, title] of [
      ['open.memory-map', 'memory'],
      ['open.ir-lowering', 'ir'],
    ] as const) {
      const opened = await gateway.open({ recordId: record.recordId, revision: record.profile.revision, actionId })
      expect(opened.features).toEqual({ selection: false, deeplink: false })
      expect((await readRoute(routes.get(opened.urlPath)!)).body).toContain(`<title>${title}</title>`)
      gateway.close({ handleId: opened.handleId })
    }
  })

  it('admits one exact official Skill tuple idempotently and rejects request-id reuse', async () => {
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
      session: { header: { cwd: '/' }, snapshotEvents: () => [] },
    } as unknown as Agent
    const { ctx, root, gateway } = await harness({
      agent,
      skill,
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
      content: [{ type: 'text', text: 'Analyze this PTO dependency graph.' }],
      source: { kind: 'user' },
    })
    const decision = await agentEvents(ctx, agent).waterfall(
      'agent/pre-step',
      { messages: [direct], turn: 1, step: 1, signal: new AbortController().signal },
      () => Promise.resolve({ kind: 'enter' as const, messages: [direct] }),
    )
    expect(decision.kind).toBe('enter')
    if (decision.kind !== 'enter') throw new Error('expected analysis pre-step to enter')
    expect(decision.messages.map(message => message.source)).toMatchObject([
      { kind: 'user' },
      { kind: 'pto-artifact-analysis', receipt },
      { kind: 'skill-invocation', name: skill.name, provider, form: 'instructions' },
    ])
    const contextContent = decision.messages[1]?.content[0]
    if (contextContent?.type !== 'text') throw new Error('expected text analysis context')
    expect(contextContent.text).toContain(`skill: ${provider}/${skill.name}@${revision}`)
    const skillContent = decision.messages[2]?.content[0]
    if (skillContent?.type !== 'text') throw new Error('expected text Skill instructions')
    expect(skillContent.text).toContain(skill.content)
  })
})
