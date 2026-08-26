/**
 * Frozen pure-core contract: trigger detection and
 * menu reduction, zero React / DOM / cordis. Types only — implementations
 * live in sibling modules annotated with these
 * aliases; the service shell wires them to ctx.
 */
import type { TokenSpan } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InputTriggerCandidate, TriggerChar, TriggerGuard, TriggerPosition } from '../types.ts'

/** A detected trigger token under the caret. */
export interface TriggerHit {
  readonly trigger: TriggerChar
  /** Text between the trigger char and the caret, live-filtered. */
  readonly query: string
  /** True only for an open quoted `@file` token. */
  readonly quoted: boolean
  /** leading = draft trimmed (whitespace incl. newlines) starts with the token. */
  readonly position: TriggerPosition
  /** Token span; draftRev injected by the caller. */
  readonly span: TokenSpan
}

/**
 * Detect a trigger token at the caret under the given guard tier.
 * `@` uses the shared file-reference start/whitespace grammar; `/` accepts
 * punctuation boundaries with URL carve-outs. `user@host` and URL `/` do not
 * trigger.
 * Returns null when no trigger is live at the caret.
 */
export type DetectTrigger = (draft: string, caret: number, guard: TriggerGuard) => TriggerHit | null

/** Menu state: one group per source; empty successful groups auto-close the menu. */
export interface MenuState {
  readonly open: boolean
  readonly hit: TriggerHit | null
  /** Monotonic per-hit generation; stale source settlements are dropped. */
  readonly generation: number
  readonly groups: readonly {
    readonly source: string
    /** False when candidate section rows own all visible group labeling. */
    readonly showGroupTitle?: boolean
    readonly status: 'pending' | 'ready' | 'error'
    readonly items: readonly InputTriggerCandidate[]
    readonly issues?: readonly import('../types.ts').InputTriggerSectionIssue[]
    /** A contained-error retry is in flight while stale successful rows remain visible. */
    readonly refreshing?: boolean
  }[]
  readonly highlight: { readonly source: string; readonly index: number } | null
}

/** Menu reduction events. Source failures remain isolated and retryable. */
export type MenuEvent =
  | { readonly type: 'hit'; readonly hit: TriggerHit | null }
  | { readonly type: 'source-settled'; readonly generation: number; readonly source: string; readonly items?: readonly InputTriggerCandidate[]; readonly issues?: readonly import('../types.ts').InputTriggerSectionIssue[] }
  | { readonly type: 'source-failed'; readonly generation: number; readonly source: string; readonly message?: string }
  | { readonly type: 'source-retry'; readonly generation: number; readonly source: string }
  | { readonly type: 'source-removed'; readonly generation: number; readonly source: string }
  | { readonly type: 'move'; readonly dir: 1 | -1 }
  | { readonly type: 'hover'; readonly source: string; readonly index: number }
  | { readonly type: 'close' }

/** Pure menu reducer; returns the same reference when the event is stale or a no-op. */
export type MenuReduce = (state: MenuState, ev: MenuEvent) => MenuState

/**
 * Exact-name lookup in one source's ready group; null when absent or the
 * group is not ready.
 */
export type ExactMatch = (groups: MenuState['groups'], source: string, name: string) => InputTriggerCandidate | null
