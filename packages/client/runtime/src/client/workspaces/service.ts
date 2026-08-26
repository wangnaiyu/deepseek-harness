/** WorkspaceRuntime projects the Workspace object manager for UI consumers. */

import type { Context } from '@deepseek-ai/cordis'
import type {
  DirectoryListing, IApiClient, RpcError,
  SessionId, WorkspaceId, WorkspaceView,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { HostDescriptionSource } from '@deepseek-ai/dsh-client-connection/client'
import type { SnapshotStore } from '../contract/store.ts'
import { createSnapshotStore } from '../contract/store.ts'
import type { SessionsPort, SessionsPortList } from '../contract/sessions-port.ts'
import type { IWorkspaces } from '../contract/workspaces.ts'
import { WorkspaceManager, type WorkspaceListPhase } from './manager.ts'

/** Workspace list plus the two-baseline readiness and default-target projection. */
export interface WorkspaceListState {
  items: readonly WorkspaceView[]
  /**
   * Registry-global archive set in Host order: grouping surfaces hide these
   * sessions everywhere (workspace groups and the ungrouped bucket) while
   * their session logs and workspace accounting slots remain. A plain array
   * (store-engine vocabulary; immer drafts reject Sets) — membership lookups
   * build their own transient Set.
   */
  archivedSessionIds: readonly SessionId[]
  state: 'idle' | 'loading' | 'error'
  phase: WorkspaceListPhase
  error: RpcError | null
  /** True only after both workspace.list and session.list have succeeded. */
  baselinesReady: boolean
  /** Most recently active Workspace, derived without changing `items` order. */
  recentWorkspaceId: WorkspaceId | undefined
  /**
   * Browser-only New Session draft. It deliberately has no Session id: a
   * click only stages where the eventual first prompt will run. The Host
   * entity is materialized by `materializeSessionDraft()` on first send.
   */
  sessionDraft?: {
    /** Monotonic local identity used only to reset the resident draft editor. */
    revision: number
    /** Monotonic capability-target identity; Workspace/preset switches do not reset the editor. */
    catalogRevision: number
    /** Registered Workspace target; absent means the Host process cwd. */
    workspaceId?: WorkspaceId
    /** Agent preset staged for the eventual Session; omitted lets the Host use its default. */
    agentPreset?: string
    /** Display-ready final directory known without creating a Session. */
    cwd?: string
  }
}

/** Structured create failure for UI flows that distinguish Host business errors. */
export class WorkspaceCreateError extends Error {
  constructor(readonly rpcError: RpcError) {
    super(`workspace create failed: ${rpcError.code}: ${rpcError.message}`)
    this.name = 'WorkspaceCreateError'
  }
}

/** Structured browse failure so the directory browser can branch on Host business codes. */
export class DirectoryBrowseError extends Error {
  constructor(readonly rpcError: RpcError) {
    super(`directory browse failed: ${rpcError.code}: ${rpcError.message}`)
    this.name = 'DirectoryBrowseError'
  }
}

/** Real Workspace object layer and Host actions. */
export class WorkspaceRuntime implements IWorkspaces {
  /** UI-facing immutable projection; the manager remains wire truth. */
  readonly list: SnapshotStore<WorkspaceListState>
  /** Workspace baseline and frame owner. */
  private readonly manager: WorkspaceManager
  /** One first-send materialization for the currently staged browser draft. */
  private materializingDraft: { revision: number; pending: Promise<SessionId> } | undefined
  /** Browser-draft generation; explicitly not a Session identity. */
  private draftRevision = 0
  /** Capability-target generation, independent from the resident editor reset identity. */
  private draftCatalogRevision = 0
  /** Optional feature preparation, ordered so composition changes settle before dependent choices. */
  private readonly draftPreparers = new Map<(sessionId: SessionId) => Promise<void>, number>()
  /** Guards the runtime-owned one-shot initial-selection subscription. */
  private initialSelectionStarted = false

  /**
   * @param ctx - client root context.
   * @param api - shared wire client.
   * @param sessions - cross-domain sessions face used for recency and first-send materialization.
   */
  constructor(
    ctx: Context,
    private readonly api: IApiClient,
    private readonly sessions: SessionsPort,
    private readonly hostDescription?: HostDescriptionSource,
  ) {
    this.manager = new WorkspaceManager(api)
    this.list = createSnapshotStore<WorkspaceListState>({
      items: [], archivedSessionIds: [], state: 'idle', phase: 'pending', error: null,
      baselinesReady: false, recentWorkspaceId: undefined,
    })
    this.manager.subscribe(() => { this.project() })
    this.sessions.list.subscribe(() => { this.project() })
    if (hostDescription !== undefined) {
      ctx.effect(() => hostDescription.subscribe(() => {
        const cwd = hostDescription.getSnapshot()?.cwd
        const draft = this.list.getSnapshot().sessionDraft
        if (cwd === undefined || draft === undefined || draft.workspaceId !== undefined || draft.cwd === cwd) return
        this.setSessionDraft({ ...draft, cwd })
      }), 'workspaces: Host cwd for browser draft')
    }
    ctx.reflect.provide('workspaces', this, undefined)
  }

  /** Stage one registered Workspace as the target of the browser-only draft. */
  selectDraftWorkspace(workspaceId: WorkspaceId): void {
    const workspace = this.list.getSnapshot().items.find(item => item.workspaceId === workspaceId)
    if (workspace === undefined) throw new Error(`workspaces.selectDraftWorkspace: unknown workspace ${workspaceId}`)
    const current = this.list.getSnapshot().sessionDraft
    if (current?.workspaceId === workspaceId && current.cwd === workspace.path) return
    this.setSessionDraft({
      revision: current?.revision ?? ++this.draftRevision,
      catalogRevision: ++this.draftCatalogRevision,
      workspaceId,
      cwd: workspace.path,
      ...current?.agentPreset === undefined ? {} : { agentPreset: current.agentPreset },
    })
    this.sessions.clear()
  }

  /** Stage the Agent preset used to resolve draft-only capabilities without materializing a Session. */
  selectDraftAgentPreset(agentPreset: string): void {
    if (agentPreset.trim() === '') throw new Error('workspaces.selectDraftAgentPreset: blank preset')
    const current = this.list.getSnapshot().sessionDraft
    if (current === undefined || current.agentPreset === agentPreset) return
    this.setSessionDraft({ ...current, catalogRevision: ++this.draftCatalogRevision, agentPreset })
  }

  /** Begin a fresh browser-only draft explicitly targeting the Host cwd. */
  startUnassignedSession(): void {
    this.beginSessionDraft(undefined)
  }

  /** Register one first-prompt preparation hook. Lower order runs first. */
  prepareSessionDraft(prepare: (sessionId: SessionId) => Promise<void>, order = 0): () => void {
    this.draftPreparers.set(prepare, order)
    return () => { this.draftPreparers.delete(prepare) }
  }

  /**
   * Materialize the currently staged browser draft on its first actual send.
   * The create is coalesced, and no call reaches the Host before this method.
   * @returns the newly created, opened Session id.
   */
  materializeSessionDraft(): Promise<SessionId> {
    const draft = this.list.getSnapshot().sessionDraft
    if (draft === undefined) return Promise.reject(new Error('workspaces.materializeSessionDraft: no staged draft'))
    if (this.materializingDraft?.revision === draft.revision) return this.materializingDraft.pending
    const pending = this.sessions.create(
      draft.workspaceId === undefined ? undefined : { workspaceId: draft.workspaceId },
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
      if (this.materializingDraft?.revision === draft.revision) this.materializingDraft = undefined
    })
    this.materializingDraft = { revision: draft.revision, pending }
    return pending
  }

  /**
   * Follow the first complete Workspace/Session baseline and select a default
   * session exactly once. A restored current session wins; otherwise the most
   * recent Workspace is staged as a browser-only draft. No Session is
   * created during startup selection.
   * Later explicit clears stay cleared instead of retriggering this startup
   * policy. A failed connect may retry on the next baseline projection.
   * @returns disposer for the baseline subscription; late work cannot navigate after disposal.
   */
  startInitialSelection(): () => void {
    if (this.initialSelectionStarted) {
      throw new Error('workspaces.startInitialSelection: already started')
    }
    this.initialSelectionStarted = true
    let state: 'waiting' | 'done' = 'waiting'
    let disposed = false
    const reconcile = (): void => {
      if (disposed || state !== 'waiting') return
      const workspace = this.list.getSnapshot()
      if (!workspace.baselinesReady) return
      const current = this.sessions.list.getSnapshot().current
      const target = workspace.recentWorkspaceId
      if (current !== undefined || target === undefined) {
        state = 'done'
        return
      }
      state = 'done'
      this.beginSessionDraft(target)
    }
    const unsubscribe = this.list.subscribe(reconcile)
    reconcile()
    return () => {
      disposed = true
      unsubscribe()
    }
  }

  /**
   * The shared New Session action behind the shell entry points (sidebar
   * button, workspace browser): resolve the target Workspace — explicit wins,
   * then the current Session's Workspace, then the recent-Workspace
   * projection — stage that target; with no
   * Workspace at all, use the Host cwd. This action is browser-only: it clears
   * the current selection and stages a target, but does not allocate a
   * Session id or call `session.create`.
   * @param workspaceId - explicit target Workspace for scoped actions.
   */
  startSession(workspaceId?: WorkspaceId): void {
    const workspace = this.list.getSnapshot()
    const current = this.sessions.list.getSnapshot().current
    const currentWorkspaceId = current === undefined
      ? undefined
      : workspace.items.find(item => item.sessionIds.includes(current))?.workspaceId
    const target = workspaceId ?? currentWorkspaceId ?? workspace.recentWorkspaceId
    this.beginSessionDraft(target)
  }

  /** Begin a fresh draft, resolving its display cwd without creating a Session. */
  private beginSessionDraft(workspaceId: WorkspaceId | undefined): void {
    const workspace = workspaceId === undefined
      ? undefined
      : this.list.getSnapshot().items.find(item => item.workspaceId === workspaceId)
    if (workspaceId !== undefined && workspace === undefined) {
      throw new Error(`workspaces.startSession: unknown workspace ${workspaceId}`)
    }
    const hostCwd = this.hostDescription?.getSnapshot()?.cwd
    this.setSessionDraft({
      revision: ++this.draftRevision,
      catalogRevision: ++this.draftCatalogRevision,
      ...(workspaceId === undefined ? {} : { workspaceId }),
      ...(workspace?.path !== undefined
        ? { cwd: workspace.path }
        : hostCwd !== undefined
          ? { cwd: hostCwd }
          : {}),
    })
    this.sessions.clear()
  }

  /** Replace only the client draft slice while preserving wire projections. */
  private setSessionDraft(sessionDraft: WorkspaceListState['sessionDraft']): void {
    this.list.update((draft) => {
      if (sessionDraft === undefined) delete draft.sessionDraft
      else draft.sessionDraft = sessionDraft
    })
  }

  /**
   * Register an existing path as a Workspace.
   * @param input - the Host create payload.
   * @returns the created or idempotently resolved Workspace.
   */
  async create(input: { path: string }): Promise<WorkspaceView> {
    const result = await this.manager.create(input)
    if (!result.ok) throw new WorkspaceCreateError(result.error)
    return result.value.workspace
  }

  /**
   * Open the Host's native directory picker (the `native` capability).
   * @returns the selected path, or null when the user cancelled.
   */
  async pickDirectory(): Promise<string | null> {
    const response = await this.api.host.pickDirectory({})
    if (!response.result.ok) {
      throw new Error(`directory picker failed: ${response.result.error.message}`)
    }
    return response.result.value.path
  }

  /**
   * List one directory level through the Host's `browse` capability.
   * @param path - absolute directory to list; absent lists the Host home directory.
   * @param signal - aborts the wire request (and the Host's scan) when the caller supersedes it.
   * @returns the level's listing with breadcrumb ancestry.
   */
  async listDirectory(path?: string, signal?: AbortSignal): Promise<DirectoryListing> {
    const response = await this.api.host.listDirectory(path === undefined ? {} : { path }, signal)
    if (!response.result.ok) throw new DirectoryBrowseError(response.result.error)
    return response.result.value
  }

  /**
   * Create one child directory through the Host's `browse` capability.
   * @param path - absolute existing parent directory.
   * @param name - single non-blank path segment.
   * @returns the created directory's absolute path.
   */
  async createDirectory(path: string, name: string): Promise<string> {
    const response = await this.api.host.createDirectory({ path, name })
    if (!response.result.ok) throw new DirectoryBrowseError(response.result.error)
    return response.result.value.path
  }

  /**
   * Open a filesystem path with the Host operating system's default application.
   * @param path - absolute or host-resolvable path.
   */
  async openPath(path: string): Promise<void> {
    const response = await this.api.host.openPath({ path })
    if (!response.result.ok) {
      throw new Error(`path open failed: ${response.result.error.message}`)
    }
  }

  /**
   * Rename a Workspace.
   * @param workspaceId - target workspace.
   * @param title - new display title (trimmed non-empty by the Host).
   * @returns the renamed Workspace view.
   */
  async rename(workspaceId: WorkspaceId, title: string): Promise<WorkspaceView> {
    const result = await this.manager.rename(workspaceId, title)
    if (!result.ok) throw new Error(`workspace rename failed: ${result.error.code}: ${result.error.message}`)
    return result.value.workspace
  }

  /**
   * Delete one Workspace registration. Sessions, session logs, and the
   * directory remain Host-owned outside this operation.
   * @param workspaceId - target workspace.
   */
  async delete(workspaceId: WorkspaceId): Promise<void> {
    const result = await this.manager.delete(workspaceId)
    if (!result.ok) throw new Error(`workspace delete failed: ${result.error.code}: ${result.error.message}`)
  }

  /**
   * Move a Workspace within the durable registry display order.
   * @param workspaceId - Workspace to move.
   * @param beforeWorkspaceId - Anchor workspace; omitted appends.
   */
  async insertBefore(workspaceId: WorkspaceId, beforeWorkspaceId?: WorkspaceId): Promise<void> {
    const result = await this.manager.insertBefore(workspaceId, beforeWorkspaceId)
    if (!result.ok) throw new Error(`workspace reorder failed: ${result.error.code}: ${result.error.message}`)
  }

  /**
   * Archive a session into the registry-global set. Clearing an archived
   * current selection is the projection sweep's job (one rule for the local
   * echo and a remote tab's frame alike).
   * @param sessionId - session to archive.
   */
  async archiveSession(sessionId: SessionId): Promise<void> {
    const result = await this.manager.archiveSession(sessionId)
    if (!result.ok) throw new Error(`session archive failed: ${result.error.code}: ${result.error.message}`)
  }

  /**
   * Move a session within its Workspace's manual order (DOM-insertBefore-like).
   * @param workspaceId - owning workspace.
   * @param sessionId - accounted session to move.
   * @param beforeSessionId - accounted anchor to insert before; omitted appends.
   * @returns the updated Workspace view.
   */
  async insertSessionBefore(
    workspaceId: WorkspaceId,
    sessionId: SessionId,
    beforeSessionId?: SessionId,
  ): Promise<WorkspaceView> {
    const result = await this.manager.insertSessionBefore(workspaceId, sessionId, beforeSessionId)
    if (!result.ok) throw new Error(`workspace move failed: ${result.error.code}: ${result.error.message}`)
    return result.value.workspace
  }

  /**
   * Refresh the workspace baseline, reusing an in-flight pull.
   * @returns completion of the current or newly started workspace baseline pull.
   */
  refresh(): Promise<void> {
    return this.manager.refresh()
  }

  /**
   * Route a Host stream envelope into the Workspace object layer.
   * @param envelope - validated Host stream envelope.
   */
  handleHostEnvelope(envelope: Parameters<WorkspaceManager['handleHostEnvelope']>[0]): void {
    this.manager.handleHostEnvelope(envelope)
  }

  /** Rebuild the Workspace baseline after connection. */
  handleConnected(): void {
    this.manager.handleConnected()
  }

  private project(): void {
    const workspace = this.manager.getSnapshot()
    const sessions = this.sessions.list.getSnapshot()
    const baselinesReady = workspace.phase === 'ready' && sessions.phase === 'ready'
    // An archived current selection clears into the New Session view state —
    // a hidden row must not stay open behind the list. Sweeping here covers
    // every install path with one rule: the local unary echo, another tab's
    // changed frame, and a reconnect baseline restoring a persisted
    // selection that was archived while this client was away.
    if (sessions.current !== undefined && workspace.archivedSessionIds.includes(sessions.current)) {
      this.sessions.clear()
    }
    this.list.set({
      items: workspace.items,
      archivedSessionIds: workspace.archivedSessionIds,
      state: workspace.state,
      phase: workspace.phase,
      error: workspace.error,
      baselinesReady,
      recentWorkspaceId: baselinesReady ? recentWorkspace(workspace.items, sessions.byId) : undefined,
      ...(this.list.getSnapshot().sessionDraft === undefined
        ? {}
        : { sessionDraft: this.list.getSnapshot().sessionDraft }),
    })
  }
}

/** Stable tie-breaking follows Host Workspace order. */
function recentWorkspace(
  workspaces: readonly WorkspaceView[],
  sessions: SessionsPortList['byId'],
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
