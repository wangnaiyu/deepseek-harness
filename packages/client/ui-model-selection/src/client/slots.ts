/**
 * ModelSelect's injected face. The target 'conversation.input.model' seat is
 * declared (children table) and typed by ui-conversation's composer-bar
 * entry; this package only contributes the single occupant, so no SlotMap
 * merge lives here.
 */
import type { ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { ModelDirectoryState } from './directory.ts'

/** Injected business face of the composer model seat. */
export interface ModelSelectInjected {
  /** Whether this real Session or browser-only draft may select a model. */
  available: boolean
  /** Shared directory store; drafts use the Host catalog with a locally staged current value. */
  directory: SnapshotStore<ModelDirectoryState>
  /** Refresh the advisory directory (fire-and-forget; errors land on the store). */
  load: () => void
  /**
   * Select a complete provider/model/reasoning selection.
   * @param selection - model selection and optional adapter-owned effort.
   * @returns whether the Host accepted it, or the browser draft staged it.
   */
  select: (selection: ModelSelection) => Promise<boolean>
}
