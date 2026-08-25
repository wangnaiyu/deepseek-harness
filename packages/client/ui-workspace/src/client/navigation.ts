/** Workspace archive and directory UI capability. */

import { Service, type Context } from '@deepseek-ai/cordis'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {
  StandardSessionDraft, WorkspaceStandardSnapshot,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { ClientRemote, DirectoryListing, RemoteFailure } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  ISessions,
  SessionListState,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type {
  IWorkspaces, WorkspaceId, WorkspaceView,
} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Browser-only target for a New Session; it deliberately has no Session id. */
export type SessionDraft = StandardSessionDraft<WorkspaceId>

/** Workspace Controller projection plus the Client-only New Session target. */
export type WorkspaceUiSnapshot = WorkspaceStandardSnapshot<WorkspaceSnapshot, WorkspaceId>

/** Workspace archive and directory operations consumed by Client UI domains. */
export interface UiWorkspace {
  /** Workspace projection enriched with the browser-only draft. */
  readonly list: SnapshotStore<WorkspaceUiSnapshot>
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
  /** Retarget the active draft to a registered Workspace without resetting its editor. */
  selectDraftWorkspace(workspaceId: WorkspaceId): void
  /** Stage the Agent preset used by draft-only capability discovery. */
  selectDraftAgentPreset(agentPreset: string): void
  /** Create/open the staged Session and await ordered first-send preparation. */
  materializeSessionDraft(): Promise<SessionId>
  /** Register ordered preparation for a newly materialized draft Session. */
  prepareSessionDraft(prepare: (sessionId: SessionId) => Promise<void>, order?: number): () => void
  /**
   * Archive a Session and clear it when it is the current selection.
   * @param sessionId - Session to archive.
   */
  archiveSession(sessionId: SessionId): Promise<void>
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
    ctx.effect(() => this.watchNavigation(), 'ui-workspace: Workspace navigation policy')
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

  startSession(workspaceId?: WorkspaceId): void {
    const workspace = this.workspaces.list.getSnapshot()
    const sessions = this.sessions.list.getSnapshot()
    const current = sessions.current
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
    this.sessions.clear()
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
        this.sessions.open(sessionId)
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
    let disposed = false
    const reconcile = (): void => {
      if (disposed) return
      if (this.clearArchivedCurrent()) return
      if (initial !== 'waiting') return
      const workspace = this.workspaces.list.getSnapshot()
      const sessions = this.sessions.list.getSnapshot()
      if (workspace.phase !== 'ready' || sessions.phase !== 'ready') return
      if (sessions.current !== undefined) {
        initial = 'done'
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
      disposed = true
      disposeSessions()
      disposeWorkspaces()
    }
  }

  /** @returns true when an archived current selection was cleared. */
  private clearArchivedCurrent(): boolean {
    if (this.clearingArchivedCurrent) return true
    const current = this.sessions.list.getSnapshot().current
    if (current === undefined
      || !this.workspaces.list.getSnapshot().archivedSessionIds.includes(current)) return false
    this.clearingArchivedCurrent = true
    try {
      this.sessions.clear()
    } finally {
      this.clearingArchivedCurrent = false
    }
    return true
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
    this.sessions.clear()
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
