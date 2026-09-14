import { describe, expect, it, vi } from 'vitest'
import type { PtoArtifactRecordView, PtoArtifactViewerHandle } from '@deepseek-ai/dsh-api-remotes/client'
import { PtoViewerController, type PtoViewerRemote } from '../src/client/pto-viewer.ts'

function record(actionId = 'open.dependency-graph', status: 'available' | 'unavailable' = 'available'): PtoArtifactRecordView {
  return {
    recordId: 'record-1',
    profile: {
      id: 'record-1', kind: 'evidence-pack', relativePath: '.', displayPath: '/data/pack',
      revision: 'revision-1', generation: 'unknown', runtimeLevel: 'unknown', identityEvidence: [],
      artifacts: [], evidence: [], scan: { complete: true, limits: [] },
    },
    actions: [{
      actionId, kind: 'viewer', status, artifactRefs: ['deps_viewer.html'], reasons: status === 'available' ? [] : [{ code: 'blocked', message: 'viewer blocked' }],
    }, {
      actionId: 'analyze.dependency-redundancy', kind: 'analysis', status: 'available',
      artifactRefs: ['deps.json'], reasons: [],
      skill: { name: 'dependency-redundancy', provider: 'pypto-official-rev', revision: 'rev' },
    }],
  }
}

function handle(id = 'handle-1', actionId = 'open.dependency-graph'): PtoArtifactViewerHandle {
  return {
    handleId: id, actionId, title: 'deps_viewer.html',
    artifactRef: 'deps_viewer.html', kind: 'static-html', urlPath: `/pto/${id}`,
    features: { selection: false, deeplink: false },
  }
}

function remote(overrides: Partial<PtoViewerRemote> = {}): PtoViewerRemote {
  return {
    refresh: vi.fn(async () => ({ ok: true as const, value: record() })),
    inspect: vi.fn(async () => ({ ok: true as const, value: record() })),
    open: vi.fn(async () => ({ ok: true as const, value: handle() })),
    close: vi.fn(async () => ({ ok: true as const, value: { closed: true } })),
    admitAnalysis: vi.fn<PtoViewerRemote['admitAnalysis']>(async request => ({ ok: true as const, value: {
      requestId: request.requestId,
      sessionId: request.sessionId,
      recordId: request.recordId,
      recordRevision: request.revision,
      actionId: request.actionId,
      artifactRefs: ['deps.json'],
      skill: request.requestedSkill,
      tool: { name: 'pto_dependency_redundancy', revision: 'tool-rev' },
    } })),
    ...overrides,
  }
}

