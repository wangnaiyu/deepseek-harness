/** Workspace archive and directory UI capability. */

import { Service, type Context } from '@deepseek-ai/cordis'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {
  StandardSessionDraft, WorkspaceStandardSnapshot,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { ClientRemote, DirectoryListing, RemoteFailure } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  ISessions,
  SessionCreateError,
  SessionReference,
  SessionTarget,
  SessionListState,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type { SubagentAddress } from '@deepseek-ai/dsh-subagent/client'
import type {
  IWorkspaces, WorkspaceId, WorkspaceSnapshot, WorkspaceView,
} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { RowToast } from './contract/slots.ts'
import { en, zh } from './locales.ts'
import { pinOrderAccounts, pinOrderSource } from './pin-order.ts'
import type { WorkspaceViewStoreActions } from './stores.ts'

interface MainSelection {
  readonly sessionId?: SessionId
  readonly subagentAddress?: SubagentAddress
}
/** Browser-only target for a New Session; it deliberately has no Session id. */
export type SessionDraft = StandardSessionDraft<WorkspaceId>

/** Workspace Controller projection plus the Client-only New Session target. */
export type WorkspaceUiSnapshot = WorkspaceStandardSnapshot<WorkspaceSnapshot, WorkspaceId>

/** Workspace archive and directory operations consumed by Client UI domains. */
export interface UiWorkspace {
  /** Workspace projection enriched with the browser-only draft. */
  readonly list: SnapshotStore<WorkspaceUiSnapshot>
  /**
   * Select a Session and show its Conversation as one UI navigation action.
   * @param target - known Session identity or durable direct-parent subagent address to display.
   */
  openSession(target: SessionTarget): void
  /**
   * Connect a Workspace and open its Session unless a later navigation supersedes it.
   * @param workspaceId - target Workspace.
   * @param beforeOpen - optional synchronous preparation for the selected Session, skipped after supersession.
   * @returns completion; a superseded request may create a Session but does not open it.
   * @throws on failure; a refused creation is also shown through the Workspace
   * notice unless a later navigation or disposal superseded the request.
   */
  openWorkspace(workspaceId: WorkspaceId, beforeOpen?: (sessionId: SessionId) => void): Promise<void>
  /**
   * Fork a Session without changing the current selection.
   * @param sessionId - source Session.
   * @returns completion after child creation and inherited-title increment.
   */
  forkSession(sessionId: SessionId): Promise<void>
  /**
   * Resolve the reusable or newly created blank Session for a Workspace.
   * @param workspaceId - target Workspace.
   * @returns a Session already addressable through the Session Controller.
   */
  connectWorkspace(workspaceId: WorkspaceId): Promise<SessionId>
  /**
   * Stage a browser-only New Session draft without creating a Session.
   * @param workspaceId - explicit target; absent inherits the current or most recent Workspace.
   */
  startSession(workspaceId?: WorkspaceId): void
  /** Begin a fresh draft explicitly targeting the Host process cwd. */
  startUnassignedSession(): void
  /**
   * Retarget the active draft to a registered Workspace without resetting its editor.
   * @param workspaceId - registered Workspace selected for the draft.
   */
  selectDraftWorkspace(workspaceId: WorkspaceId): void
  /**
   * Stage the Agent preset used by draft-only capability discovery.
   * @param agentPreset - preset id selected for the draft.
   */
  selectDraftAgentPreset(agentPreset: string): void
  /**
   * Create/open the staged Session and await ordered first-send preparation.
   * @returns the materialized Session id after preparation completes.
   */
  materializeSessionDraft(): Promise<SessionId>
  /**
   * Register ordered preparation for a newly materialized draft Session.
   * @param prepare - asynchronous preparation invoked with the new Session id.
   * @param order - ascending preparation order; defaults to registration order among peers.
   * @returns disposer removing this preparation callback.
   */
  prepareSessionDraft(prepare: (sessionId: SessionId) => Promise<void>, order?: number): () => void
  /**
   * Archive a Session and clear it when it is the current selection.
   * @param sessionId - Session to archive.
   * @param options - `stopActivity` asks the Host to stop the Session's running work instead of refusing.
   */
  archiveSession(sessionId: SessionId, options?: { readonly stopActivity?: boolean }): Promise<void>
  /**
   * Unarchive a Session, restoring it to its recorded Workspace position.
   * @param sessionId - Session to unarchive.
   */
  unarchiveSession(sessionId: SessionId): Promise<void>
  /**
   * Pin a Session on the Host, then lead it in its accounts' saved orders
   * (its Workspace group or Ungrouped, and the flat list). The order write
   * reads the memberships current at completion, so reorders that landed
   * while the Host call was pending keep their positions.
   * @param sessionId - Session to pin.
   */
  pinSession(sessionId: SessionId): Promise<void>
  /**
   * Unpin a Session on the Host; saved positions stay as they are.
   * @param sessionId - Session to unpin.
   */
  unpinSession(sessionId: SessionId): Promise<void>
  /**
   * Open the Host-native directory picker.
   * @returns the selected directory, or null when cancelled.
   */
  pickDirectory(): Promise<string | null>
  /**
   * List one Host directory level.
   * @param path - directory path; absent selects the Host home.
   * @param signal - cancellation for a superseded scan.
   * @returns directory entries and breadcrumb ancestry.
   */
  listDirectory(path?: string, signal?: AbortSignal): Promise<DirectoryListing>
  /**
   * Create a child directory.
   * @param path - existing parent directory.
   * @param name - child directory name.
   * @returns created absolute path.
   */
  createDirectory(path: string, name: string): Promise<string>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Cross-Controller Workspace navigation and directory UI capability. */
    uiWorkspace: UiWorkspace
  }
}

