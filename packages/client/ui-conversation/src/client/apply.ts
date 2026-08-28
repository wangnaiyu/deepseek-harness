/** Registers the target-neutral Conversation assembly, shell, input, and docks. */
import type { Context } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import { createSnapshotStore, type BoundActions } from '@deepseek-ai/dsh-client-store'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only service and declaration merges used by this assembly.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { UiConversation } from './conversation/assembly.ts'
import type { ViewTab } from './contract/views.ts'
import type {
  EditSelection, InputTriggerController, InputTriggerHit, PickOutcome, TokenSpan,
} from './contract/input.ts'
import type {
  ComposerBarInjected, ConversationInjected, ConversationSessionHeaderInjected,
  ConversationSessionInjected,
} from './contract/slots.ts'
import type { InputNotice } from './contract/input.ts'
import { createConversationStore, readConversationViewPreference } from './stores.ts'
import { ConversationController, UnsupportedImageMediaTypeError } from './service.ts'
import type { IConversation } from './service.ts'
import { ComposerBlockRegistry } from './input/blocks.ts'
import type { ComposerBlock } from './contract/composer-blocks.ts'
import { InputHub } from './input/hub.ts'
import type { SessionInputShell } from './input/facade.ts'
import { ComposerSubmissionPolicy } from './input/submission-policy.ts'
import { queueDockEntry } from './queue/QueueDock.tsx'
import { EnterBehaviorRow } from './settings/EnterBehaviorRow.tsx'
import type { EnterBehaviorRowInjected } from './settings/EnterBehaviorRow.tsx'
import { ConversationRoot } from './skeleton/ConversationRoot.tsx'
import { ConversationSession, ConversationSessionHeader } from './skeleton/ConversationSession.tsx'
import { InputBar } from './skeleton/InputBar.tsx'
import { todoDockEntry } from './skeleton/TodoPanel.tsx'
import { resolveActiveView } from './view-selection.ts'
import { en, NS, zh, type ConversationKey } from './locales.ts'
import { CONVERSATION_SETTINGS_NAMESPACE, type ConversationSettings } from '../submission-settings.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Conversation shell, composer, queue, and dock copy. */
    conversation: ConversationKey
  }
}

/** Services required by the Conversation plugin. */
export const inject = [
  'slots', 'sessions', 'uiSession', 'uiWorkspace', 'locale', 'settingsScope',
]

const ABSENT_BLOCK = {
  getSnapshot: (): ComposerBlock | undefined => undefined,
  subscribe: () => () => {},
}
const ABSENT_MENU_LAUNCHER = {
  getSnapshot: (): string | null => null,
  subscribe: () => () => {},
}

/** Optional draft-trigger service resolved structurally to keep feature packages decoupled. */
interface DraftInputTriggerService {
  bindDraft(binding: {
    readonly target: () => {
      readonly kind: 'draft'
      readonly draftRevision: string
      readonly workspaceId?: string
      readonly agentPreset?: string
    }
    readonly apply: (outcome: PickOutcome, span: TokenSpan) => boolean
  }): () => void
}

/** Resolve the session-scoped Conversation action face, failing loud. */
function scopedConversation(sessions: ISessions, id: SessionId): IConversation {
  const scoped = sessions.scope(id)
  if (scoped === undefined) throw new Error(`ui-conversation: session "${id}" resolved no scope`)
  const conversation = scoped.get('conversation')
  if (conversation === undefined) {
    throw new Error('ui-conversation: conversation service unavailable through the session scope')
  }
  return conversation
}

/** Resolve package-internal attachment operations from the public service. */
function concreteConversation(ctx: Context): ConversationController {
  const conversation = ctx.get('conversation') as ConversationController | undefined
  if (conversation === undefined) throw new Error('ui-conversation: conversation service unavailable')
  return conversation
}

