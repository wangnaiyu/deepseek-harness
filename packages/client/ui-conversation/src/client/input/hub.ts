/**
 * InputHub: the SessionInputResolver implementation (`ctx.conversation.input`) — one
 * SessionInputShell per session, created inside the uiSession provide
 * materialization (the 'input' standard-kit entry IS the
 * creation trigger) and torn down by the scope disposer (instance-and-scope
 * share one lifecycle). The hub registers the scoped input-mutation
 * listeners on each Session context and owns the default-sink choreography: every session is a
 * real host entity, while the one root draft shell materializes a Session only
 * when its first prompt is actually sent.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {
  ISessions, SessionBinding, SessionFace,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type { InboxState } from '@deepseek-ai/dsh-agent/types'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type {
  DraftAttachmentId, DraftAttachmentSerializationResult, InputTriggerController, InputTriggerDraftTarget,
  SessionInputResolver, SessionInput, SubmitOutcome,
} from '../contract/input.ts'
import type { ComposerKeyboard } from '../contract/draft-editor.ts'
import type { InputSubmitMode } from '../contract/composer-submission.ts'
import type { PopupDismissFace, SessionInputDeps } from './facade.ts'
import { SessionInputShell } from './facade.ts'
import { SubmissionBindings } from '../submission-bindings.ts'
import type { DraftContent, GuardedDrafts } from '../contract/guarded-drafts.ts'

/** Structural command face for per-session popup resolution. */
interface CommandFace {
  popupFor(actx: Context): PopupDismissFace
}

/** Optional input-trigger service resolved without importing its implementation. */
interface InputTriggerServiceFace {
  /** @param actx - Session scope. @returns that Session's trigger provider. */
  sessionOf(actx: Context): InputTriggerController
  /** @returns the browser-draft trigger provider after it has been bound. */
  draft(): InputTriggerController | undefined
}

/** Attachment-send face resolved lazily to keep hub/service construction acyclic. */
interface ConversationAttachmentFace {
  sendSession(
    session: SessionFace,
    text: string,
    attachmentIds: readonly DraftAttachmentId[],
    mode: InputSubmitMode,
    signal?: AbortSignal,
    content?: DraftContent,
  ): Promise<SubmitOutcome>
  serializeDraftAttachments(attachmentIds: readonly DraftAttachmentId[]): Promise<DraftAttachmentSerializationResult>
  prepareDraftFiles(sessionId: SessionId, ids: readonly DraftAttachmentId[]): Promise<void>
  releaseDraftAttachment(id: DraftAttachmentId): void
}

/** Draft materialization face resolved structurally to avoid a UI package cycle. */
interface WorkspaceMaterializationFace {
  materializeSessionDraft(): Promise<SessionId>
}