/** Structured directory failure exposed to directory UI consumers. */
export class DirectoryBrowseError extends Error {
  override readonly name = 'DirectoryBrowseError'

  /** @param rpcError - Host directory business failure. */
  constructor(readonly rpcError: RemoteFailure) {
    super(`directory browse failed: ${rpcError.code}: ${rpcError.message}`)
  }
}

/** Implements Workspace archive and directory UI operations. */
class UiWorkspaceService extends Service implements UiWorkspace {
  private readonly connecting = new Map<WorkspaceId, Promise<SessionId>>()
  private readonly lifetime = new AbortController()
  private readonly selection = createSnapshotStore<MainSelection>(
    {}, { persist: { name: 'dsh.sessions.current' } },
  )
  private mainReference: SessionReference | undefined
  readonly list: SnapshotStore<WorkspaceUiSnapshot>
  private draftRevision = 0
  private draftCatalogRevision = 0
  private materializingDraft: { revision: number; pending: Promise<SessionId> } | undefined
  private readonly draftPreparers = new Map<(sessionId: SessionId) => Promise<void>, number>()

  /**
   * @param ctx - Client root Context.
   * @param directoryPicker - the directory-picking Remote namespace.
   * @param workspaces - pure Workspace Controller.
   * @param sessions - pure Session Controller.
   * @param view - the browser's viewing-store write set (one instance shared with its registration).
   * @param notify - show one notice through the Workspace notice channel.
   */
  constructor(
    ctx: Context,
    private readonly directoryPicker: ClientRemote['directoryPicker'],
    private readonly workspaces: IWorkspaces,
    private readonly sessions: ISessions,
    private readonly view: Pick<WorkspaceViewStoreActions, 'pinSessionOrder'>,
    private readonly notify: (toast: RowToast) => void,
  ) {
    super(ctx, 'uiWorkspace')
    this.list = createSnapshotStore<WorkspaceUiSnapshot>({ ...workspaces.list.getSnapshot() })
    ctx.effect(() => {
      const project = (): void => {
        const sessionDraft = this.list.getSnapshot().sessionDraft
        this.list.set({
          ...this.workspaces.list.getSnapshot(),
          ...(sessionDraft === undefined ? {} : { sessionDraft }),
        })
      }
      const disposeWorkspace = this.workspaces.list.subscribe(project)
      return () => {
        disposeWorkspace()
      }
    }, 'ui-workspace: enriched Workspace projection')
    ctx.effect(() => {
      const stop = this.watchNavigation()
      return () => {
        stop()
        this.lifetime.abort()
        const reference = this.mainReference
        this.mainReference = undefined
        reference?.release()
      }
    }, 'ui-workspace: Workspace navigation policy')
  }

