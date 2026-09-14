import type { Occurrence } from './input.ts'

/** Stable editor projection; contains no Lexical node keys or Host receipt. */
export interface DraftContent {
  readonly text: string
  readonly references: readonly Occurrence[]
}

/** Persistent interaction bindings; never a second Session log or a receipt authority. */
export interface SubmissionBinding {
  readonly owner: string
  readonly id: string
  readonly payload: unknown
}

/** Actual submission target and caller cancellation. */
export interface SubmissionCheck {
  readonly sessionId?: string
  readonly signal: AbortSignal
  /** Actual captured input, before reference serialization. */
  readonly content?: DraftContent
  /** The launch already passed admission in this Session. */
  readonly admitted?: boolean
}

/** Optional plugin launch binding on the ordinary Conversation submit path. */
export interface GuardedDrafts {
  /** Register the owner responsible for validating one binding payload. */
  register(owner: string, check: (binding: SubmissionBinding, target: SubmissionCheck) => Promise<void>): () => void
  /** Read the owner binding for reference discovery. @param sessionId - Absent for the browser draft. @returns Saved binding if any. */
  binding(sessionId?: string): SubmissionBinding | undefined
  /** Save a fresh browser launch before exposing its composer text. */
  stage(binding: SubmissionBinding, text: string | DraftContent, begin: () => void): void
  /** Restore a persisted browser draft through the normal navigation entry. */
  restore(begin: () => void): void
  /** Reject replacement until an unsent analysis has been cleared. */
  assertCanStart(): void
}
