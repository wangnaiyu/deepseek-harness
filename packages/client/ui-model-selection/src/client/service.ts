/**
 * ModelDirectoryResolver (`ctx.modelDirectories`): the root owner of per-session
 * {@link ModelDirectory} instances. Both selection entries (the /model popup
 * and the composer model seat) resolve their session's directory through
 * this service, which is what makes the dual entry one shared state.
 *
 * Per-session storage follows the client service pattern (InputTriggerService /
 * CommandUiRuntime): a lazy service-internal map whose entry is deleted by the
 * owning scope's disposer. The host `dsh-scope` ScopedLayers registry does
 * does not belong here: it derives scope from the host carrier mechanism
 * (object-keyed), while client scopes tag contexts with branded SessionId
 * strings, and it models global+shadow named registries — this is a
 * per-session singleton with no global layer to merge.
 */
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle, SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { IWorkspaces, SessionRuntime } from '@deepseek-ai/dsh-client-runtime/client'
import { DraftModelDirectory, ModelDirectory } from './directory.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    modelDirectories: ModelDirectoryResolver
  }
}

/** Live mutable state in one holder (service methods run behind the caller-ctx tracker). */
interface LiveState {
  /** Per-session directories; entries are deleted by their scope disposer. */
  readonly directories: Map<SessionId, ModelDirectory>
}

/** The `ctx.modelDirectories` session model-selection service. */
export class ModelDirectoryResolver extends Service {
  static inject = ['connection', 'sessions', 'workspaces', 'remote']

  private readonly live: LiveState = { directories: new Map() }
  private draftDirectory: DraftModelDirectory | undefined

  /** Localized composer-block copy; this plugin owns the string it raises. */
  private readonly blockReason: () => string

  /**
   * @param ctx - owning root context (the service registers itself as `models`).
   * @param config - the bound translator for this plugin's own dictionary.
   */
  constructor(ctx: Context, config: { blockReason: () => string }) {
    super(ctx, 'modelDirectories')
    this.blockReason = config.blockReason
    ctx.on('connection/reset', () => {
      for (const directory of this.live.directories.values()) directory.resetConnected()
      this.draftDirectory?.resetConnected()
    })
    // Either source can change the directory: registry topology commits and
    // settings documents that carry provider catalogs or default selection.
    const refresh = (): void => {
      for (const directory of this.live.directories.values()) {
        directory.load().catch(() => undefined)
      }
      this.draftDirectory?.load().catch(() => undefined)
    }
    ctx.remote.$on('llm/adapters-updated', refresh)
    ctx.remote.$on('settings/document-updated', refresh)

    const workspaces = ctx.get('workspaces') as IWorkspaces
    let draftRevision = workspaces.list.getSnapshot().sessionDraft?.revision
    ctx.effect(() => workspaces.list.subscribe(() => {
      const next = workspaces.list.getSnapshot().sessionDraft?.revision
      if (next !== undefined && next !== draftRevision) this.draftDirectory?.resetDraft()
      draftRevision = next
    }), 'ui-model-selection: browser draft generation')
    ctx.effect(() => workspaces.prepareSessionDraft(async (sessionId) => {
      const selection = this.draftDirectory?.stagedSelection()
      if (selection === undefined) return
      await this.directoryFor(sessionId).select(selection)
    }, 100), 'ui-model-selection: apply staged draft model')
  }

  /**
   * Resolve the one browser-only draft directory (no Session id, no Session RPC).
   * @returns the root-owned draft directory.
   */
  directoryForDraft(): DraftModelDirectory {
    if (this.draftDirectory !== undefined) return this.draftDirectory
    const connection = this.ctx.get('connection') as ConnectionHandle
    this.draftDirectory = new DraftModelDirectory(connection.api.llm)
    this.ctx.effect(() => () => {
      this.draftDirectory?.dispose()
      this.draftDirectory = undefined
    }, 'ui-model-selection: draft directory')
    return this.draftDirectory
  }

  /**
   * Resolve the per-session shared directory (lazy; the scope disposer
   * removes and disposes it). Unknown sessions fail loud.
   * @param sessionId - the owning session.
   * @returns the resident directory both entries share.
   */
  directoryFor(sessionId: SessionId): ModelDirectory {
    const { live } = this
    const existing = live.directories.get(sessionId)
    if (existing !== undefined) return existing
    const sessions = this.ctx.get('sessions') as SessionRuntime
    const actx = sessions.scope(sessionId)
    if (actx === undefined) throw new Error(`ui-model-selection: session "${String(sessionId)}" resolved no scope`)
    const connection = this.ctx.get('connection') as ConnectionHandle
    const directory = new ModelDirectory(
      connection.api.sessions,
      sessionId,
      () => sessions.subagentAddress(sessionId) === undefined,
    )
    live.directories.set(sessionId, directory)
    // The composer cannot read this plugin (the dependency runs one way), so
    // the block is pushed: the Host says whether an adapter serves the
    // session's route, and only a definite `false` makes the input inert.
    // `null` — before the first load, or after one failed — must not, or a
    // slow or unreachable Host would lock a working composer.
    const conversation = this.ctx.get('conversation')
    if (conversation !== undefined) {
      const publish = (): void => {
        conversation.blocks.set(sessionId, directory.store.getSnapshot().routable === false
          ? { reason: this.blockReason() }
          : undefined)
      }
      publish()
      actx.effect(() => {
        const stop = directory.store.subscribe(publish)
        return () => {
          stop()
          conversation.blocks.set(sessionId, undefined)
        }
      }, 'ui-model-selection: composer block')
    }
    actx.effect(() => () => {
      directory.dispose()
      live.directories.delete(sessionId)
    }, 'ui-model-selection: session directory')
    return directory
  }
}