  async connectWorkspace(workspaceId: WorkspaceId): Promise<SessionId> {
    const workspace = this.workspaces.list.getSnapshot().items
      .find(item => item.workspaceId === workspaceId)
    if (workspace === undefined) {
      throw new Error(`uiWorkspace.connectWorkspace: unknown workspace ${workspaceId}`)
    }
    const inflight = this.connecting.get(workspaceId)
    if (inflight !== undefined) return inflight

    const attempt = this.reuseOrCreateBlank(workspace)
      .finally(() => { this.connecting.delete(workspaceId) })
    this.connecting.set(workspaceId, attempt)
    return attempt
  }

  private reuseOrCreateBlank(workspace: WorkspaceView): Promise<SessionId> {
    const archived = this.workspaces.list.getSnapshot().archivedSessionIds
    const sessions = this.sessions.list.getSnapshot()
    for (const id of sessions.ids) {
      const summary = sessions.byId[id]
      if (summary === undefined || !summary.blank || summary.cwd !== workspace.path
        || !workspace.sessionIds.includes(id) || archived.includes(id)) continue
      return this.reuseBlank(workspace.workspaceId, id)
    }
    return this.sessions.create({ workspaceId: workspace.workspaceId })
  }

  private async reuseBlank(workspaceId: WorkspaceId, sessionId: SessionId): Promise<SessionId> {
    try {
      return await this.sessions.create({ workspaceId, sessionId })
    } catch (error: unknown) {
      if (sessionCreateErrorOf(error)?.rpcError.code !== 'session/writer-held') throw error
      return this.sessions.create({ workspaceId })
    }
  }

  openSession(target: SessionTarget): void {
    this.replaceMain(target, this.lifetime.signal, 'reveal')
    this.setSessionDraft(undefined)
  }

  async openWorkspace(workspaceId: WorkspaceId, beforeOpen?: (sessionId: SessionId) => void): Promise<void> {
    const navigation = AbortSignal.any([this.ctx.layout.beginNavigation(), this.lifetime.signal])
    let sessionId: SessionId
    try {
      sessionId = await this.connectWorkspace(workspaceId)
    } catch (error: unknown) {
      // Reported here, not in connectWorkspace: startup restoration calls that
      // directly and stays console-only.
      if (!navigation.aborted) this.notify({ kind: 'createFailed', message: creationFailureMessage(error) })
      throw error
    }
    if (navigation.aborted) return
    this.replaceMain(sessionId, navigation, 'reveal', beforeOpen)
  }

  async forkSession(sessionId: SessionId): Promise<void> {
    await this.sessions.fork({ sessionId, increaseTitle: true })
  }

  startSession(workspaceId?: WorkspaceId): void {
    const workspace = this.workspaces.list.getSnapshot()
    const sessions = this.sessions.list.getSnapshot()
    const current = this.mainReference?.sessionId
    const currentWorkspaceId = current === undefined
      ? undefined
      : workspace.items.find(item => item.sessionIds.includes(current))?.workspaceId
    const recent = workspace.phase === 'ready' && sessions.phase === 'ready'
      ? recentWorkspace(workspace.items, sessions.byId)
      : undefined
    const target = workspaceId ?? currentWorkspaceId ?? recent
    this.beginSessionDraft(target)
  }

  startUnassignedSession(): void {
    this.beginSessionDraft(undefined)
  }

