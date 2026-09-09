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

  it('stages a structured analysis and admits it idempotently for first send', async () => {
    const gateway = remote()
    const controller = new PtoViewerController(gateway)
    await controller.open('/data/pack')
    const begin = vi.fn(() => 'draft-revision')
    controller.stageAnalysis(begin)

    expect(begin).toHaveBeenCalledWith('分析此数据记录中的冗余依赖。请给出结论、证据、限制和下一步。')
    await expect(controller.admitAnalysis('other-draft', 'session-1')).resolves.toBeUndefined()
    const first = await controller.admitAnalysis('draft-revision', 'session-1')
    const second = await controller.admitAnalysis('draft-revision', 'session-1')
    expect(first).toEqual(second)
    expect(gateway.admitAnalysis).toHaveBeenCalledTimes(2)
    expect(gateway.admitAnalysis).toHaveBeenLastCalledWith(expect.objectContaining({
      sessionId: 'session-1',
      recordId: 'record-1',
      revision: 'revision-1',
      actionId: 'analyze.dependency-redundancy',
      requestedSkill: { name: 'dependency-redundancy', provider: 'pypto-official-rev', revision: 'rev' },
    }))
  })
})