/** Session-addressed input facade registry (SessionInputResolver face + composer-layer extras). */
export class InputHub implements SessionInputResolver {
  private readonly shells = new WeakMap<SessionBinding, SessionInputShell>()
  /** Failed browser-draft admission retained on the materialized Session until a retry passes. */
  private readonly pendingDraftAdmissions = new Map<SessionId, {
    readonly controller: InputTriggerController
    readonly target: InputTriggerDraftTarget
  }>()
  private browserDraft: SessionInputShell | undefined
  /** Submission checks and persisted browser interaction state. */
  readonly submissionBindings = new SubmissionBindings(key => this.t(key))
  private startingGuarded = false
  private materializingGuarded = false
  /** Owner registration and protected draft navigation. */
  readonly guardedDrafts: GuardedDrafts = {
    binding: sessionId => this.submissionBindings.read(sessionId ?? 'browser')?.binding,
    register: (owner, check) => this.submissionBindings.register(owner, check),
    assertCanStart: () => {
      if (this.startingGuarded) return
      const saved = this.submissionBindings.read('browser')
      if (this.materializingGuarded || saved !== undefined && (this.draftShell().snapshot.draft.trim() !== '' || this.draftShell().snapshot.attachmentIds.length > 0)) {
        const message = this.t('analysis.unsentSession')
        this.draftShell().notify('error', message)
        throw new Error(message)
      }
      this.submissionBindings.clearBrowser()
    },
    stage: (binding, text, begin) => {
      const current = Object.values(this.sessions().list.getSnapshot().byId)
        .find(session => (session.retainedBy.mainView ?? 0) > 0)?.id
      const existing = current === undefined ? this.draftShell() : this.shell(current)
      if (this.materializingGuarded || existing.snapshot.draft.trim() !== '' || existing.snapshot.attachmentIds.length > 0
        || this.draftShell().snapshot.draft.trim() !== '' || this.draftShell().snapshot.attachmentIds.length > 0) {
        throw new Error(this.t('analysis.unsent'))
      }
      this.startingGuarded = true
      try {
        begin()
        this.submissionBindings.stage(binding, text)
        this.draftShell().setContent(typeof text === 'string' ? { text, references: [] } : text)
      } finally { this.startingGuarded = false }
    },
    restore: (begin) => {
      const saved = this.submissionBindings.read('browser')
      if (saved === undefined) return
      this.startingGuarded = true
      try { begin(); this.draftShell().setContent({ text: saved.text, references: saved.references ?? [] }) }
      finally { this.startingGuarded = false }
    },
  }