  selectDraftWorkspace(workspaceId: WorkspaceId): void {
    const workspace = this.workspaces.list.getSnapshot().items
      .find(item => item.workspaceId === workspaceId)
    if (workspace === undefined) {
      throw new Error(`uiWorkspace.selectDraftWorkspace: unknown workspace ${workspaceId}`)
    }
    const current = this.list.getSnapshot().sessionDraft
    if (current?.workspaceId === workspaceId && current.cwd === workspace.path) return
    this.setSessionDraft({
      revision: current?.revision ?? ++this.draftRevision,
      catalogRevision: ++this.draftCatalogRevision,
      workspaceId,
      cwd: workspace.path,
      ...(current?.agentPreset === undefined ? {} : { agentPreset: current.agentPreset }),
    })
    this.clearMain()
    this.ctx.layout.selectPanel(null)
  }

  selectDraftAgentPreset(agentPreset: string): void {
    if (agentPreset.trim() === '') {
      throw new Error('uiWorkspace.selectDraftAgentPreset: blank preset')
    }
    const current = this.list.getSnapshot().sessionDraft
    if (current === undefined || current.agentPreset === agentPreset) return
    this.setSessionDraft({
      ...current,
      catalogRevision: ++this.draftCatalogRevision,
      agentPreset,
    })
  }

  prepareSessionDraft(
    prepare: (sessionId: SessionId) => Promise<void>,
    order = 0,
  ): () => void {
    this.draftPreparers.set(prepare, order)
    return () => { this.draftPreparers.delete(prepare) }
  }

  materializeSessionDraft(): Promise<SessionId> {
    const draft = this.list.getSnapshot().sessionDraft
    if (draft === undefined) {
      return Promise.reject(new Error('uiWorkspace.materializeSessionDraft: no staged draft'))
    }
    if (this.materializingDraft?.revision === draft.revision) {
      return this.materializingDraft.pending
    }
    const pending = this.sessions.create(
      draft.workspaceId === undefined ? {} : { workspaceId: draft.workspaceId },
    ).then(async (sessionId) => {
      if (this.list.getSnapshot().sessionDraft?.revision === draft.revision) {
        this.replaceMain(sessionId, this.lifetime.signal, 'reveal')
        const reference = this.mainReference
        if (reference === undefined) throw new Error('Draft Session is not retained')
        await reference.ready
        const preparers = [...this.draftPreparers].sort((left, right) => left[1] - right[1])
        for (const [prepare] of preparers) {
          try {
            await prepare(sessionId)
          } catch (error) {
            console.warn('new session preparation failed:', error)
          }
        }
        if (this.list.getSnapshot().sessionDraft?.revision === draft.revision) {
          this.setSessionDraft(undefined)
        }
      }
      return sessionId
    }).finally(() => {
      if (this.materializingDraft?.revision === draft.revision) {
        this.materializingDraft = undefined
      }
    })
    this.materializingDraft = { revision: draft.revision, pending }
    return pending
  }

  async archiveSession(sessionId: SessionId, options: { readonly stopActivity?: boolean } = {}): Promise<void> {
    await this.workspaces.archiveSession(sessionId, options)
    if (this.mainReference?.sessionId === sessionId) this.clearMain()
  }

  async unarchiveSession(sessionId: SessionId): Promise<void> {
    await this.workspaces.unarchiveSession(sessionId)
  }

  async pinSession(sessionId: SessionId): Promise<void> {
    await this.workspaces.pinSession(sessionId)
    const { items, pinnedSessionIds, archivedSessionIds } = this.workspaces.list.getSnapshot()
    this.view.pinSessionOrder(
      sessionId,
      pinOrderAccounts(items, sessionId),
      pinOrderSource(items, this.sessions.list.getSnapshot(), { pinnedSessionIds, archivedSessionIds }),
    )
  }

  async unpinSession(sessionId: SessionId): Promise<void> {
    await this.workspaces.unpinSession(sessionId)
  }

