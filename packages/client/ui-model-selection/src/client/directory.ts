/**
 * Per-session model directory: the ONE state both selection entries share.
 * The /model popup and the composer-seat selector load through the same
 * controller and submit through the same selectModel call, so the host stays
 * the single fact source and the store is one shared echo — a switch made in
 * either entry is what the other shows next.
 */
import type {
  IApiClient, ModelCatalogFailure, ModelProviderGroup, ModelSelection, SessionId, SessionModels,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** Directory snapshot both entries render from. */
export interface ModelDirectoryState {
  /** Model selection the host reports for the next assembled step; null before the first load. */
  current: ModelSelection | null
  /**
   * Whether an adapter serves the current selection's provider, as the host reports
   * it — null before the first load, which is NOT the same as blocked. Read
   * this rather than "current matches no group": catalog membership is
   * advisory, so a route serving a model it stopped advertising is missing
   * from the groups yet perfectly usable.
   */
  routable: boolean | null
  /** Successfully loaded provider groups (last good load). */
  groups: readonly ModelProviderGroup[]
  /** Provider-local failures from the last load; usable groups stay usable. */
  failures: readonly ModelCatalogFailure[]
  /** Lifecycle of the in-flight operation. */
  status: 'idle' | 'loading' | 'ready' | 'selecting' | 'error'
  /** Whole-request or selection failure text; null when none. */
  error: string | null
}

/** Host-scoped catalog returned for a Session-id-free browser draft. */
export interface DraftModelCatalog {
  groups: readonly ModelProviderGroup[]
  failures: readonly ModelCatalogFailure[]
}

/**
 * Browser-only model directory for New Session drafts. Catalog reads use the
 * Host-scoped `llm.models` method, while selection is staged locally until
 * first-send materialization gives it a real Session id.
 */
export class DraftModelDirectory {
  /** Same render contract as a real directory, with no Host-confirmed route bit. */
  readonly store: SnapshotStore<ModelDirectoryState> = createSnapshotStore<ModelDirectoryState>({
    current: null, routable: null, groups: [], failures: [], status: 'idle', error: null,
  })

  private generation = 0
  private staged: ModelSelection | undefined
  private disposed = false

  constructor(private readonly llm: Pick<IApiClient['llm'], 'models'>) {}

  /**
   * Load the session-independent model catalog without allocating a Session.
   * @returns the fresh Host-scoped catalog.
   */
  async load(): Promise<DraftModelCatalog> {
    const generation = ++this.generation
    this.store.update((state) => { state.status = 'loading'; state.error = null })
    const { result } = await this.llm.models({})
    if (this.disposed || generation !== this.generation) {
      if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
      return result.value
    }
    if (!result.ok) {
      this.store.update((state) => {
        state.status = 'error'
        state.error = `${result.error.code}: ${result.error.message}`
      })
      throw new Error(`llm.models failed: ${result.error.code}: ${result.error.message}`)
    }
    this.store.update((state) => {
      state.current = this.staged ?? null
      state.routable = null
      state.groups = result.value.groups
      state.failures = result.value.failures
      state.status = 'ready'
      state.error = null
    })
    return result.value
  }

  /**
   * Stage a selection in browser memory; no Session RPC is issued here.
   * @param selection - complete provider, model, and optional reasoning effort.
   */
  select(selection: ModelSelection): Promise<void> {
    if (this.disposed) throw new Error('draft model directory is disposed')
    ++this.generation
    this.staged = selection
    this.store.update((state) => {
      state.current = selection
      state.routable = null
      state.status = 'ready'
      state.error = null
    })
    return Promise.resolve()
  }

  /**
   * Selection to apply after first-send creates the real Session.
   * @returns the staged selection, or undefined when the draft uses Host defaults.
   */
  stagedSelection(): ModelSelection | undefined {
    return this.staged
  }

  /** A fresh New Session gesture drops the previous unsent selection. */
  resetDraft(): void {
    if (this.disposed) return
    ++this.generation
    this.staged = undefined
    this.store.update((state) => {
      state.current = null
      state.routable = null
      state.groups = []
      state.failures = []
      state.status = 'idle'
      state.error = null
    })
  }

  /** Connection reset invalidates the Host catalog but preserves no draft fact. */
  resetConnected(): void {
    this.resetDraft()
  }

  /** Permanently stop this root-owned draft directory. */
  dispose(): void {
    this.disposed = true
    ++this.generation
  }
}

/** One session's shared directory controller; disposed with the session scope. */
export class ModelDirectory {
  /** The shared snapshot both entries render from (uSES-safe store). */
  readonly store: SnapshotStore<ModelDirectoryState> = createSnapshotStore<ModelDirectoryState>({
    current: null, routable: null, groups: [], failures: [], status: 'idle', error: null,
  })

  /** Latest operation wins; an older response never overwrites a newer one. */
  private generation = 0
  private disposed = false

  /**
   * @param sessions - the session wire face (captured from the plugin's root connection).
   * @param sessionId - the owning session.
   * @param available - whether this session may use Agent-bound model RPCs.
   */
  constructor(
    private readonly sessions: Pick<IApiClient['sessions'], 'models' | 'selectModel'>,
    private readonly sessionId: SessionId,
    private readonly available: () => boolean,
  ) {}

  /**
   * Refresh the advisory directory (both entries call this on open).
   * Failure preserves the last good groups and current selection.
   * @returns the fresh directory value.
   */
  async load(): Promise<SessionModels> {
    this.assertAvailable()
    const generation = ++this.generation
    this.store.update((s) => { s.status = 'loading'; s.error = null })
    const { result } = await this.sessions.models({ sessionId: this.sessionId })
    if (this.disposed || generation !== this.generation) {
      if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
      return result.value
    }
    if (!result.ok) {
      this.store.update((s) => { s.status = 'error'; s.error = `${result.error.code}: ${result.error.message}` })
      throw new Error(`session.models failed: ${result.error.code}: ${result.error.message}`)
    }
    const { current, routable, groups, failures } = result.value
    this.store.update((s) => {
      s.current = current
      s.routable = routable
      s.groups = groups
      s.failures = failures
      s.status = 'ready'
      s.error = null
    })
    return result.value
  }

  /**
   * Select the complete provider/model/reasoning selection (both entries submit through here). Success
   * updates the shared current; failure surfaces on the store and throws so
   * each entry's own retry surface engages.
   * @param selection - provider, provider-owned model id, and optional adapter-owned effort.
 */
  async select(selection: ModelSelection): Promise<void> {
    this.assertAvailable()
    const generation = ++this.generation
    this.store.update((s) => { s.status = 'selecting'; s.error = null })
    const { result } = await this.sessions.selectModel({
      sessionId: this.sessionId,
      provider: selection.provider,
      model: selection.model,
      ...selection.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: selection.reasoningEffort },
    })
    if (this.disposed || generation !== this.generation) {
      if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
      return
    }
    if (!result.ok) {
      this.store.update((s) => { s.status = 'error'; s.error = `${result.error.code}: ${result.error.message}` })
      throw new Error(`session.selectModel failed: ${result.error.code}: ${result.error.message}`)
    }
    // The Host validated the route before accepting it, so a selection that
    // landed is by construction one it can serve.
    this.store.update((s) => {
      s.current = result.value.selected
      s.routable = true
      s.status = 'ready'
      s.error = null
    })
  }

  /**
   * Drop the previous Host generation's projection and repull it. Clearing
   * first prevents an unconsumed process-local selection from being displayed
   * while the restarted Host has restored the last logged model selection.
   */
  resetConnected(): void {
    if (this.disposed) return
    ++this.generation
    this.store.update((s) => {
      s.current = null
      s.routable = null
      s.groups = []
      s.failures = []
      s.status = 'idle'
      s.error = null
    })
    if (!this.available()) return
    void this.load().catch(() => { /* the next menu open remains the explicit retry surface */ })
  }

  /** Scope teardown: late settlements lose write access to the store. */
  dispose(): void {
    this.disposed = true
  }

  private assertAvailable(): void {
    if (!this.available()) {
      throw new Error('model selection is unavailable for addressed subagent sessions')
    }
  }
}
