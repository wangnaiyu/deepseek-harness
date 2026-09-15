/** Client-safe wire vocabulary for the draft composer capability catalog. */
import type { CommandDescriptor } from '@deepseek-ai/dsh-commands/types'

/** Product ownership shown at the right edge of one catalog row. */
export interface DraftCatalogOrigin {
  readonly kind: 'dsh' | 'agent' | 'pto' | 'workspace' | 'plugin' | 'user'
  readonly label: string
}

/** Composer-relevant input metadata copied from the authoritative command descriptor. */
export interface DraftCommandInputDescriptor {
  readonly hint: string
  readonly attachments?: boolean
}

/** One command available to a new-session draft. */
export interface DraftCommandDescriptor {
  /** Stable owner identity used by the browser to localize first-party commands. */
  readonly definitionId?: NonNullable<CommandDescriptor['definitionId']>
  readonly name: string
  readonly description: string
  readonly input?: DraftCommandInputDescriptor
  readonly iconId?: string
  readonly origin: DraftCatalogOrigin
}

/** One user-invocable Skill available to a new-session draft. */
export interface DraftSkillDescriptor {
  /** Current source path for formal Session reference preview; omitted from draft discovery. */
  readonly path?: string
  readonly name: string
  readonly description: string
  readonly modelInvocable: boolean
  readonly iconId?: string
  readonly origin: DraftCatalogOrigin
}

/** One contained catalog failure that did not invalidate successful entries. */
export interface DraftCatalogError {
  readonly area: 'commands' | 'skills'
  readonly origin?: DraftCatalogOrigin
  readonly code: string
  readonly message: string
}

/** Trusted draft identity accepted by the Host catalog resolver. */
export interface DraftComposerCatalogRequest {
  readonly workspaceId?: string
  readonly agentPreset?: string
}

/** Existing Session identity accepted by the formal capability resolver. */
export interface SessionComposerCatalogRequest {
  readonly sessionId: string
}

/** Point-in-time capability catalog for a draft with no Session. */
export interface DraftComposerCatalog {
  readonly revision: string
  readonly commands: readonly DraftCommandDescriptor[]
  readonly skills: readonly DraftSkillDescriptor[]
  readonly partialErrors?: readonly DraftCatalogError[]
}