  async pickDirectory(): Promise<string | null> {
    const result = await this.directoryPicker.pick()
    if (!result.ok) throw new Error(`directory picker failed: ${result.error.message}`)
    return result.value
  }

  async listDirectory(path?: string, signal?: AbortSignal): Promise<DirectoryListing> {
    const result = await this.directoryPicker.list(path, signal)
    if (!result.ok) throw new DirectoryBrowseError(result.error)
    return result.value
  }

  async createDirectory(path: string, name: string): Promise<string> {
    const result = await this.directoryPicker.createDirectory(path, name)
    if (!result.ok) throw new DirectoryBrowseError(result.error)
    return result.value
  }

  private watchNavigation(): () => void {
    let initial: 'waiting' | 'connecting' | 'done' = 'waiting'
    const reconcile = (): void => {
      if (this.lifetime.signal.aborted) return
      if (this.clearArchivedCurrent()) return
      if (initial !== 'waiting') return
      const workspace = this.workspaces.list.getSnapshot()
      const sessions = this.sessions.list.getSnapshot()
      if (workspace.phase !== 'ready' || sessions.phase !== 'ready') return
      if (this.mainReference !== undefined) {
        initial = 'done'
        return
      }
      initial = 'connecting'
      void this.restoreSelection(workspace, sessions).then(() => {
        initial = 'done'
      }, (reason: unknown) => {
        initial = 'waiting'
        if (!this.lifetime.signal.aborted) console.warn('initial Session restoration failed:', reason)
      })
    }

    const disposeWorkspaces = this.workspaces.list.subscribe(reconcile)
    const disposeSessions = this.sessions.list.subscribe(reconcile)
    reconcile()
    return () => {
      this.lifetime.abort()
      disposeSessions()
      disposeWorkspaces()
    }
  }

  private async restoreSelection(workspaces: WorkspaceSnapshot, sessions: SessionListState): Promise<void> {
    const saved = this.selection.getSnapshot()
    if (saved.subagentAddress !== undefined) {
      this.replaceMain(saved.subagentAddress, this.lifetime.signal, 'preserve')
      return
    }
    const summary = saved.sessionId === undefined ? undefined : sessions.byId[saved.sessionId]
    const workspace = summary === undefined ? undefined
      : workspaces.items.find(item => item.sessionIds.includes(summary.id))
    if (summary !== undefined && (!summary.blank || workspace === undefined)) {
      this.replaceMain(summary.id, this.lifetime.signal, 'preserve')
      return
    }
    const navigation = AbortSignal.any([this.ctx.layout.beginNavigation(), this.lifetime.signal])
    let target = workspace?.workspaceId ?? recentWorkspace(workspaces.items, sessions.byId)
    if (target === undefined && workspaces.items.length === 0 && sessions.ids.length === 0) {
      const prepared = await this.initializeDefaultWorkspace(navigation)
      if (navigation.aborted) return
      target = prepared?.workspaceId
    }
    if (target !== undefined && !navigation.aborted) this.beginSessionDraft(target)
  }

  private async initializeDefaultWorkspace(signal: AbortSignal): Promise<WorkspaceView | undefined> {
    const language = this.ctx.locale.getSnapshot().active.toLowerCase().split('-')[0]
    const title = (language === 'zh' ? zh : en)['defaultWorkspace.title']
    try {
      return await this.workspaces.initializeDefault({
        directoryName: language === 'zh' || language === 'en' ? title : 'default-workspace',
        title,
      }, signal)
    } catch (_error: unknown) {
      if (!signal.aborted) this.notify({ kind: 'defaultWorkspaceFailed' })
      return undefined
    }
  }

  /** @returns true when an archived current selection was cleared. */
  private clearArchivedCurrent(): boolean {
    const current = this.mainReference?.sessionId
    if (current === undefined
      || !this.workspaces.list.getSnapshot().archivedSessionIds.includes(current)) return false
    this.clearMain()
    return true
  }

