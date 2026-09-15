import { en } from './locales.ts'
import type { ConversationKey } from './locales.ts'

import type { DraftContent, SubmissionBinding, SubmissionCheck } from './contract/guarded-drafts.ts'

interface SavedBinding {
  readonly version: 1
  readonly binding: SubmissionBinding
  readonly text: string
  readonly references?: DraftContent['references']
  readonly phase: 'pending' | 'admitted'
  readonly sessionId?: string
}

const PREFIX = 'dsh.conversation.launch.v1.'

/** Storage and registered checks are owned by one Conversation apply. */
export class SubmissionBindings {
  constructor(private readonly t: (key: ConversationKey) => string = key => en[key]) {}

  private readonly checks = new Map<string, (binding: SubmissionBinding, target: SubmissionCheck) => Promise<void>>()
  private readonly checking = new Map<string, Promise<void>>()

  /** Register the owner responsible for validating one binding payload.
   * @param owner - Stable plugin owner.
   * @param check - Validator run before default prompt delivery.
   * @returns Disposer for this registration.
   */
  register(owner: string, check: (binding: SubmissionBinding, target: SubmissionCheck) => Promise<void>): () => void {
    if (this.checks.has(owner)) throw new Error(`Submission owner '${owner}' is already registered`)
    this.checks.set(owner, check)
    return () => { if (this.checks.get(owner) === check) this.checks.delete(owner) }
  }

  /** Read and validate interaction state without caching across reloads.
   * @param key - Browser key or actual Session id.
   * @returns Validated saved state, or undefined for ordinary input.
   */
  read(key: string): SavedBinding | undefined {
    if (typeof localStorage === 'undefined') return undefined
    const raw = localStorage.getItem(PREFIX + key)
    if (raw === null) return undefined
    const value = JSON.parse(raw) as Partial<SavedBinding> | null
    if (value?.version !== 1 || typeof value.text !== 'string'
      || (value.phase !== 'pending' && value.phase !== 'admitted')
      || (key !== 'browser' && value.sessionId !== key)
      || typeof value.binding?.owner !== 'string' || typeof value.binding.id !== 'string'
      || !('payload' in value.binding)) throw new Error(this.t('analysis.invalid'))
    return value as SavedBinding
  }

  /** Persist interaction state synchronously; storage failures reject the submission.
   * @param key - Browser key or actual Session id.
   * @param value - Complete versioned interaction state.
   */
  save(key: string, value: SavedBinding): void {
    if (typeof localStorage === 'undefined') throw new Error(this.t('analysis.unavailable'))
    localStorage.setItem(PREFIX + key, JSON.stringify(value))
  }

  /** Save a fresh browser launch before exposing its composer text.
   * @param binding - Stable launch identity and owner payload.
   * @param text - Initial question.
   */
  stage(binding: SubmissionBinding, text: string | DraftContent): void {
    const content = typeof text === 'string' ? { text } : { text: text.text, references: text.references }
    this.save('browser', { version: 1, binding, ...content, phase: 'pending' })
  }

  /** Keep browser text edits with the stable binding.
   * @param text - Current browser question.
   * @param references - Atomic reference projections accompanying the text.
   */
  edit(text: string, references?: DraftContent['references']): void {
    const current = this.read('browser')
    if (current !== undefined) this.save('browser', { ...current, text, ...references === undefined ? {} : { references } })
  }

  /** Retire only the browser copy after transfer or explicit cancellation. */
  clearBrowser(): void {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(PREFIX + 'browser')
  }

  /** Persist the receiving Session before retiring the browser copy.
   * @param sessionId - Newly materialized Session.
   * @param captured - Captured launch and draft text.
   */
  bind(sessionId: string, captured: SavedBinding): void {
    // Commit the receiving identity before discarding the browser copy.
    this.save(sessionId, { ...captured, sessionId })
    if (this.read('browser')?.binding.id === captured.binding.id) this.clearBrowser()
  }

  /** Validate the owner and persist successful admission before resolving every waiter.
   * @param saved - Captured interaction state.
   * @param target - Actual Session if materialized and cancellation signal.
   */
  async check(saved: SavedBinding | undefined, target: SubmissionCheck): Promise<void> {
    if (saved === undefined) return
    target.signal.throwIfAborted()
    const check = this.checks.get(saved.binding.owner)
    if (check === undefined) throw new Error(this.t('analysis.ownerUnavailable'))
    const key = `${saved.binding.id}:${target.sessionId ?? 'browser'}:${JSON.stringify(target.content)}`
    const previous = this.checking.get(key)
    if (previous !== undefined) {
      await previous
      target.signal.throwIfAborted()
      return
    }
    const pending = (async () => {
      await check(saved.binding, { ...target, admitted: saved.phase === 'admitted' })
      target.signal.throwIfAborted()
      if (target.sessionId !== undefined) {
        const current = this.read(target.sessionId)
        if (current?.binding.id !== saved.binding.id) throw new Error(this.t('analysis.changed'))
        this.save(target.sessionId, { ...current, phase: 'admitted' })
      }
    })()
    this.checking.set(key, pending)
    try { await pending } finally {
      if (this.checking.get(key) === pending) this.checking.delete(key)
    }
  }
}
