// @vitest-environment jsdom
// Real plugin assembly; the Host boundary is stubbed here, never used as live receipt evidence.
import { expect, it, onTestFinished, vi } from 'vitest'
import { SlotTestRuntime, TestRemote, stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { WorkspaceBrowserInjected } from '../src/client/index.ts'
import type { PtoViewerOverlayInjected } from '../src/client/PtoViewerOverlay.tsx'
import type { AgentPresetSeatInjected } from '../../ui-agent-preset/src/client/AgentPresetSeat.tsx'
import type { InputHub } from '../../ui-conversation/src/client/input/hub.ts'
import type { PtoViewerRemote } from '../src/client/pto-viewer.ts'
import { apply as workspaceApply, inject as workspaceInject } from '../src/client/index.ts'
import { apply as conversationApply, inject as conversationInject } from '../../ui-conversation/src/client/index.ts'
import { apply as triggerApply, inject as triggerInject } from '../../ui-input-trigger/src/client/index.ts'
import { apply as presetApply, inject as presetInject } from '../../ui-agent-preset/src/client/index.ts'

it('keeps launch identity through preset drift, admission retry, model retry and a new launch', async () => {
  const runtime = await SlotTestRuntime.create()
  onTestFinished(() => runtime.dispose())
  localStorage.clear()
  onTestFinished(() => { localStorage.clear() })
  runtime.releaseWorkspaceSource()
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)
  runtime.ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  let release!: (value: unknown) => void
  const roster = new Promise((resolve) => { release = resolve })
  // Cleanup releases the owned barrier even if an assertion fails.
  onTestFinished(() => { release({ ok: true, value: { presets: [], authorable: false } }) })
  let viewedRecord = 'record-1'
  let missingProvider = true
  let modelFailure = false
  const sent = vi.fn(async () => {
    if (modelFailure) { modelFailure = false; return { ok: false, error: { code: 'model/failure', message: 'model failed' } } }
    return { ok: true, value: { accepted: true } }
  })
  let createRelease!: () => void
  const createBarrier = new Promise<void>((resolve) => { createRelease = resolve })
  onTestFinished(() => { createRelease() })
  let nextSession = 0
  runtime.sessions.stubCreate(async () => {
    if (nextSession === 0) await createBarrier
    const id = `session-${++nextSession}` as never
    await runtime.sessions.add({ id, summary: { cwd: '/fixture', blank: true }, session: { prompt: sent as never } }, { current: false })
    return id
  })
  const admitAnalysis = vi.fn(async (request: Parameters<PtoViewerRemote['admitAnalysis']>[0]) => {
    if (missingProvider) throw new Error('provider missing')
    return { ok: true, value: request }
  })
  const namespaces = {
    directoryPicker: {},
    settings: {},
    agentPresets: { list: () => roster },
    ptoArtifactInspection: {
      refresh: async (recordId: string) => ({ ok: true, value: { recordId, profile: { revision: 'revision-1' } } }),
      inspect: async () => ({ ok: true, value: {
        recordId: viewedRecord, profile: { revision: 'revision-1', displayPath: '/fixture' },
        actions: [
          { actionId: 'open.dependency-graph', kind: 'viewer', status: 'available' },
          { actionId: 'analyze.dependency-redundancy', kind: 'analysis', status: 'available', artifactRefs: ['deps.json'], skill: { name: 'dependency-redundancy', provider: 'official-fixed', revision: 'fixed' } },
        ],
      } }),
      open: async () => ({ ok: true, value: { handleId: 'viewer-1', actionId: 'open.dependency-graph' } }),
      close: async () => ({ ok: true, value: { closed: true } }),
      admitAnalysis,
    },
  }
  Object.assign(new TestRemote(runtime.ctx), namespaces)
  for (const [name, value] of Object.entries(namespaces)) runtime.ctx.provide(`remote.${name}` as never, value as never)
  await runtime.root.declare({
    conversation: { kind: 'single', scope: 'session-maybe' },
    'shell.overlay': { kind: 'list', scope: 'root' },
    'sidebar.workspaces': { kind: 'single', scope: 'root' },
  } as never, (() => null) as never)
  await runtime.mount({ inject: [...workspaceInject], apply: workspaceApply })
  await runtime.mount({ inject: [...triggerInject], apply: triggerApply })
  await runtime.mount({ inject: [...conversationInject], apply: conversationApply })
  await runtime.mount({ inject: [...presetInject], apply: presetApply })
  const browser = runtime.slots.entries('sidebar.workspaces')[0]!.inject!() as WorkspaceBrowserInjected
  const viewer = runtime.slots.entries('shell.overlay').find(e => e.options.id === 'pto-artifact-viewer')!.inject!() as unknown as PtoViewerOverlayInjected
  const seat = runtime.slots.entries('conversation.hero.agentPreset')[0]!.inject!() as unknown as AgentPresetSeatInjected
  browser.openRunRecordViewer?.('/fixture')
  await vi.waitFor(() => { expect(viewer.hooks.viewer.getSnapshot().kind).toBe('open') })
  const loading = seat.load()
  viewer.analyzeRecord()
  const controller = runtime.ctx.inputTriggers.draft()!
  const stage = controller.target()
  if (stage.kind !== 'draft') throw new Error('expected a draft target')
  expect(stage.agentPreset).toBeUndefined()
  release({ ok: true, value: { presets: [{ id: 'standard', trust: 'system', isDefault: true }], authorable: true } })
  await loading
  await vi.waitFor(() => { expect(controller.target()).toMatchObject({ agentPreset: 'standard' }) })
  const submit = controller.target()
  if (submit.kind !== 'draft') throw new Error('expected a draft target')
  expect(submit.agentPreset).toBe('standard')
  expect(submit.draftRevision).not.toBe(stage.draftRevision)
  const shell = (runtime.ctx.conversation.input as InputHub).draftShell()
  const original = { text: shell.snapshot.draft, references: shell.snapshot.occurrences }
  // Manual candidate selection and Viewer staging use identical owner identity.
  const query = '/skill dependency-redundancy @dep'
  shell.setDraft(query)
  controller.track(query, query.length, { tier: 'plain' }, shell.snapshot.draftRev)
  await vi.waitFor(() => {
    const menu = controller.menu.getSnapshot()
    expect(menu.open && menu.groups.some(group => group.source === 'pto-artifact' && group.status === 'ready')).toBe(true)
  })
  controller.pick('pto-artifact', 0)
  expect(shell.snapshot.occurrences.map(({ occurrenceId: _id, ...ref }) => ref))
    .toEqual(original.references.map(({ occurrenceId: _id, ...ref }) => ref))
  shell.setContent(original)
  // Restore uses saved reference projections, never reinterprets @deps.json as cwd-relative text.
  runtime.ctx.conversation.guardedDrafts.restore(() => { runtime.ctx.uiWorkspace.startUnassignedSession() })
  expect(shell.snapshot.draft).toBe(original.text)
  expect(shell.snapshot.occurrences).toMatchObject([{ source: 'pto-artifact', ref: original.references[0]!.ref, activatable: true }])
  const alternate = await runtime.workspaces.create({ path: '/alternate' })
  runtime.workspaces.list.set({ ...runtime.workspaces.list.getSnapshot(), items: [alternate] })
  runtime.ctx.uiWorkspace.selectDraftWorkspace(alternate.workspaceId)
  expect(controller.target()).toMatchObject({ workspaceId: alternate.workspaceId })
  expect(() => { runtime.ctx.uiWorkspace.startUnassignedSession() }).toThrow(/unsent/)
  viewedRecord = 'record-2'
  browser.openRunRecordViewer?.('/second-record')
  await vi.waitFor(() => { expect(viewer.hooks.viewer.getSnapshot()).toMatchObject({ kind: 'open', record: { recordId: 'record-2' } }) })
  const references = shell.snapshot.occurrences
  const editedDraft = '/skill dependency-redundancy @deps.json edited analysis question'
  shell.setContent({ text: editedDraft, references })
  shell.actions.submit()
  shell.actions.submit()
  await vi.waitFor(() => { expect(shell.state.getSnapshot().draft).toBe('') })
  expect(() => { runtime.ctx.uiWorkspace.startUnassignedSession() }).toThrow(/unsent/)
  viewer.analyzeRecord()
  expect(nextSession).toBe(0)
  createRelease()
  await vi.waitFor(() => { expect(admitAnalysis).toHaveBeenCalledTimes(1) })
  expect(sent).not.toHaveBeenCalled()
  expect(nextSession).toBe(1)
  const sessionInput = runtime.ctx.conversation.input.for(runtime.sessions.scope('session-1')!)
  await vi.waitFor(() => { expect(sessionInput.state.getSnapshot().draft).toBe(editedDraft) })
  const firstRequest = admitAnalysis.mock.calls[0]![0]
  expect(firstRequest).toMatchObject({ recordId: 'record-1', sessionId: 'session-1' })
  missingProvider = false
  sessionInput.submit()
  await vi.waitFor(() => { expect(sent).toHaveBeenCalledTimes(1) })
  expect(admitAnalysis.mock.calls[1]![0]).toEqual(firstRequest)
  expect(nextSession).toBe(1)
  sessionInput.setDraft('model retry question')
  modelFailure = true
  sessionInput.submit()
  await vi.waitFor(() => { expect(sent).toHaveBeenCalledTimes(2) })
  await vi.waitFor(() => { expect(sessionInput.state.getSnapshot().draft).toBe('model retry question') })
  sessionInput.submit()
  await vi.waitFor(() => { expect(sent).toHaveBeenCalledTimes(3) })
  expect(nextSession).toBe(1)
  await vi.waitFor(() => { expect(sessionInput.state.getSnapshot().draft).toBe('') })
  viewer.analyzeRecord()
  const fresh = shell.state.getSnapshot().draft
  expect(fresh).not.toBe('')
  viewer.analyzeRecord()
  expect(shell.state.getSnapshot().draft).toBe(fresh)
  expect(viewer.hooks.viewer.getSnapshot().kind).toBe('idle')
  shell.actions.submit()
  await vi.waitFor(() => { expect(sent).toHaveBeenCalledTimes(4) })
  expect(nextSession).toBe(2)
  const lastRequest = admitAnalysis.mock.calls.at(-1)![0]
  expect(lastRequest.requestId).not.toBe(firstRequest.requestId)
  expect(lastRequest.sessionId).toBe('session-2')
  expect(lastRequest.recordId).toBe('record-2')
  await vi.waitFor(() => { expect(runtime.ctx.conversation.input.for(runtime.sessions.scope('session-2')!).state.getSnapshot().draft).toBe('') })
  browser.openRunRecordViewer?.('/second-record')
  await vi.waitFor(() => { expect(viewer.hooks.viewer.getSnapshot().kind).toBe('open') })
  viewer.analyzeRecord()
  shell.actions.setDraft('')
  runtime.ctx.uiWorkspace.startUnassignedSession()
  expect(shell.state.getSnapshot().draft).toBe('')
  expect(localStorage.getItem('dsh.conversation.launch.v1.browser')).toBeNull()
  expect(nextSession).toBe(2)
})