/** Remove the slash immediately before a collapsed caret when closing a launcher that inserted it. */
function removeLauncherSlash(
  draft: string,
  draftRev: number,
  selection: { start: number; end: number },
  span: TokenSpan | undefined,
): { draft: string; caret: number } | undefined {
  if (span === undefined || span.draftRev !== draftRev || span.end !== span.start + 1) return undefined
  if (selection.start !== span.end || selection.end !== span.end || draft.slice(span.start, span.end) !== '/') return undefined
  return { draft: draft.slice(0, span.start) + draft.slice(span.end), caret: span.start }
}

/** Toggle one programmatic slash launcher while keeping its draft edit atomic. */
function toggleSlashLauncher(
  shell: SessionInputShell,
  inputTriggers: InputTriggerController | undefined,
  source: string,
  selection: EditSelection,
  open?: (hit: InputTriggerHit) => void,
): number | undefined {
  const snapshot = shell.snapshot
  if (inputTriggers?.launcher.getSnapshot() === source && inputTriggers.menu.getSnapshot().open) {
    const launcherSpan = inputTriggers.launcherSpan(source)
    inputTriggers.dismiss()
    const removal = removeLauncherSlash(snapshot.draft, snapshot.draftRev, selection, launcherSpan)
    if (removal === undefined) return undefined
    shell.setDraft(removal.draft)
    return removal.caret
  }
  shell.setDraft(
    snapshot.draft.slice(0, selection.start)
      + '/'
      + snapshot.draft.slice(selection.end),
  )
  const inserted = shell.snapshot
  open?.({
    trigger: '/',
    query: '',
    quoted: false,
    position: snapshot.draft.slice(0, selection.start).trim() === '' ? 'leading' : 'inline',
    span: { start: selection.start, end: selection.start + 1, draftRev: inserted.draftRev },
  })
  return selection.start + 1
}

/**
 * Mount the Conversation core and target-neutral presentation.
 * @param ctx - Client root context.
 */
