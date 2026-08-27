/**
 * InputTriggerController: one Session-or-draft half of the trigger pipeline. Owns every
 * piece of mutable interaction state — the authoritative trigger hit (span
 * included; it outlives menu close for space adjudication), the menu store,
 * and the candidate-fetch lifecycle — and executes pick outcomes by
 * dispatching the scoped input-mutation events. The root InputTriggerService keeps
 * only the source roster. Session controllers follow their scope fiber; the
 * browser-draft binding explicitly owns and replaces its controller.
 */
import type { ClientContext, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { detectTrigger } from '../core/detect.ts'
import { MENU_CLOSED, menuReduce, seedGroups } from '../core/menu.ts'
import type { MenuEvent, MenuState, TriggerHit } from '../core/contract.ts'
import type {
  ArbitrateKey, ArbitrateOutcome, ClientDraftContext, ClientSessionContext, InputTriggerTarget, PickOutcome, InputTriggerSource,
  SubmitEnvelope, TriggerChar, TriggerGuard,
} from '../types.ts'

/** Roster access the controller borrows from the root service (registration order preserved). */
export interface SourceRoster {
  sources(trigger: string): readonly InputTriggerSource[]
  all(): readonly InputTriggerSource[]
}

/** Construction hooks for one controller. */
export interface InputTriggerControllerDeps {
  /** The owning session scope (event dispatch + teardown registration site). */
  actx: ClientContext
  /** The session's stable host identity (the projection handed to sources). */
  target?: () => InputTriggerTarget
  /** @deprecated Construction compatibility for session-only controller tests. */
  sessionId?: import('@deepseek-ai/dsh-client-runtime/client').SessionId
  /** Root-service roster view. */
  roster: SourceRoster
  /** Apply a pick to the owning input. Session controllers use scoped events; drafts inject a direct CAS sink. */
  apply?: (outcome: PickOutcome, span: import('../types.ts').TokenSpan) => boolean
}

/**
 * Per-session trigger pipeline state and orchestration. All mutation stays
 * inside; MenuView renders from {@link InputTriggerController.menu} and routes
 * pointer picks back through {@link InputTriggerController.pick}.
 */
export class InputTriggerController {
  /** Menu state store (per-session; survives session switches, dies with the scope). */
  readonly menu: SnapshotStore<MenuState> = createSnapshotStore<MenuState>(MENU_CLOSED)
  /**
   * Name of the source opened through the programmatic launcher, or null for
   * trigger-detected/closed menus. Composer chrome subscribes to this store
   * for the launcher's expanded state without owning a second menu model.
   */
  readonly launcher: SnapshotStore<string | null> = createSnapshotStore<string | null>(null)
  /**
   * Aggregated hot reference lexicon, grouped by trigger (plain-text-reference decision;
   * see .agents/notes/implemented/architecture/2026-07-25-web-input-machine-and-slash-pipeline.md):
   * sources implementing the lexicon hook are polled with the session
   * projection; undefined answers (roll not hot yet) are skipped; multiple
   * sources on one trigger concatenate in registration order. A snapshot
   * store because rolls change asynchronously (catalog settles, children
   * spawn/exit) — render-side consumers subscribe instead of re-reading a
   * mutable answer.
   */
  readonly lexicon: SnapshotStore<ReadonlyMap<TriggerChar, readonly string[]>> =
    createSnapshotStore<ReadonlyMap<TriggerChar, readonly string[]>>(new Map())

  /** The authoritative hit: single truth for span CAS material (menu snapshot never carries it alone). */
  private hit: TriggerHit | null = null
  private readonly fetches = new Map<string, AbortController>()
  private disposed = false
  /** Per-source lexicon unsubscribers (sources without the hook never enter). */
  private readonly lexiconOffs = new Map<InputTriggerSource, () => void>()

  constructor(private readonly deps: InputTriggerControllerDeps) {
    // Scope-birth prewarm: sessions are always agent-backed, so the one-time
    // roster warm here replaces the projection-transition watch — there are
    // no capability steps to react to.
    const projection = this.project()
    for (const src of this.sources()) {
      src.warm?.(projection)
      this.watchLexicon(src, projection)
    }
    this.refreshLexicon()
  }

  /**
   * Feed a draft/caret change through trigger detection and drive the menu.
   * @param draft - full draft text.
   * @param caret - caret offset into `draft`.
   * @param guard - availability tier derived from the input phase.
   * @param draftRev - the input machine's current draft revision, stamped
   * into the hit span for pick-time CAS.
   */
  track(draft: string, caret: number, guard: TriggerGuard, draftRev: number): void {
    if (this.disposed) return
    const launched = this.launcher.getSnapshot() !== null
    this.clearLauncher()
    const raw = detectTrigger(draft, caret, guard)
    if (raw === null) {
      this.hit = null
      this.stopFetch()
      this.reduce({ type: 'close' })
      return
    }
    const hit: TriggerHit = { ...raw, span: { ...raw.span, draftRev } }
    const prev = this.menu.getSnapshot()
    const same = !launched && prev.open && prev.hit !== null
      && prev.hit.trigger === hit.trigger && prev.hit.query === hit.query
      && prev.hit.quoted === hit.quoted
      && prev.hit.span.start === hit.span.start && prev.hit.span.end === hit.span.end
    this.hit = hit
    if (same) return
    const roster = this.sources(hit.trigger)
    if (roster.length === 0) {
      this.stopFetch()
      this.reduce({ type: 'close' })
      return
    }
    if (launched || !prev.open || prev.hit === null || prev.hit.trigger !== hit.trigger) {
      this.menu.set(seedGroups(this.menu.getSnapshot(), roster))
    }
    this.reduce({ type: 'hit', hit })
    this.fetchCandidates(hit, roster)
  }

  /**
   * Toggle a menu containing exactly one registered source. The supplied hit
   * is a synthetic selection span rather than a typed trigger token, but
   * picks deliberately reuse the ordinary source callback and scoped input
   * mutation pipeline.
   * @param source - registered source name under `hit.trigger`.
   * @param hit - synthetic hit carrying position and pick-time draft CAS.
   */
  toggleSource(source: string, hit: TriggerHit): void {
    if (this.disposed) return
    if (this.launcher.getSnapshot() === source && this.menu.getSnapshot().open) {
      this.dismiss()
      return
    }
    const match = this.sources(hit.trigger).find(item => item.name === source)
    if (match === undefined) {
      this.dismiss()
      return
    }
    this.stopFetch()
    this.hit = hit
    this.launcher.set(source)
    this.menu.set(seedGroups(this.menu.getSnapshot(), [match]))
    this.reduce({ type: 'hit', hit })
    this.fetchCandidates(hit, [match])
  }

  /**
   * Toggle every eligible source for one synthetic trigger hit (the shared `+` launcher).
   * @param hit - synthetic trigger and current selection span.
   */
  toggleTrigger(hit: TriggerHit): void {
    if (this.disposed) return
    if (this.launcher.getSnapshot() === hit.trigger && this.menu.getSnapshot().open) {
      this.dismiss()
      return
    }
    const roster = this.sources(hit.trigger)
    if (roster.length === 0) {
      this.dismiss()
      return
    }
    this.stopFetch()
    this.hit = hit
    this.launcher.set(hit.trigger)
    this.menu.set(seedGroups(this.menu.getSnapshot(), roster))
    this.reduce({ type: 'hit', hit })
    this.fetchCandidates(hit, roster)
  }

  /**
   * Retry one failed source against the current hit without disturbing successful groups.
   * @param source - registered source name to invalidate and fetch again.
   */
  retry(source: string): void {
    const state = this.menu.getSnapshot()
    const hit = this.hit
    if (this.disposed || !state.open || hit === null) return
    const match = this.sources(hit.trigger).find(item => item.name === source)
    if (match === undefined) return
    match.retry?.(this.project())
    this.reduce({ type: 'source-retry', generation: state.generation, source })
    this.fetchCandidates(hit, [match], false)
  }

  /**
   * Pointer pick from MenuView: route the clicked candidate through onPick
   * and execute claim/insert outcomes via the scoped input events.
   * @param source - source (group) name.
   * @param index - candidate index within the group.
   */
  pick(source: string, index: number): void {
    const state = this.menu.getSnapshot()
    const hit = this.hit
    if (this.disposed || !state.open || hit === null) return
    const group = state.groups.find(g => g.source === source)
    const candidate = group !== undefined && group.status === 'ready' ? group.items[index] : undefined
    if (candidate === undefined) return
    const src = this.sources(hit.trigger).find(s => s.name === source)
    if (src === undefined) return
    const outcome = src.onPick({
      candidate,
      session: this.project(),
      position: hit.position,
      via: 'menu',
      span: hit.span,
    })
    this.stopFetch()
    this.reduce({ type: 'close' })
    this.execute(outcome, hit.span)
  }

  /**
   * Keyboard arbitration while the menu is open.
   * @param key - intercepted key.
   * @param composing - inside IME composition: everything passes.
   * @returns consumed / pick-highlighted / pass.
   */
  arbitrate(key: ArbitrateKey, composing: boolean): ArbitrateOutcome {
    if (composing || this.disposed) return 'pass'
    const state = this.menu.getSnapshot()
    if (!state.open) return 'pass'
    switch (key) {
      case 'up': {
        this.reduce({ type: 'move', dir: -1 })
        return 'consumed'
      }
      case 'down': {
        this.reduce({ type: 'move', dir: 1 })
        return 'consumed'
      }
      case 'escape': {
        this.stopFetch()
        this.reduce({ type: 'close' })
        return 'consumed'
      }
      case 'enter': {
        if (state.highlight === null) return 'pass'
        this.pick(state.highlight.source, state.highlight.index)
        return 'pick-highlighted'
      }
    }
  }

  /**
   * Space adjudication over the just-completed leading token: polls sources'
   * matchSpace (hot state, synchronous) and dispatches the outcome itself.
   * @returns true when a claim/insert was actually applied by the input —
   * the caller preventDefaults exactly then.
   */
  onSpace(): boolean {
    const hit = this.hit
    if (this.disposed || hit === null || hit.position !== 'leading') return false
    const token = hit.trigger + hit.query
    const projection = this.project()
    for (const src of this.sources(hit.trigger)) {
      if (src.matchSpace === undefined) continue
      const outcome = src.matchSpace(projection, token)
      if (outcome === undefined) continue
      if (outcome === 'handled') return true
      return this.execute(outcome, hit.span)
    }
    return false
  }

  /**
   * Serialize one reference occurrence to its model form via the owning
   * source's codec (prompt serialization: registry → explicit
   * call → await). Owner missing or codec-less rejects — the submit attempt
   * blocks instead of silently downgrading to the clipboard text.
   * @param source - owning source name.
   * @param ref - owner-scoped reference id.
   * @param signal - the submit attempt's abort signal.
   * @returns the model representation (e.g. `<skill>name</skill>`).
   */
  serializeReference(source: string, ref: string, signal: AbortSignal): Promise<string> {
    const owner = this.deps.roster.all().find(s => s.name === source)
    if (owner?.codec === undefined) {
      return Promise.reject(new Error(`slash: no serializer for reference source "${source}"`))
    }
    return owner.codec.serialize(ref, signal)
  }

  /**
   * Enter last adjudication: polls sources' matchEnter in registration
   * order, first non-undefined wins. The outcome returns to the caller (the
   * input machine applies it inside the same submit attempt — no event).
   * @param line - trimmed draft; the leading char selects the trigger roster.
   * @param signal - attempt-scoped abort from the input machine.
   * @param envelope - non-text submission state accompanying the draft.
   * @returns the winning outcome or undefined (default sink). Rejects when a
   * polled source's warmup fails or the winning source refuses the envelope —
   * the caller must not silently downgrade.
   */
  async adjudicate(line: string, signal: AbortSignal, envelope: SubmitEnvelope): Promise<PickOutcome> {
    const projection = this.project()
    for (const src of this.sources()) {
      if (signal.aborted) {
        throw signal.reason instanceof Error ? signal.reason : new Error('slash adjudication aborted')
      }
      if (src.matchEnter === undefined || !line.startsWith(src.trigger)) continue
      const outcome = await src.matchEnter(projection, line, signal, envelope)
      if (outcome !== undefined) return outcome
    }
    return undefined
  }

  /**
   * Capture the controller's current target before async materialization changes it.
   * @returns the target projection current at the call boundary.
   */
  target(): InputTriggerTarget {
    return this.project()
  }

  /**
   * Run every source's draft-to-Session admission check in source order.
   * @param draft - captured browser-draft target.
   * @param session - newly materialized formal Session target.
   * @param line - captured first-send text.
   * @param signal - cancellation for the first-send attempt.
   */
  async admitMaterialized(
    draft: ClientDraftContext,
    session: ClientSessionContext,
    line: string,
    signal: AbortSignal,
  ): Promise<void> {
    for (const source of this.deps.roster.all()) {
      if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('draft admission aborted')
      await source.admitMaterialized?.(draft, session, line, signal)
    }
  }

  /**
   * Drop the menu group of a disposed source (root registry change notification).
   * @param source - the source whose registration was disposed.
   */
  sourceRemoved(source: InputTriggerSource): void {
    const state = this.menu.getSnapshot()
    if (state.open && state.hit !== null && state.hit.trigger === source.trigger) {
      this.reduce({ type: 'source-removed', generation: state.generation, source: source.name })
    }
    this.lexiconOffs.get(source)?.()
    this.lexiconOffs.delete(source)
    this.refreshLexicon()
  }

  /**
   * Admit a source registered after this controller's birth (root registry
   * change notification): warm it and fold its roll into the live lexicon —
   * the constructor-time prewarm covers only the roster present at scope
   * birth.
   * @param source - the newly registered source.
   */
  sourceAdded(source: InputTriggerSource): void {
    if (!this.accepts(source)) return
    const projection = this.project()
    source.warm?.(projection)
    this.watchLexicon(source, projection)
    this.refreshLexicon()
  }

  /** External dismiss (e.g. pointer outside the composer area). */
  dismiss(): void {
    if (this.disposed) return
    this.stopFetch()
    this.reduce({ type: 'close' })
  }

  /** Scope teardown: close and abort (the service deletes the map entry). */
  dispose(): void {
    this.disposed = true
    this.stopFetch()
    this.reduce({ type: 'close' })
    this.hit = null
    for (const off of this.lexiconOffs.values()) off()
    this.lexiconOffs.clear()
  }

  /** The explicit Session-or-draft projection handed to sources. */
  private project(): InputTriggerTarget {
    if (this.deps.target !== undefined) return this.deps.target()
    // oxlint-disable-next-line typescript/no-deprecated -- construction compatibility for session-only controller callers
    if (this.deps.sessionId !== undefined) return { sessionId: this.deps.sessionId }
    throw new Error('ui-input-trigger: controller has no target')
  }

  /** Execute a claim/insert/text outcome via the scoped input events (actx as dispatch subject); true = the input applied it. */
  private execute(outcome: PickOutcome, span: import('../types.ts').TokenSpan): boolean {
    if (this.deps.apply !== undefined) return this.deps.apply(outcome, span)
    const { actx } = this.deps
    if (outcome === undefined || outcome === 'handled') return false
    if ('claim' in outcome) {
      return actx.bail(actx, 'slash/input-begin-command', { claim: outcome.claim, span }) === true
    }
    if ('text' in outcome) {
      return actx.bail(actx, 'slash/input-insert-text', {
        text: outcome.text,
        span,
        ...outcome.continue === true ? { continue: true } : {},
      }) === true
    }
    return actx.bail(actx, 'slash/input-insert-reference', { reference: outcome.insert, span }) === true
  }

  /** Re-poll every lexicon-bearing source and publish the aggregated rolls (see the store doc). */
  private refreshLexicon(): void {
    const projection = this.project()
    const rolls = new Map<TriggerChar, readonly string[]>()
    for (const src of this.sources()) {
      if (src.lexicon === undefined) continue
      let names: readonly string[] | undefined
      try {
        names = src.lexicon(projection)
      } catch (error) {
        // A faulty source drops silently with a console record (the
        // candidate-fetch failure policy); the refresh runs inside
        // notification callbacks, where a throw would starve other consumers.
        console.error(`[ui-input-trigger] source "${src.name}" lexicon failed:`, error)
        continue
      }
      if (names === undefined) continue
      const prev = rolls.get(src.trigger)
      rolls.set(src.trigger, prev === undefined ? names : [...prev, ...names])
    }
    this.lexicon.set(rolls)
  }

  /** Wire one source's lexicon invalidation channel into refresh (hookless or roll-less sources never notify). */
  private watchLexicon(source: InputTriggerSource, projection: InputTriggerTarget): void {
    if (source.lexicon === undefined || source.subscribeLexicon === undefined) return
    this.lexiconOffs.set(source, source.subscribeLexicon(projection, () => { this.refreshLexicon() }))
  }

  /** Launch candidate fetches for one hit generation, optionally superseding the whole prior roster. */
  private fetchCandidates(hit: TriggerHit, roster: readonly InputTriggerSource[], replaceAll = true): void {
    if (replaceAll) this.stopFetch()
    const generation = this.menu.getSnapshot().generation
    const projection = this.project()
    for (const source of roster) {
      this.fetches.get(source.name)?.abort()
      const controller = new AbortController()
      this.fetches.set(source.name, controller)
      void source
        .candidates(projection, {
          query: hit.query,
          quoted: hit.quoted,
          position: hit.position,
          signal: controller.signal,
        })
        .then(
          (result) => {
            if (controller.signal.aborted) return
            if (this.fetches.get(source.name) === controller) this.fetches.delete(source.name)
            this.reduce({
              type: 'source-settled', generation, source: source.name,
              items: result,
              ...result.issues === undefined ? {} : { issues: result.issues },
            })
          },
          (error: unknown) => {
            if (controller.signal.aborted) return
            if (this.fetches.get(source.name) === controller) this.fetches.delete(source.name)
            console.error(`[ui-input-trigger] source "${source.name}" candidates failed:`, error)
            this.reduce({ type: 'source-failed', generation, source: source.name })
          },
        )
    }
  }

  /** Eligible roster for the controller's current target (legacy sources are session-only). */
  private sources(trigger?: string): readonly InputTriggerSource[] {
    const roster = trigger === undefined ? this.deps.roster.all() : this.deps.roster.sources(trigger)
    return roster.filter(source => this.accepts(source))
  }

  private accepts(source: InputTriggerSource): boolean {
    const target = this.project()
    const kind = target.kind === 'draft' ? 'draft' : 'session'
    return source.targets?.includes(kind) ?? kind === 'session'
  }

  private stopFetch(): void {
    for (const fetch of this.fetches.values()) fetch.abort()
    this.fetches.clear()
  }

  private clearLauncher(): void {
    if (this.launcher.getSnapshot() !== null) this.launcher.set(null)
  }

  private reduce(ev: MenuEvent): void {
    const cur = this.menu.getSnapshot()
    const next = menuReduce(cur, ev)
    if (next !== cur) this.menu.set(next)
    if (!next.open) this.clearLauncher()
  }
}
