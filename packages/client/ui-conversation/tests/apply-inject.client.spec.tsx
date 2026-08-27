// @vitest-environment jsdom
// apply inject factories exercised end to end against the terminal thin
// API: the strict session API (views triple, draft mirror), the
// provide-channel input face (machine-sink submit choreography incl.
// transactional clear + failure retention), the resident API (selectWorkspace
// draft carrying), the composer-bar stop face, openDetails = select action +
// layout orchestration, and the closeDetails details API. Complements
// chat-apply.spec.tsx (registration) and selection-survival.spec.tsx (store
// axis). History opening is NOT an inject concern — the runtime sessions
// service opens on watch (sessions-service.spec.ts owns that behavior).
//
// The inject APIs are read off the ledger entries deliberately (typed at
// this spec's own contract): these cases pin factory choreography the UI
// guards would mask. Rendering-path acceptance lives in
// chat-toolview-slot.spec.tsx.

import { describe, expect, it, vi } from 'vitest'
import { SlotTestRuntime, usePinnedBrowserLanguages, stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionBehaviorOverrides } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { ISession, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { InputTriggerService } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  ChatViewInjected, ComposerBarInjected, ConversationInjected, ConversationSessionHeaderInjected,
  ConversationSessionInjected, DetailsInjected,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { createChatStore } from '../src/client/stores.ts'

// The service reads its initial locale from the browser; these specs assert
// the shipped Chinese copy, so they state the browser they assume.
usePinnedBrowserLanguages('zh-CN')

const ROOT = 'root-1' as SessionId

type ChatInstance = ReturnType<ReturnType<typeof createChatStore>['create']>
type ChatActions = ChatInstance['actions']

/** ISession verb mocks, typed against the production face (['prompt'] etc. keep vitest mock ergonomics). */
function sessionFakeFor() {
  return {
    open: vi.fn(() => Promise.resolve()),
    loadOlder: vi.fn<ISession['loadOlder']>(() => Promise.resolve()),
    prompt: vi.fn<ISession['prompt']>(() => Promise.resolve({ ok: true, value: { accepted: true } })),
    cancel: vi.fn<ISession['cancel']>(() => Promise.resolve({ ok: true, value: { accepted: true } })),
  } satisfies SessionBehaviorOverrides
}

async function bench(options: {
  admitMaterialized?: (draft: unknown, session: unknown, line: string, signal: AbortSignal) => Promise<void>
} = {}) {
  const runtime = await SlotTestRuntime.create()
  runtime.provide('connection', { api: { settings: {} }, isLoopback: false })
  // The plugin injects both; these specs exercise no settings path.
  runtime.provide('remote', { $on: () => () => {} })
  runtime.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  const sessionFake = sessionFakeFor()
  await runtime.sessions.add({
    id: ROOT,
    summary: { title: 'R', displayTitle: 'R', cwd: '/proj' },
    session: sessionFake,
  })
  const layoutFake = { openDetails: vi.fn(), closeDetails: vi.fn() }
  runtime.provide('layout', layoutFake)
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.provide('locale', locale)
  runtime.slots.installLocale(locale)
  if (options.admitMaterialized !== undefined) {
    await runtime.ctx.plugin(InputTriggerService)
    const inputTriggers = runtime.ctx.get('inputTriggers') as InputTriggerService
    inputTriggers.registerSource({
      trigger: '/',
      name: 'formal-admission-probe',
      targets: ['draft'],
      candidates: () => Promise.resolve([]),
      onPick: () => undefined,
      admitMaterialized: options.admitMaterialized,
    })
    inputTriggers.registerSource({
      trigger: '/',
      name: 'command',
      targets: ['session'],
      candidates: () => Promise.resolve([]),
      onPick: () => undefined,
    })
  }

  // The AppFrame role: the conversation-package slots must be declared by a
  // live entry before apply can contribute into them.
  await runtime.root.declare({
    'conversation': { kind: 'single', scope: 'session-maybe' },
    'details': { kind: 'single', scope: 'session' },
  }, (_p: { renderSlot?: unknown }) => null)

  const feature = await runtime.mount({ inject: [...inject], apply })

  // The host face (store resolution) exists only inside the installed
  // renderer, so materialize it the way the shell does.
  runtime.renderRoot()
  const entryOf = (key: 'conversation' | 'conversation.session' | 'conversation.session.header' | 'conversation.composer.bar' | 'conversation.view' | 'details') =>
    runtime.slots.entries(key)[0]!
  /** Resolve store instance + call the inject the way the outlet would. */
  const conversationApi = (id: SessionId) => {
    const entry = entryOf('conversation.session')
    const instance = runtime.storeOf('conversation.session', id) as ChatInstance
    const injected = (entry.inject as unknown as (sessionId: SessionId, actions: ChatActions) => ConversationSessionInjected)(
      id, instance.actions)
    return { instance, injected }
  }
  const conversationHeaderApi = (id: SessionId) => {
    const entry = entryOf('conversation.session.header')
    const instance = runtime.storeOf('conversation.session.header', id) as ChatInstance
    const injected = (entry.inject as unknown as (sessionId: SessionId, actions: ChatActions) => ConversationSessionHeaderInjected)(
      id, instance.actions)
    return { instance, injected }
  }
  const residentApi = (id: SessionId | undefined) => {
    const entry = entryOf('conversation')
    return (entry.inject as unknown as (sessionId: SessionId | undefined) => ConversationInjected)(id)
  }
  const composerApi = (id: SessionId | undefined) => {
    const entry = entryOf('conversation.composer.bar')
    return (entry.inject as unknown as (sessionId: SessionId | undefined) => ComposerBarInjected)(id)
  }
  /** Same resolution for the chat entry riding the view ring. */
  const chatViewApi = (id: SessionId) => {
    const entry = entryOf('conversation.view')
    const instance = runtime.storeOf('conversation.view', id) as ChatInstance
    const injected = (entry.inject as unknown as (sessionId: SessionId, actions: ChatActions) => ChatViewInjected)(
      id, instance.actions)
    return { instance, injected }
  }
  /** Materialize the input provide contribution the way the runtime does. */
  const inputApi = (id: SessionId) => {
    const info = runtime.sessions.provideInfo(id)!
    const state = info.hooks['input'] as {
      getSnapshot: () => { draft: string }
      subscribe: (fn: () => void) => () => void
    }
    const actions = info.props['inputActions'] as {
      setDraft: (text: string) => void
      submit: () => void
    }
    return { state, actions }
  }
  const draftInputApi = () => {
    const info = runtime.sessions.maybeProvideInfo(undefined)
    const state = info.hooks['input'] as {
      getSnapshot: () => { draft: string }
      subscribe: (fn: () => void) => () => void
    }
    const actions = info.props['inputActions'] as {
      setDraft: (text: string) => void
      submit: () => void
    }
    return { state, actions }
  }
  return {
    runtime, feature, slots: runtime.slots, entryOf,
    conversationApi, conversationHeaderApi, residentApi, composerApi, chatViewApi, inputApi, draftInputApi,
    sessionFake, layoutFake,
  }
}

describe('conversation slot inject API', () => {
  it('assembles the thin API side-effect-free', async () => {
    const b = await bench()
    const { injected } = b.conversationApi(ROOT)
    // Assembly has no session side effects: opening the event window belongs
    // to the runtime watch path, not the inject factory.
    expect(b.sessionFake.open).not.toHaveBeenCalled()
    expect(injected.views.list().map(v => v.id)).toEqual(['chat'])

    const chatView = b.chatViewApi(ROOT)
    chatView.injected.loadOlder()
    expect(b.sessionFake.loadOlder).toHaveBeenCalledTimes(1)
    chatView.injected.forkAt(17)
    await vi.waitFor(() => {
      expect(b.runtime.sessions.calls).toContainEqual({ method: 'open', args: [ROOT] })
    })
    expect(b.runtime.sessions.calls).toContainEqual({
      method: 'fork', args: [{ sessionId: ROOT, atSeq: 17, increaseTitle: true }],
    })
    await b.runtime.dispose()
  })

  it('the provide-channel input face submits through the machine sink: trim, transactional clear, failure retains the draft', async () => {
    const b = await bench()
    const { injected } = b.conversationApi(ROOT)
    const { state, actions } = b.inputApi(ROOT)
    // Whitespace-only: the machine treats it as empty — no prompt, draft kept.
    actions.setDraft('   ')
    actions.submit()
    expect(b.sessionFake.prompt).not.toHaveBeenCalled()
    expect(state.getSnapshot().draft).toBe('   ')
    // Success: the draft clears only after the sink settles.
    actions.setDraft('hello')
    actions.submit()
    await vi.waitFor(() => {
      expect(state.getSnapshot().draft).toBe('')
    })
    expect(b.sessionFake.prompt).toHaveBeenCalledWith([{ type: 'text', text: 'hello' }], 'queue', expect.any(AbortSignal))
    // Failure: the draft is retained through the round-trip.
    b.sessionFake.prompt.mockResolvedValueOnce({ ok: false, error: { code: 'agent-busy', message: 'b', details: { reason: 'b' } } })
    actions.setDraft('retry me')
    actions.submit()
    await vi.waitFor(() => {
      expect(b.sessionFake.prompt).toHaveBeenCalledTimes(2)
    })
    await new Promise(r => setTimeout(r, 0))
    expect(state.getSnapshot().draft).toBe('retry me')
    // Failure landing after new typing: no clobber (the interleaved edit wins).
    b.sessionFake.prompt.mockResolvedValueOnce({ ok: false, error: { code: 'agent-busy', message: 'b', details: { reason: 'b' } } })
    actions.submit()
    actions.setDraft('typed during flight')
    await new Promise(r => setTimeout(r, 0))
    expect(state.getSnapshot().draft).toBe('typed during flight')
    // The provide contribution is idempotent per session: one shell identity.
    expect(b.inputApi(ROOT).state).toBe(state)
    // The draft mirror rides the conversation inject face.
    const mirrored: string[] = []
    const unbind = injected.bindDraftMirror(text => mirrored.push(text))
    actions.setDraft('mirrored text')
    expect(mirrored).toEqual(['mirrored text'])
    unbind()
    // Stop failure is swallowed (promptError owns the display).
    b.sessionFake.cancel.mockResolvedValueOnce({ ok: false, error: { code: 'internal', message: 'x', details: {} } })
    b.composerApi(ROOT).stop!()
    await new Promise(r => setTimeout(r, 0))
    expect(b.sessionFake.cancel).toHaveBeenCalledTimes(1)
    await b.runtime.dispose()
  })

  it('inject fails loud when the session resolves no binding or the scope lacks the service', async () => {
    const b = await bench()
    const entry = b.entryOf('conversation.composer.bar')
    const injectFn = entry.inject as unknown as (sessionId: SessionId | undefined) => ComposerBarInjected
    // Unknown session: the keyboard face's binding resolution answers nothing.
    expect(() => { injectFn('ghost' as SessionId).stop!() }).toThrow(/resolved no binding/)
    // No session: the browser-only draft machine is live. The command
    // launcher starts a slash line locally; stop remains session-only.
    const absent = injectFn(undefined)
    expect(absent.keyboard).toBeDefined()
    expect(absent.toggleCommandMenu).toBeTypeOf('function')
    b.draftInputApi().actions.setDraft('draft tail')
    absent.toggleCommandMenu!({ start: 0, end: 0 })
    expect(b.draftInputApi().state.getSnapshot().draft).toBe('/draft tail')
    expect(absent.stop).toBeUndefined()
    expect(absent.hooks.notices.getSnapshot()).toBeNull()
    expect(absent.hooks.lexicon.getSnapshot().size).toBe(0)
    expect(absent.hooks.menuLauncher.getSnapshot()).toBeNull()
    // A scope whose service tree lost 'conversation' (the feature fiber
    // unloaded while a retained inject closure re-runs): fails loud too.
    const stop = injectFn(ROOT).stop!
    await b.feature.dispose()
    expect(() => { stop() }).toThrow(/unavailable through the session scope/)
    await b.runtime.dispose()
  })

  it('writes one slash when the draft plus launcher opens and removes it when the same launcher closes', async () => {
    const b = await bench({ admitMaterialized: () => Promise.resolve() })
    const draft = b.draftInputApi()
    const composer = b.composerApi(undefined)
    draft.actions.setDraft('draft tail')

    expect(composer.toggleCommandMenu!({ start: 0, end: 0 })).toBe(1)
    expect(draft.state.getSnapshot().draft).toBe('/draft tail')
    expect(composer.hooks.menuLauncher.getSnapshot()).toBe('/')

    expect(composer.toggleCommandMenu!({ start: 1, end: 1 })).toBe(0)
    expect(draft.state.getSnapshot().draft).toBe('draft tail')
    expect(composer.hooks.menuLauncher.getSnapshot()).toBeNull()
    await b.runtime.dispose()
  })

  it('removes the slash inserted by the session plus launcher when clicked again', async () => {
    const b = await bench({ admitMaterialized: () => Promise.resolve() })
    const input = b.inputApi(ROOT)
    const composer = b.composerApi(ROOT)
    input.actions.setDraft('tail')

    expect(composer.toggleCommandMenu!({ start: 0, end: 0 })).toBe(1)
    expect(input.state.getSnapshot().draft).toBe('/tail')
    expect(composer.hooks.menuLauncher.getSnapshot()).toBe('command')

    expect(composer.toggleCommandMenu!({ start: 1, end: 1 })).toBe(0)
    expect(input.state.getSnapshot().draft).toBe('tail')
    expect(composer.hooks.menuLauncher.getSnapshot()).toBeNull()
    await b.runtime.dispose()
  })

  it('never deletes another slash after the caret moves away from the launcher token', async () => {
    const b = await bench({ admitMaterialized: () => Promise.resolve() })
    const draft = b.draftInputApi()
    const composer = b.composerApi(undefined)
    draft.actions.setDraft('tail/')

    expect(composer.toggleCommandMenu!({ start: 0, end: 0 })).toBe(1)
    expect(draft.state.getSnapshot().draft).toBe('/tail/')
    expect(composer.toggleCommandMenu!({ start: 6, end: 6 })).toBeUndefined()
    expect(draft.state.getSnapshot().draft).toBe('/tail/')
    expect(composer.hooks.menuLauncher.getSnapshot()).toBeNull()
    await b.runtime.dispose()
  })

  it('openDetails (chat view face) writes the selection through the store actions and opens the panel', async () => {
    const b = await bench()
    const { instance, injected } = b.chatViewApi(ROOT)
    injected.openDetails({ turnSeq: 2, callId: 'c1' })
    expect(instance.store.getSnapshot().selection).toEqual({ turnSeq: 2, callId: 'c1' })
    expect(b.layoutFake.openDetails).toHaveBeenCalledTimes(1)
    // The chat view shares the conversation entry's store instance: selection
    // writes land where the skeleton and details read.
    const conv = b.conversationApi(ROOT)
    expect(conv.instance).toBe(instance)
    await b.runtime.dispose()
  })

  it('openFile (chat view face) resolves against session cwd and calls workspaces.openPath', async () => {
    const b = await bench()
    const { injected } = b.chatViewApi(ROOT)
    await injected.openFile('src/a.ts')
    await vi.waitFor(() => {
      expect(b.runtime.workspaces.calls).toContainEqual({ method: 'openPath', args: ['/proj/src/a.ts'] })
    })
    await b.runtime.dispose()
  })

  it('openFile rejects when the Host cannot open the path', async () => {
    const b = await bench()
    b.runtime.workspaces.stub('openPath', () => Promise.reject(new Error('xdg-open is not available')))
    const { injected } = b.chatViewApi(ROOT)
    await expect(injected.openFile('src/a.ts')).rejects.toThrow('xdg-open is not available')
    await b.runtime.dispose()
  })

  it('routes workspace switching to the browser draft and carries the current text', async () => {
    const b = await bench()
    const resident = b.residentApi(ROOT)
    const { state, actions } = b.inputApi(ROOT)
    actions.setDraft('carry me')
    await resident.selectWorkspace('workspace-1' as never)
    expect(b.runtime.workspaces.calls).toContainEqual({ method: 'selectDraftWorkspace', args: ['workspace-1'] })
    expect(state.getSnapshot().draft).toBe('')
    expect(b.draftInputApi().state.getSnapshot().draft).toBe('carry me')
    await b.runtime.dispose()
  })

  it('selectWorkspace stages both no-session and empty-session targets without opening a Session', async () => {
    const b = await bench()
    // No-session resident updates only the browser draft target.
    const noSession = b.residentApi(undefined)
    await noSession.selectWorkspace('workspace-0' as never)
    expect(b.runtime.workspaces.calls).toContainEqual({ method: 'selectDraftWorkspace', args: ['workspace-0'] })

    // A current empty draft also moves to the browser shell without creating.
    const resident = b.residentApi(ROOT)
    const { state } = b.inputApi(ROOT)
    expect(state.getSnapshot().draft).toBe('')
    await resident.selectWorkspace('workspace-3' as never)
    expect(b.runtime.workspaces.calls).toContainEqual({ method: 'selectDraftWorkspace', args: ['workspace-3'] })
    expect(b.runtime.sessions.calls.filter(c => c.method === 'open')).toHaveLength(0)
    await b.runtime.dispose()
  })

  it('materializes the browser draft only when its first prompt is submitted', async () => {
    const b = await bench()
    b.runtime.sessions.clear()
    b.runtime.workspaces.stub('materializeSessionDraft', () => Promise.resolve(ROOT))
    const { state, actions } = b.draftInputApi()
    actions.setDraft('first prompt')
    expect(b.runtime.workspaces.calls.filter(c => c.method === 'materializeSessionDraft')).toEqual([])
    expect(b.sessionFake.prompt).not.toHaveBeenCalled()

    actions.submit()
    await vi.waitFor(() => { expect(b.sessionFake.prompt).toHaveBeenCalledOnce() })
    expect(b.runtime.workspaces.calls).toContainEqual({ method: 'materializeSessionDraft', args: [] })
    expect(b.sessionFake.prompt).toHaveBeenCalledWith(
      [{ type: 'text', text: 'first prompt' }], 'queue', expect.any(AbortSignal),
    )
    await vi.waitFor(() => { expect(state.getSnapshot().draft).toBe('') })
    await b.runtime.dispose()
  })

  it('revalidates the materialized Session catalog before admitting the first prompt', async () => {
    const admitMaterialized = vi.fn(() => Promise.resolve())
    const b = await bench({ admitMaterialized })
    b.runtime.sessions.clear()
    b.runtime.workspaces.stub('materializeSessionDraft', () => Promise.resolve(ROOT))
    const { actions } = b.draftInputApi()
    actions.setDraft('/skill pto-analyze')

    actions.submit()
    await vi.waitFor(() => { expect(b.sessionFake.prompt).toHaveBeenCalledOnce() })

    expect(admitMaterialized).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'draft' }),
      { sessionId: ROOT },
      '/skill pto-analyze',
      expect.any(AbortSignal),
    )
    expect(admitMaterialized.mock.invocationCallOrder[0])
      .toBeLessThan(b.sessionFake.prompt.mock.invocationCallOrder[0]!)
    expect(b.runtime.workspaces.calls.filter(call => call.method === 'materializeSessionDraft')).toHaveLength(1)
    await b.runtime.dispose()
  })

  it('keeps the first prompt in the new Session when formal catalog admission rejects it', async () => {
    const admitMaterialized = vi.fn(() => Promise.reject(new Error('Skill "pto-analyze" is no longer available')))
    const b = await bench({ admitMaterialized })
    b.runtime.sessions.clear()
    b.runtime.workspaces.stub('materializeSessionDraft', () => Promise.resolve(ROOT))
    const draft = b.draftInputApi()
    draft.actions.setDraft('/skill pto-analyze')

    draft.actions.submit()
    await vi.waitFor(() => { expect(admitMaterialized).toHaveBeenCalledOnce() })
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(b.sessionFake.prompt).not.toHaveBeenCalled()
    expect(b.runtime.sessions.calls.filter(call => call.method === 'open')).toHaveLength(0)
    expect(b.inputApi(ROOT).state.getSnapshot().draft).toBe('/skill pto-analyze')
    expect(draft.state.getSnapshot().draft).toBe('/skill pto-analyze')
    await b.runtime.dispose()
  })

  it('scopedConversation fails loud when the session resolves no scope', async () => {
    const b = await bench()
    // The chat-view inject resolves the scoped conversation service at inject
    // time: an unlisted session hits the scope() === undefined throw directly.
    const entry = b.entryOf('conversation.view')
    const injectFn = entry.inject as unknown as (sessionId: SessionId, actions: unknown) => unknown
    expect(() => injectFn('never-listed' as SessionId, {})).toThrow(/resolved no scope/)
    await b.runtime.dispose()
  })

  it('views read face projects the ring ledger (subscribe/version through ctx.slots)', async () => {
    const b = await bench()
    const { injected } = b.conversationApi(ROOT)
    const before = injected.views.version()
    const listener = vi.fn()
    const unsub = injected.views.subscribe(listener)
    // A second ring rider (what ui-trajectory does in production).
    const off = b.slots.register(
      { name: 'conversation.view', id: 'chat2', order: 5, label: 'X' } as never, (() => null) as never)
    await Promise.resolve() // ledger notifications batch per microtask
    expect(listener).toHaveBeenCalled()
    expect(injected.views.version()).toBeGreaterThan(before)
    expect(injected.views.list().map(v => v.id)).toEqual(['chat', 'chat2'])
    // Label falls back to the id when a rider declares none.
    const off2 = b.slots.register(
      { name: 'conversation.view', id: 'bare', order: 6 } as never, (() => null) as never)
    expect(injected.views.list().map(v => v.label)).toEqual(['对话', 'X', 'bare'])
    off()
    off2()
    unsub()
    await b.runtime.dispose()
  })
})

describe('details inject API', () => {
  it('details injects the one layout callback; selection rides the shared store instead', async () => {
    const b = await bench()
    const entry = b.entryOf('details')
    const injected = (entry.inject as unknown as () => DetailsInjected)()
    expect(Object.keys(injected)).toEqual(['closeDetails'])
    injected.closeDetails()
    expect(b.layoutFake.closeDetails).toHaveBeenCalledTimes(1)
    // The shared handle: details resolves the SAME instance conversation writes.
    const conv = b.runtime.storeOf('conversation.session', ROOT)
    const details = b.runtime.storeOf('details', ROOT)
    expect(details).toBe(conv)
    await b.runtime.dispose()
  })
})