export function apply(ctx: Context): void {
  const sessions = ctx.sessions
  const slots = ctx.slots
  const workspaceNavigation = ctx.get('uiWorkspace') as {
    list: {
      getSnapshot: () => {
        sessionDraft?: {
          revision: number
          catalogRevision: number
          workspaceId?: import('@deepseek-ai/dsh-workspace/types').WorkspaceId
          agentPreset?: string
        }
      }
      subscribe: (listener: () => void) => () => void
    }
    selectDraftWorkspace: (workspaceId: import('@deepseek-ai/dsh-workspace/types').WorkspaceId) => void
  } | undefined
  if (workspaceNavigation === undefined) throw new Error('ui-conversation: uiWorkspace service unavailable')
  const uiConversation = new UiConversation(ctx, sessions)

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-conversation: dictionaries')
  const t = ctx.locale.bind(NS)
  const conversationStore = createConversationStore()
  const submissionPolicy = new ComposerSubmissionPolicy(
    ctx.settingsScope.bind<ConversationSettings>({ namespace: CONVERSATION_SETTINGS_NAMESPACE }),
  )

  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'composer-enter',
    order: 20,
    locale: NS,
    inject: (): EnterBehaviorRowInjected => ({
      hooks: { busyEnter: submissionPolicy.busyEnter },
      setBusyEnter: (behavior) => { submissionPolicy.setBusyEnter(behavior) },
    }),
  }, EnterBehaviorRow))

  const viewTabs = (): ViewTab[] => {
    const tabs: ViewTab[] = []
    for (const entry of slots.entries('conversation.view')) {
      /* v8 ignore next -- list registration validates id at load. */
      if (entry.options.id === undefined) continue
      tabs.push({
        id: entry.options.id,
        label: resolveSlotLabel(entry.options.label) ?? entry.options.id,
      })
    }
    return tabs
  }
  const activateView = (sessionId: SessionId, preferred: string | null): void => {
    const active = resolveActiveView(viewTabs(), preferred)
    if (active !== undefined) uiConversation.binding(sessionId).activate(active.id)
  }
  const restoreView = (sessionId: SessionId): void => {
    activateView(sessionId, readConversationViewPreference(sessionId))
  }
  const restoreCurrentView = (): void => {
    const sessionId = sessions.list.getSnapshot().current
    if (sessionId !== undefined && sessions.binding(sessionId) !== undefined) {
      restoreView(sessionId)
    }
  }
  const conversationViews = createSnapshotStore<readonly ViewTab[]>(viewTabs())
  const refreshViews = (): void => {
    const current = conversationViews.getSnapshot()
    const next = viewTabs()
    const unchanged = current.length === next.length
      && current.every((tab, index) => {
        const candidate = next.at(index)
        return candidate !== undefined && tab.id === candidate.id && tab.label === candidate.label
      })
    if (!unchanged) conversationViews.set(next)
    restoreCurrentView()
  }
  ctx.effect(() => {
    let currentSessionId = sessions.list.getSnapshot().current
    const disposeViews = slots.subscribe('conversation.view', refreshViews)
    const disposeLocale = ctx.locale.subscribe(refreshViews)
    const disposeCurrent = sessions.list.subscribe(() => {
      const nextSessionId = sessions.list.getSnapshot().current
      if (nextSessionId === currentSessionId) return
      currentSessionId = nextSessionId
      restoreCurrentView()
    })
    return () => {
      disposeCurrent()
      disposeLocale()
      disposeViews()
    }
  }, 'ui-conversation: View selection')

  const inputHub = new InputHub(ctx, t)

  // The no-session composer shares the ordinary trigger controller and menu.
  // Picks apply directly to the resident browser draft with the same span CAS;
  // no Session is allocated until the draft's default sink runs on submit.
  ctx.inject(['inputTriggers'], (scope: Context) => {
    const inputTriggers = scope.get('inputTriggers') as DraftInputTriggerService | undefined
    if (inputTriggers === undefined) return
    const shell = inputHub.draftShell()
    const applyPick = (outcome: PickOutcome, span: TokenSpan): boolean => {
      if (outcome === undefined || outcome === 'handled') return false
      if ('claim' in outcome) return shell.beginCommand(outcome.claim, span)
      if ('text' in outcome) return shell.insertText(outcome.text, span, outcome.continue === true)
      return shell.insertReference(outcome.insert, span)
    }
    scope.effect(() => inputTriggers.bindDraft({
      target: () => {
        const draft = workspaceNavigation.list.getSnapshot().sessionDraft
        return {
          kind: 'draft',
          draftRevision: `${draft?.catalogRevision ?? 0}:${String(draft?.workspaceId ?? '')}:${draft?.agentPreset ?? ''}`,
          ...draft?.workspaceId === undefined ? {} : { workspaceId: String(draft.workspaceId) },
          ...draft?.agentPreset === undefined ? {} : { agentPreset: draft.agentPreset },
        }
      },
      apply: applyPick,
    }), 'ui-conversation: browser draft trigger controller')
  })

  // The composer-block registry: a plugin that knows a session cannot send —
  // ui-model-selection, when no adapter serves the session's route — raises a block
  // here, and the bar reads its own session's store. It cannot flow the other
  // way: this package must not import the plugins that would know.
  const composerBlocks = new ComposerBlockRegistry()

  // Conversation assembly and input share the Session binding lifecycle. The
  // source roster is installed before any consuming Slot entry.
  ctx.uiSession.provide({
    hooks: ['conversation', 'input'],
    props: ['inputActions'],
    resolve: (binding) => {
      const shell = inputHub.shellFor(binding)
      const conversation = uiConversation.binding(binding)
      restoreView(binding.sessionId)
      return {
        hooks: {
          conversation: conversation.snapshot,
          input: shell.state,
        },
        props: { inputActions: shell.actions },
      }
    },
    resolveAbsent: () => {
      const shell = inputHub.draftShell()
      return {
        hooks: { input: shell.state },
        props: { inputActions: shell.actions },
      }
    },
  })

  // A new browser-draft revision means an explicit New Session gesture. The
  // resident no-session shell is reused for DOM stability, so reset its old
  // text/images here; changing only the draft's Workspace preserves them.
  let draftRevision = workspaceNavigation.list.getSnapshot().sessionDraft?.revision
  let draftCatalogTarget = (() => {
    const draft = workspaceNavigation.list.getSnapshot().sessionDraft
    return `${draft?.catalogRevision ?? 0}:${String(draft?.workspaceId ?? '')}:${draft?.agentPreset ?? ''}`
  })()
  ctx.effect(() => workspaceNavigation.list.subscribe(() => {
    const currentDraft = workspaceNavigation.list.getSnapshot().sessionDraft
    const next = currentDraft?.revision
    if (next !== undefined && next !== draftRevision) inputHub.resetDraft()
    draftRevision = next
    const nextCatalogTarget = `${currentDraft?.catalogRevision ?? 0}:${String(currentDraft?.workspaceId ?? '')}:${currentDraft?.agentPreset ?? ''}`
    if (nextCatalogTarget !== draftCatalogTarget) inputHub.draftInputTriggers()?.dismiss()
    draftCatalogTarget = nextCatalogTarget
  }), 'ui-conversation: browser draft generation')

  // Resident current-session-optional shell. It owns the stable Hero/composer
  // frame while strict session slots fill only their session-bound regions.
  const registerConversationRoot = () => slots.register({
    name: 'conversation',
    locale: NS,
    children: {
      'conversation.session': { kind: 'single', scope: 'session' },
      'conversation.session.header': { kind: 'single', scope: 'session' },
      'conversation.composer': { kind: 'chain', scope: 'session' },
      'conversation.composer.bar': { kind: 'single', scope: 'session-maybe' },
      'conversation.input.dock': { kind: 'list', scope: 'session' },
      'conversation.hero.brand.mark': { kind: 'single', scope: 'root' },
      'conversation.hero.workspace': { kind: 'single', scope: 'root' },
      'conversation.hero.agentPreset': { kind: 'single', scope: 'root' },
    },
    inject: (sessionId: SessionId | undefined): ConversationInjected => ({
      hooks: { composerBlock: sessionId === undefined ? ABSENT_BLOCK : composerBlocks.storeFor(sessionId) },
      selectWorkspace: workspaceId => Promise.resolve().then(() => {
        if (sessionId !== undefined) {
          const from = inputHub.shell(sessionId)
          const draft = from.snapshot.draft
          const imageIds = from.snapshot.imageIds
          const next = inputHub.draftShell()
          if (imageIds.length === 0 || next.addImages(imageIds)) {
            if (draft !== '') {
              next.setDraft(draft)
              from.setDraft('')
            }
            if (imageIds.length > 0) {
              for (const id of imageIds) from.removeImage(id)
            }
          }
        }
        workspaceNavigation.selectDraftWorkspace(workspaceId)
      }),
    }),
  }, ConversationRoot)

  const registerConversationSession = () => slots.register({
    name: 'conversation.session',
    children: {
      'conversation.view': { kind: 'list', scope: 'session' },
    },
    store: conversationStore,
    inject: (sessionId: SessionId, actions: BoundActions<typeof conversationStore>): ConversationSessionInjected => ({
      hooks: { conversationViews },
      bindDraftMirror: write => inputHub.shell(sessionId).bindMirror(write),
      openView: (view, focus) => {
        activateView(sessionId, view)
        actions.openView(view, focus)
      },
    }),
  }, ConversationSession)

  const registerConversationHeader = () => slots.register({
    name: 'conversation.session.header',
    locale: NS,
    children: {
      'conversation.session.header.lineage': { kind: 'single', scope: 'session' },
      'conversation.session.header.actions': { kind: 'list', scope: 'session' },
      'conversation.session.header.utilities': { kind: 'list', scope: 'session' },
    },
    store: conversationStore,
    inject: (sessionId: SessionId, actions: BoundActions<typeof conversationStore>): ConversationSessionHeaderInjected => ({
      hooks: { conversationViews },
      open: (id) => { sessions.open(id) },
      selectView: (view) => {
        activateView(sessionId, view)
        actions.setView(view)
      },
    }),
  }, ConversationSessionHeader)

  const composerBase = (
    conversation: ConversationController,
    shell: SessionInputShell,
  ): Pick<ComposerBarInjected, 'keyboard' | 'addImages' | 'removeImage' | 'draftImages' | 'resolveSubmitMode'> => ({
    keyboard: shell,
    addImages: (files) => {
      try {
        const images = conversation.createDraftImages(files)
        if (!shell.addImages(images.map(image => image.id))) conversation.releaseDraftImages(images)
        return null
      } catch (error: unknown) {
        if (error instanceof UnsupportedImageMediaTypeError) return t('image.unsupportedType')
        return error instanceof Error ? error.message : String(error)
      }
    },
    removeImage: (id) => {
      conversation.releaseDraftImage(id)
      shell.removeImage(id)
    },
    draftImages: ids => conversation.draftImages(ids),
    resolveSubmitMode: (running, gesture, steeringAvailable) =>
      submissionPolicy.resolve(running, gesture, steeringAvailable),
  })

  const registerComposerBar = () => slots.register({
    name: 'conversation.composer.bar',
    locale: NS,
    children: {
      'conversation.input.attachments': { kind: 'single', scope: 'session-maybe' },
      'conversation.input.overlay': { kind: 'list', scope: 'session-maybe' },
      'conversation.input.left': { kind: 'list', scope: 'session' },
      'conversation.input.plan': { kind: 'single', scope: 'session' },
      'conversation.input.right': { kind: 'list', scope: 'session' },
      'conversation.input.model': { kind: 'single', scope: 'session-maybe' },
      'conversation.composer.dock': { kind: 'list', scope: 'session' },
    },
    inject: (sessionId: SessionId | undefined): ComposerBarInjected => {
      if (sessionId === undefined) {
        const conversation = concreteConversation(ctx)
        const shell = inputHub.draftShell()
        const inputTriggers = inputHub.draftInputTriggers()
        return {
          ...composerBase(conversation, shell),
          toggleCommandMenu: selection => toggleSlashLauncher(
            shell, inputTriggers, '/', selection,
            inputTriggers === undefined ? undefined : (hit) => {
              inputTriggers.toggleTrigger(hit)
            },
          ),
          stop: undefined,
          command: line => conversation.commandDraftPermission(line),
          hooks: {
            notices: shell.notices,
            lexicon: shell.lexicon,
            menuLauncher: inputTriggers?.launcher ?? ABSENT_MENU_LAUNCHER,
            draftPermissions: conversation.draftPermissions,
          },
        }
      }
      const conversation = concreteConversation(ctx)
      const shell = inputHub.shell(sessionId)
      const inputTriggers = inputHub.inputTriggers(sessionId)
      return {
        ...composerBase(conversation, shell),
        toggleCommandMenu: inputTriggers === undefined
          ? undefined
          : (selection) => {
            shell.dismissPopup()
            return toggleSlashLauncher(
              shell, inputTriggers, 'command', selection,
              (hit) => {
                inputTriggers.toggleSource('command', hit)
              },
            )
          },
        stop: () => {
          scopedConversation(sessions, sessionId).cancel().catch(() => {
            // Stop failure is published through Session promptError.
          })
        },
        command: async (line) => {
          const session = sessions.binding(sessionId)?.session
          if (session === undefined) return false
          const result = await session.command(line)
          return result.ok && result.value.matched
        },
        hooks: {
          notices: shell.notices,
          lexicon: shell.lexicon,
          menuLauncher: inputTriggers?.launcher ?? ABSENT_MENU_LAUNCHER,
          draftPermissions: conversation.draftPermissions,
        },
      }
    },
  }, InputBar)

  slots.inject('conversation', function* () {
    yield registerConversationRoot()
    yield registerConversationSession()
    yield registerConversationHeader()
    yield registerComposerBar()
  })

  ctx.plugin(ConversationController, { input: inputHub, blocks: composerBlocks })
  ctx.plugin(todoDockEntry)
  ctx.plugin(queueDockEntry)
}
