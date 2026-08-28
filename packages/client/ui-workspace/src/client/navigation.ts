/** Workspace archive and directory UI capability. */

import { Service, type Context } from '@deepseek-ai/cordis'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {
  StandardSessionDraft, WorkspaceStandardSnapshot,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { ClientRemote, DirectoryListing, RemoteFailure } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  ISessions,
  SessionReference,
  SessionTarget,
  SessionListState,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type { SubagentAddress } from '@deepseek-ai/dsh-subagent/client'
import type {
  IWorkspaces, WorkspaceId, WorkspaceView,
} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'

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
   */
  openWorkspace(workspaceId: WorkspaceId, beforeOpen?: (sessionId: SessionId) => void): Promise<void>
  /**
   * Fork a Session and open the child unless a later navigation supersedes it.
   * @param sessionId - source Session.
   * @returns completion; a superseded request leaves its child available without selecting it.
   */
  forkSession(sessionId: SessionId): Promise<void>
  /**
   * Resolve the reusable or newly created blank Session for a Workspace.
   * @param workspaceId - target Workspace.
   * @returns a Session already addressable through the Session Controller.
   */
  connectWorkspace(workspaceId: WorkspaceId): Promise<SessionId>
  /**
   * Start a New Session flow and navigate to its Session.
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
   */
  archiveSession(sessionId: SessionId): Promise<void>
  /**
   * Unarchive a Session, restoring it to its recorded Workspace position.
   * @param sessionId - Session to unarchive.
   */
  unarchiveSession(sessionId: SessionId): Promise<void>
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
  private clearingArchivedCurrent = false

  /**
   * @param ctx - Client root Context.
   * @param directoryPicker - the directory-picking Remote namespace.
   * @param workspaces - pure Workspace Controller.
   * @param sessions - pure Session Controller.
   */
  constructor(
    ctx: Context,
    private readonly directoryPicker: ClientRemote['directoryPicker'],
    private readonly workspaces: IWorkspaces,
    private readonly sessions: ISessions,
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

    const archived = this.workspaces.list.getSnapshot().archivedSessionIds
    const sessions = this.sessions.list.getSnapshot()
    for (const id of sessions.ids) {
      const summary = sessions.byId[id]
      if (summary !== undefined && summary.blank && summary.cwd === workspace.path
        && workspace.sessionIds.includes(summary.id)
        && !archived.includes(summary.id)) return summary.id
    }

    const attempt = this.sessions.create({ workspaceId })
      .finally(() => { this.connecting.delete(workspaceId) })
    this.connecting.set(workspaceId, attempt)
    return attempt
  }

  openSession(target: SessionTarget): void {
    this.replaceMain(target, this.lifetime.signal)
  }

  async openWorkspace(workspaceId: WorkspaceId, beforeOpen?: (sessionId: SessionId) => void): Promise<void> {
    const navigation = AbortSignal.any([this.ctx.layout.beginNavigation(), this.lifetime.signal])
    const sessionId = await this.connectWorkspace(workspaceId)
    if (navigation.aborted) return
    this.replaceMain(sessionId, navigation, beforeOpen)
  }

  async forkSession(sessionId: SessionId): Promise<void> {
    const navigation = AbortSignal.any([this.ctx.layout.beginNavigation(), this.lifetime.signal])
    const childId = await this.sessions.fork({ sessionId, increaseTitle: true })
    if (!navigation.aborted) this.replaceMain(childId, navigation)
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
        this.openSession(sessionId)
        const preparers = [...this.draftPreparers].sort((left, right) => left[1] - right[1])
        for (const [prepare] of preparers) {
          try {
            await prepare(sessionId)
          } catch (error) {
            console.warn('new session preparation failed:', error)
          }
        }
        this.setSessionDraft(undefined)
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

  async archiveSession(sessionId: SessionId): Promise<void> {
    await this.workspaces.archiveSession(sessionId)
    if (this.mainReference?.sessionId === sessionId) this.clearMain()
  }

  async unarchiveSession(sessionId: SessionId): Promise<void> {
    await this.workspaces.unarchiveSession(sessionId)
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
      const saved = this.selection.getSnapshot()
      const savedTarget = saved.subagentAddress
        ?? (saved.sessionId !== undefined && sessions.byId[saved.sessionId] !== undefined
          ? saved.sessionId
          : undefined)
      if (savedTarget !== undefined) {
        initial = 'connecting'
        try {
          if (saved.subagentAddress !== undefined) {
            void this.sessions.refreshSubagents(saved.subagentAddress.parentSessionId)
          }
          this.openSession(savedTarget)
          initial = 'done'
        } catch (reason: unknown) {
          initial = 'waiting'
          console.warn('initial Session restoration failed:', reason)
        }
        return
      }
      const target = recentWorkspace(workspace.items, sessions.byId)
      if (target === undefined) {
        initial = 'done'
        return
      }
      initial = 'done'
      this.beginSessionDraft(target)
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
    void this.sessions.refreshSubagents(reference.sessionId)
    this.ctx.layout.selectPanel(null)
  }

  private beginSessionDraft(workspaceId: WorkspaceId | undefined): void {
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