describe('PtoViewerController', () => {
  it('opens an available static viewer and revokes it on close', async () => {
    const gateway = remote()
    const controller = new PtoViewerController(gateway)
    await controller.open('/data/pack')
    expect(controller.getSnapshot()).toMatchObject({ kind: 'open', handle: { handleId: 'handle-1' } })
    expect(gateway.open).toHaveBeenCalledWith({
      recordId: 'record-1', revision: 'revision-1', actionId: 'open.dependency-graph',
    })
    await controller.close()
    expect(controller.getSnapshot()).toEqual({ kind: 'idle' })
    expect(gateway.close).toHaveBeenCalledWith({ handleId: 'handle-1' })
  })

  it('keeps a concrete unavailable reason without creating a viewer handle', async () => {
    const gateway = remote({ inspect: vi.fn(async () => ({ ok: true as const, value: record('open.dependency-graph', 'unavailable') })) })
    const controller = new PtoViewerController(gateway)
    await controller.open('/data/pack')
    expect(controller.getSnapshot()).toEqual({ kind: 'error', path: '/data/pack', message: 'viewer blocked' })
    expect(gateway.open).not.toHaveBeenCalled()
  })

  it('revokes a late handle after the user dismisses loading', async () => {
    let resolveOpen!: (value: Awaited<ReturnType<PtoViewerRemote['open']>>) => void
    const pending = new Promise<Awaited<ReturnType<PtoViewerRemote['open']>>>((resolve) => { resolveOpen = resolve })
    const gateway = remote({ open: vi.fn(() => pending) })
    const controller = new PtoViewerController(gateway)
    const opening = controller.open('/data/pack')
    await vi.waitFor(() => { expect(gateway.open).toHaveBeenCalled() })
    await controller.close()
    resolveOpen({ ok: true, value: handle('late') })
    await opening
    expect(controller.getSnapshot()).toEqual({ kind: 'idle' })
    expect(gateway.close).toHaveBeenCalledWith({ handleId: 'late' })
  })

  it('switches between available static viewers on the same record revision', async () => {
    const base = record()
    const multi: PtoArtifactRecordView = { ...base, actions: [...base.actions, {
      actionId: 'open.memory-map', kind: 'viewer', status: 'available' as const,
      artifactRefs: ['memory_map.html'], reasons: [],
    }] }
    const gateway = remote({
      inspect: vi.fn(async () => ({ ok: true as const, value: multi })),
      open: vi.fn<PtoViewerRemote['open']>(async request => ({
        ok: true as const,
        value: handle(request.actionId === 'open.memory-map' ? 'handle-memory' : 'handle-deps', request.actionId),
      })),
    })
    const controller = new PtoViewerController(gateway)
    await controller.open('/data/pack')
    await controller.switchViewer('open.memory-map')
    expect(controller.getSnapshot()).toMatchObject({
      kind: 'open',
      record: { recordId: 'record-1', profile: { revision: 'revision-1' } },
      handle: { handleId: 'handle-memory', actionId: 'open.memory-map' },
    })
    expect(gateway.close).toHaveBeenCalledWith({ handleId: 'handle-deps' })
    await expect(controller.switchViewer('open.program-graph')).rejects.toThrow('is not available')
  })

  it('keeps a fixed launch intent for admission retry and rejects missing bindings', async () => {
    const gateway = remote()
    const controller = new PtoViewerController(gateway)
    await controller.open('/data/pack')
    const begin = vi.fn<Parameters<PtoViewerController['stageAnalysis']>[0]>()
    controller.stageAnalysis(begin)
    const content = begin.mock.calls[0]![0]
    const intent = begin.mock.calls[0]![1]
    expect(intent).toMatchObject({ recordId: 'record-1', revision: 'revision-1' })
    await controller.checkAnalysis(intent, intent.requestId, undefined, content)
    expect(gateway.admitAnalysis).not.toHaveBeenCalled()
    await controller.checkAnalysis(intent, intent.requestId, 'session-1', content)
    await controller.close()
    await controller.checkAnalysis(intent, intent.requestId, 'session-1', content)
    expect(gateway.admitAnalysis).toHaveBeenCalledTimes(2)
    const { artifactRefs, composerVersion, ...wireIntent } = intent
    expect(artifactRefs).toEqual(['deps.json'])
    expect(composerVersion).toBe(1)
    expect(gateway.admitAnalysis).toHaveBeenLastCalledWith({ ...wireIntent, sessionId: 'session-1' })
    await expect(controller.checkAnalysis(undefined, intent.requestId, 'session-1')).rejects.toThrow('Missing analysis binding')
    await expect(controller.checkAnalysis(intent, 'wrong-id', 'session-1')).rejects.toThrow('Invalid analysis binding')
  })

  it('preserves the Viewer and displays a refused activation without replacing the draft', async () => {
    const controller = new PtoViewerController(remote())
    await controller.open('/data/pack')
    expect(() => { controller.stageAnalysis(() => { throw new Error('Unsent draft') }) }).toThrow('Unsent draft')
    expect(controller.getSnapshot()).toMatchObject({ kind: 'open', analysisError: 'Unsent draft' })
  })
  it('stages real reference identity, closes the overlay, and reopens a fresh complete handle', async () => {
    const gateway = remote({ open: vi.fn<PtoViewerRemote['open']>()
      .mockResolvedValueOnce({ ok: true, value: handle('old') })
      .mockResolvedValueOnce({ ok: true, value: handle('new') }) })
    const controller = new PtoViewerController(gateway)
    await controller.open('/outside/session/cwd')
    const begin = vi.fn<Parameters<PtoViewerController['stageAnalysis']>[0]>()
    controller.stageAnalysis(begin)
    expect(controller.getSnapshot()).toEqual({ kind: 'idle' })
    expect(gateway.close).toHaveBeenCalledWith({ handleId: 'old' })
    const [content, intent] = begin.mock.calls[0]!
    expect(content.text).toContain('/skill dependency-redundancy @deps.json ')
    expect(content.references).toMatchObject([{ source: 'pto-artifact', label: 'deps.json', activatable: true }])
    const ref = content.references[0]!.ref
    expect(JSON.parse(ref)).toEqual({ recordId: intent.recordId, revision: intent.revision, artifactRef: 'deps.json' })
    await controller.openReference(ref)
    expect(controller.getSnapshot()).toEqual({ kind: 'open', record: record(), handle: handle('new') })
    await controller.close()
    expect(gateway.close).toHaveBeenCalledWith({ handleId: 'new' })
  })

  it('refuses removed or changed visible intent before admission, while preserving admitted question retries', async () => {
    const gateway = remote()
    const controller = new PtoViewerController(gateway)
    await controller.open('/data/pack')
    const begin = vi.fn<Parameters<PtoViewerController['stageAnalysis']>[0]>()
    controller.stageAnalysis(begin)
    const [content, intent] = begin.mock.calls[0]!
    for (const invalid of [
      { ...content, references: [] },
      { ...content, text: content.text.replace('/skill dependency-redundancy', '/skill other') },
      { ...content, text: content.text.replace('/skill dependency-redundancy', '') },
      { ...content, references: [{ ...content.references[0]!, ref: 'wrong-record' }] },
    ]) await expect(controller.checkAnalysis(intent, intent.requestId, 'session-1', invalid)).rejects.toThrow('Reselect')
    expect(gateway.admitAnalysis).not.toHaveBeenCalled()
    await controller.checkAnalysis(intent, intent.requestId, 'session-1', content)
    await controller.checkAnalysis(intent, intent.requestId, 'session-1', { text: 'retry question', references: [] }, true)
    expect(gateway.admitAnalysis).toHaveBeenCalledTimes(2)
  })

  it('does not reopen a stale Record or keep a late reference handle after dismissal', async () => {
    const gateway = remote({ refresh: vi.fn(async () => ({ ok: true as const, value: { ...record(), profile: { ...record().profile, revision: 'new' } } })) })
    const controller = new PtoViewerController(gateway)
    const ref = JSON.stringify({ recordId: 'record-1', revision: 'revision-1', artifactRef: 'deps.json' })
    await expect(controller.openReference(ref)).rejects.toThrow('reassociate')
    expect(gateway.open).not.toHaveBeenCalled()
    let resolve!: (value: Awaited<ReturnType<PtoViewerRemote['open']>>) => void
    const lateGateway = remote({ open: vi.fn<PtoViewerRemote['open']>(() => new Promise((done) => { resolve = done })) })
    const lateController = new PtoViewerController(lateGateway)
    const opening = lateController.openReference(ref)
    await vi.waitFor(() => { expect(lateGateway.open).toHaveBeenCalled() })
    await lateController.close()
    resolve({ ok: true, value: handle('late-reference') })
    await opening
    expect(lateController.getSnapshot()).toEqual({ kind: 'idle' })
    expect(lateGateway.close).toHaveBeenCalledWith({ handleId: 'late-reference' })
  })

})
