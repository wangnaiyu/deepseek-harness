/**
 * Frozen service contract of the slash pipeline. Types only. The
 * InputTriggerService implementation publishes this face as `ctx.inputTriggers`; sources
 * see registerSource alone, the conversation wiring layer resolves its
 * per-session controller through sessionOf.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { PickOutcome, TokenSpan } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InputTriggerSource, InputTriggerTarget } from '../types.ts'
import type { InputTriggerController } from './controller.ts'

/** The `ctx.inputTriggers` service face. */
export interface InputTriggerServiceContract {
  /**
   * Register one trigger source; duplicate trigger/name pairs throw.
   * @param src - source that discovers and resolves slash or reference candidates.
   * @returns effect disposer removing this source.
   */
  registerSource(src: InputTriggerSource): () => void
  /**
   * Resolve the lazy controller owned by one session scope.
   * @param actx - session-scoped Client context.
   * @returns controller that dies with that scope.
   */
  sessionOf(actx: ClientContext): InputTriggerController
  /**
   * Bind the one browser-only new-session draft controller.
   * @param binding - live draft target and pick-application callbacks.
   * @returns disposer for this draft-controller generation.
   */
  bindDraft(binding: {
    readonly target: () => Extract<InputTriggerTarget, { kind: 'draft' }>
    readonly apply: (outcome: PickOutcome, span: TokenSpan) => boolean
  }): () => void
  /**
   * Resolve the bound draft controller, when the conversation composer has mounted it.
   * @returns the active draft controller, or undefined before it is bound.
   */
  draft(): InputTriggerController | undefined
}