  /** Shared command-image plumbing for draft and Session shells. */
  private commandAttachments(): SessionInputDeps['commandAttachments'] {
    return {
      serialize: async ids => (await this.conversation().serializeDraftAttachments(ids)).attachments,
      // Release may settle after Session teardown; missing Conversation then
      // leaves preview URLs to the document lifetime.
      release: (ids) => {
        const conversation = this.rootCtx.get('conversation') as ConversationAttachmentFace | undefined
        for (const imageId of ids) conversation?.releaseDraftAttachment(imageId)
      },
      unsupportedNotice: token => this.t('command.attachmentsUnsupported', {
        command: token.trim().replace(/^\//u, ''),
      }),
    }
  }

  /**
   * @param ctx - client root context (services resolved lazily per call — boot order stays free).
   * @param t - conversation-namespace translate thunk (reads the active locale at call time).
   */
  constructor(
    private readonly rootCtx: Context,
    private readonly t: TranslateNS<'conversation'>,
  ) {}

  /**
   * Resolve the facade for one session-scope ctx (SessionInputResolver face).
   * @param actx - session-scope context.
   * @returns the resident per-session facade.
   */
  for(actx: Context): SessionInput {
    const sessions = this.sessions()
    const session = sessions.sessionOf(actx)
    const binding = session === undefined ? undefined : sessions.binding(session.sessionId)
    if (binding === undefined || binding.session !== session) {
      throw new Error('conversation.input.for requires a retained Session scope')
    }
    return this.shellFor(binding)
  }

  /**
   * Resident Session-id-free input machine used by the New Session screen.
   * @returns the reusable browser-draft shell.
   */
  draftShell(): SessionInputShell {
    if (this.browserDraft !== undefined) return this.browserDraft
    this.browserDraft = new SessionInputShell({
      actx: this.rootCtx,
      inputTriggers: () => (this.rootCtx.get('inputTriggers') as InputTriggerServiceFace | undefined)?.draft(),
      defaultSink: (text, imageIds, mode, signal, content) => this.sinkDraft(text, imageIds, mode, signal, content),
      commandAttachments: this.commandAttachments(),
    })
    const draft = this.browserDraft
    this.rootCtx.effect(() => draft.state.subscribe(() => {
      if (!this.startingGuarded) this.submissionBindings.edit(draft.snapshot.draft, draft.snapshot.occurrences)
    }), 'conversation: persist guarded browser draft')
    return this.browserDraft
  }

  /** Drop the previous unsent browser draft when the user explicitly starts another. */
  resetDraft(): void {
    if (this.browserDraft === undefined) return
    const ids = this.browserDraft.resetDraft()
    const conversation = this.rootCtx.get('conversation') as ConversationAttachmentFace | undefined
    for (const id of ids) conversation?.releaseDraftAttachment(id)
  }

  /**
   * Resident shell for one session binding — the provide-channel entry
   * (called during scope materialization, BEFORE the scope record is
   * queryable, hence binding-fed and hence the thunked slash/popup deps).
   * Wires the scoped event listeners + teardown into the session scope.
   * @param binding - session assembly handle.
   * @returns the shell.
   */
  shellFor(binding: SessionBinding): SessionInputShell {
    const existing = this.shells.get(binding)
    if (existing !== undefined) return existing
    const { session, ctx: actx } = binding
    const shell = new SessionInputShell({
      actx,
      inputTriggers: () => this.controller(actx),
      popup: () => this.popup(actx),
      inbox: session.projections.faceOf('inbox') as ObservableSnapshot<InboxState | undefined>,
      defaultSink: (text, attachmentIds, mode, signal, content) => this.sink(session, text, attachmentIds, mode, signal, content),
      steerQueue: () => { void this.steerQueue(session, shell) },
      commandAttachments: this.commandAttachments(),
    })
    this.shells.set(binding, shell)
    // The one teardown axis: listeners, shell, and map entries all ride the
    // scope fiber (nothing here outlives the scope).
    actx.effect(() => {
      const offs = [
        actx.on('slash/input-begin-command', req =>
          shell.beginCommand(req.claim, req.span) ? true : undefined),
        actx.on('slash/input-insert-reference', req =>
          shell.insertReference(req.reference, req.span) ? true : undefined),
        actx.on('slash/input-consume-token', req =>
          shell.consumeToken(req.guard) ? true : undefined),
        actx.on('slash/input-insert-text', req =>
          shell.insertText(req.text, req.span, req.continue === true) ? true : undefined),
      ]
      return () => {
        for (const off of offs) off()
        const drafts = shell.dispose()
        this.shells.delete(binding)
        this.pendingDraftAdmissions.delete(binding.sessionId)
        const conversation = this.rootCtx.get('conversation') as ConversationAttachmentFace | undefined
        for (const attachmentId of drafts) conversation?.releaseDraftAttachment(attachmentId)
      }
    }, 'conversation.input: session shell')
    return shell
  }

  /**
   * Resident shell by session id (service-face path; the provide channel has
   * normally created it already — this covers direct id-addressed access).
   * @param id - session id.
   * @returns the shell.
   */
  shell(id: SessionId): SessionInputShell {
    const binding = this.sessions().binding(id)
    if (binding === undefined) throw new Error(`conversation.input: session "${id}" resolved no binding`)
    return this.shellFor(binding)
  }

  /**
   * The InputBar-exclusive keyboard command face: the shell
   * satisfies it structurally; package-internal — handed through the
   * composer-bar entry's inject, never across a plugin boundary.
   * @param id - session id.
   * @returns the shell as the keyboard face.
   */
  keyboard(id: SessionId): ComposerKeyboard {
    return this.shell(id)
  }

  /**
   * Query file intake without creating a Session input.
   * @param id - target Session.
   * @returns whether its mounted composer currently accepts files.
   */
  canPickFiles(id: SessionId): boolean {
    const binding = this.sessions().binding(id)
    return binding !== undefined && this.shells.get(binding)?.canPickFiles() === true
  }

  /**
   * Open the target composer's file dialog under its live intake policy.
   * @param id - target Session.
   */
  pickFiles(id: SessionId): void {
    const binding = this.sessions().binding(id)
    if (binding !== undefined) this.shells.get(binding)?.pickFiles()
  }

  /**
   * Resolve the optional slash controller for composer chrome that launches
   * the shared candidate menu without typing a trigger.
   * @param id - session id.
   * @returns the resident controller, or undefined when no trigger provider is installed.
   */
  inputTriggers(id: SessionId): InputTriggerController | undefined {
    const binding = this.sessions().binding(id)
    return binding === undefined ? undefined : this.controller(binding.ctx)
  }

  /**
   * Resolve the browser-only draft controller for shared `/` and `+` discovery.
   * @returns the resident draft controller, or undefined before the optional trigger plugin binds it.
   */
  draftInputTriggers(): InputTriggerController | undefined {
    return (this.rootCtx.get('inputTriggers') as InputTriggerServiceFace | undefined)?.draft()
  }

  /**
   * Default sink: optimistic clear + prompt. The session is always a real
   * host entity (materialized when its workspace was picked), so there is
   * exactly one path. The sole exception is a browser draft whose formal
   * admission failed after materialization: its captured admission identity
   * remains attached to this Session and must pass before a retry can send.
   */
  private sink(
    session: SessionFace,
    text: string,
    attachmentIds: readonly DraftAttachmentId[],
    mode: InputSubmitMode,
    signal: AbortSignal,
    content?: DraftContent,
  ): Promise<SubmitOutcome> {
    if (text === '' && attachmentIds.length === 0) return Promise.resolve({ kind: 'success' })
    return this.sendAdmitted(session, text, attachmentIds, mode, signal, content)
  }

  /** Re-run a retained first-send admission before allowing the materialized Session to send. */
  private async sendAdmitted(
    session: SessionFace,
    text: string,
    attachmentIds: readonly DraftAttachmentId[],
    mode: InputSubmitMode,
    signal: AbortSignal,
    content?: DraftContent,
  ): Promise<SubmitOutcome> {
    const pending = this.pendingDraftAdmissions.get(session.sessionId)
    if (pending !== undefined) {
      await pending.controller.admitMaterialized(
        pending.target, { sessionId: session.sessionId }, text, signal,
      )
      this.pendingDraftAdmissions.delete(session.sessionId)
    }
    return this.conversation().sendSession(session, text, attachmentIds, mode, signal, content)
  }

  /**
   * First-send transaction for the browser-only draft. Creation failure
   * leaves that draft untouched. Once creation succeeds, the captured draft
   * moves into the real Session shell and is submitted there. That second
   * adjudication step is intentional: a slash command typed as the first
   * send must resolve against the newly born Session's Agent catalog, while
   * the pre-Session screen still performs no Host lookup or allocation.
   */
  private async sinkDraft(
    text: string,
    imageIds: readonly DraftAttachmentId[],
    mode: InputSubmitMode,
    signal: AbortSignal,
    content?: DraftContent,
  ): Promise<SubmitOutcome> {
    if (text === '' && imageIds.length === 0) return { kind: 'success' }
    const capturedBinding = this.submissionBindings.read('browser')
    this.materializingGuarded = capturedBinding !== undefined
    try {
      return await this.materializeDraft(text, imageIds, mode, signal, capturedBinding, content)
    } finally { this.materializingGuarded = false }
  }

  private async materializeDraft(
    text: string, imageIds: readonly DraftAttachmentId[], mode: InputSubmitMode, signal: AbortSignal,
    capturedBinding: ReturnType<SubmissionBindings['read']>,
    content?: DraftContent,
  ): Promise<SubmitOutcome> {
    if (capturedBinding !== undefined) {
      await this.submissionBindings.check(capturedBinding, { signal, ...content === undefined ? {} : { content } })
    }
    const draftTriggers = this.draftInputTriggers()
    const draftTarget = draftTriggers?.target()
    const sessionId = await this.uiWorkspace().materializeSessionDraft()
    if (capturedBinding !== undefined) {
      this.submissionBindings.bind(sessionId, {
        ...capturedBinding, text: content?.text ?? text, ...content === undefined ? {} : { references: content.references },
      })
    }
    const binding = this.sessions().binding(sessionId)
    if (binding === undefined) throw new Error(`conversation.input: created session "${sessionId}" resolved no binding`)
    const shell = this.shellFor(binding)
    if (content !== undefined) shell.setContent(content)
    else if (text !== '') shell.setDraft(text)
    if (imageIds.length > 0) shell.addAttachments(imageIds)
    signal.throwIfAborted()
    await this.conversation().prepareDraftFiles(sessionId, imageIds)
    if (draftTarget?.kind === 'draft') {
      if (draftTriggers === undefined) {
        throw new Error('conversation.input: captured draft target resolved no trigger controller')
      }
      this.pendingDraftAdmissions.set(sessionId, { controller: draftTriggers, target: draftTarget })
      try {
        await draftTriggers.admitMaterialized(draftTarget, { sessionId }, text, signal)
        this.pendingDraftAdmissions.delete(sessionId)
      } catch (error) {
        // Materialization has already navigated to the real Session. Keep the
        // captured payload in that visible shell and surface the rejection
        // there; the superseded browser shell remains only long enough to
        // settle its submit promise.
        shell.notify('error', error instanceof Error ? error.message : String(error))
        throw error
      }
    }
    shell.submit(mode)
    // The draft now belongs to the real Session. Report success to the old
    // browser machine only so it clears its duplicate state; the real shell
    // owns command/prompt settlement, retry text, and notices from here on.
    return { kind: 'success' }
  }

  /**
   * Submit every still-pending queued message through QueueDock Steer, in FIFO
   * request order — the same operation as the queue dock's per-row button.
   * An Agent stopping before a command (`session/steer-unavailable`) or a row already
   * claimed by the agent (`session/queue-item-not-found`) converges silently, while a
   * genuine failure surfaces as one composer notice. Repeated triggers
   * (e.g. two rapid empty-draft chords) rely on that `session/queue-item-not-found`
   * convergence: the snapshot may still list a row the host already steered,
   * and the duplicate Steer is a silent no-op.
   * @param session - the addressed host session.
   * @param shell - the resident shell (notice outlet).
   */
  private async steerQueue(session: SessionFace, shell: SessionInputShell): Promise<void> {
    const inbox = session.projections.faceOf('inbox').getSnapshot() as InboxState | undefined
    const queued = inbox?.['next-turn'] ?? []
    if (queued.length === 0) return
    for (const item of queued) {
      const result = await session.updateQueue(item.id, { kind: 'steer' })
      if (result.ok) continue
      if (result.error.code === 'session/steer-unavailable' || result.error.code === 'session/queue-item-not-found') return
      shell.notify('error', this.t('queue.steerFailed'))
      return
    }
  }

  private controller(actx: Context): InputTriggerController | undefined {
    if (this.sessions().sessionOf(actx) === undefined) return undefined
    const inputTriggers = this.rootCtx.get('inputTriggers') as InputTriggerServiceFace | undefined
    return inputTriggers?.sessionOf(actx)
  }

  private popup(actx: Context): PopupDismissFace | undefined {
    if (this.sessions().sessionOf(actx) === undefined) return undefined
    const command = this.rootCtx.get('commandUi') as CommandFace | undefined
    return command?.popupFor(actx)
  }

  private sessions(): ISessions {
    const sessions = this.rootCtx.get('sessions')
    if (sessions === undefined) throw new Error('conversation.input: sessions service unavailable')
    return sessions
  }

  private uiWorkspace(): WorkspaceMaterializationFace {
    const uiWorkspace = this.rootCtx.get('uiWorkspace') as WorkspaceMaterializationFace | undefined
    if (uiWorkspace === undefined) throw new Error('conversation.input: uiWorkspace service unavailable')
    return uiWorkspace
  }

  private conversation(): ConversationAttachmentFace {
    const conversation = this.rootCtx.get('conversation') as ConversationAttachmentFace | undefined
    if (conversation === undefined) throw new Error('conversation.input: conversation service unavailable')
    return conversation
  }
}