  private clearMain(): void {
    const previous = this.mainReference
    this.mainReference = undefined
    this.selection.set({})
    previous?.release()
    this.ctx.layout.selectPanel(null)
  }

  private replaceMain(
    target: SessionTarget,
    signal: AbortSignal,
    panel: 'reveal' | 'preserve',
    beforeOpen?: (sessionId: SessionId) => void,
  ): void {
    signal.throwIfAborted()
    const reference = this.sessions.retain(target, { source: 'mainView' })
    try {
      signal.throwIfAborted()
      beforeOpen?.(reference.sessionId)
      if (signal.aborted) {
        reference.release()
        return
      }
      const subagentAddress = typeof target === 'string'
        ? this.sessions.subagentAddress(reference.sessionId)
        : target
      this.selection.set({
        sessionId: reference.sessionId,
        ...(subagentAddress === undefined ? {} : { subagentAddress }),
      })
    } catch (error: unknown) {
      reference.release()
      throw error
    }
    const previous = this.mainReference
    this.mainReference = reference
    previous?.release()
    if (panel === 'reveal') this.ctx.layout.selectPanel(null)
  }

  private beginSessionDraft(workspaceId: WorkspaceId | undefined): void {
    const conversation = this.ctx.get('conversation') as { guardedDrafts?: { assertCanStart(): void } } | undefined
    conversation?.guardedDrafts?.assertCanStart()
    const workspace = workspaceId === undefined
      ? undefined
      : this.workspaces.list.getSnapshot().items.find(item => item.workspaceId === workspaceId)
    if (workspaceId !== undefined && workspace === undefined) {
      throw new Error(`uiWorkspace.startSession: unknown workspace ${workspaceId}`)
    }
    this.setSessionDraft({
      revision: ++this.draftRevision,
      catalogRevision: ++this.draftCatalogRevision,
      ...(workspaceId === undefined ? {} : { workspaceId }),
      ...(workspace?.path === undefined ? {} : { cwd: workspace.path }),
    })
    this.clearMain()
  }

  private setSessionDraft(sessionDraft: SessionDraft | undefined): void {
    const { sessionDraft: _previous, ...snapshot } = this.list.getSnapshot()
    this.list.set(sessionDraft === undefined ? snapshot : { ...snapshot, sessionDraft })
  }

}

/**
 * `error` as the Session Controller's creation failure, or undefined when it
 * is not one. Client plugin bundles do not share error-class identity, so the
 * name decides.
 */
function sessionCreateErrorOf(error: unknown): SessionCreateError | undefined {
  return error instanceof Error && error.name === 'SessionCreateError' ? error as SessionCreateError : undefined
}

/**
 * The words a failed Session creation is reported in: a Host refusal keeps its
 * stable code and message; any other failure keeps its own message.
 */
function creationFailureMessage(error: unknown): string {
  const refused = sessionCreateErrorOf(error)
  if (refused !== undefined) return `${refused.rpcError.code}: ${refused.rpcError.message}`
  return error instanceof Error ? error.message : String(error)
}

/** Stable tie-breaking follows Host Workspace order. */
function recentWorkspace(
  workspaces: readonly WorkspaceView[],
  sessions: SessionListState['byId'],
): WorkspaceId | undefined {
  let selected: WorkspaceId | undefined
  let selectedTime = Number.NEGATIVE_INFINITY
  for (const workspace of workspaces) {
    let latest = Number.NEGATIVE_INFINITY
    for (const sessionId of workspace.sessionIds) {
      const session = sessions[sessionId]
      if (session !== undefined) latest = Math.max(latest, session.updatedAt)
    }
    if (latest === Number.NEGATIVE_INFINITY) latest = Date.parse(workspace.createdAt)
    if (selected === undefined || latest > selectedTime) {
      selected = workspace.workspaceId
      selectedTime = latest
    }
  }
  return selected
}

export { UiWorkspaceService }
