/** Read-only Host projection of commands and Skills for drafts and formal Sessions. */

import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type { CommandDiscoveryEntry } from '@deepseek-ai/dsh-commands'
import type { ScopeKey } from '@deepseek-ai/dsh-scope'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import {
  isUserInvocable,
  type SkillRegistry,
  type SkillSource,
  type SkillSummary,
} from '@deepseek-ai/dsh-skill'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import z from '@deepseek-ai/schemastery'
import type {
  DraftCatalogError,
  DraftCatalogOrigin,
  DraftCommandDescriptor,
  DraftComposerCatalog,
  DraftComposerCatalogRequest,
  DraftSkillDescriptor,
  SessionComposerCatalogRequest,
} from './types.ts'

export type * from './types.ts'

const MAX_DESCRIPTION_LENGTH = 1_000

/** Trusted product ownership attached to one technical provider or source. */
export interface ProviderOriginConfig {
  /** Opaque provider id carried by command registrations or Skill summaries. */
  readonly provider: string
  /** Optional Skill source discriminator; omission also applies to commands. */
  readonly source?: string
  /** Product bucket represented by this trusted profile declaration. */
  readonly kind: 'dsh' | 'pto' | 'plugin' | 'user'
  /** Friendly plugin label; other kinds use their fixed product label. */
  readonly label?: string
}

/** Draft catalog product-origin configuration. */
export interface Config {
  /** Trusted provider/source to product-origin declarations. */
  providerOrigins?: ProviderOriginConfig[]
}

/** A request named a Workspace that the Host registry no longer contains. */
export class DraftComposerWorkspaceNotFound extends Error {
  constructor(readonly workspaceId: string) {
    super(`composer catalog workspace '${workspaceId}' does not exist`)
    this.name = 'DraftComposerWorkspaceNotFound'
  }
}

/** A request named a Session that is not attached to this Host. */
export class ComposerCatalogSessionNotFound extends Error {
  constructor(readonly sessionId: string) {
    super(`composer catalog session '${sessionId}' does not exist`)
    this.name = 'ComposerCatalogSessionNotFound'
  }
}

interface DraftTarget {
  readonly cwd?: string
  readonly workspaceOrigin?: DraftCatalogOrigin
  readonly standingKey?: ScopeKey
  readonly presetError?: Error
}

/** Remote-only, read-only catalog for draft and formal Session composers. */
export class ComposerCatalogGateway extends TypertRemoteService {
  static inject = ['commands', 'skills', 'workspaceRegistry', 'agentPresets', 'sessionProjections']

  static Config = z.object({
    providerOrigins: z.array(z.object({
      provider: z.string().min(1).required(),
      source: z.string().min(1),
      kind: z.union(['dsh', 'pto', 'plugin', 'user'] as const).required(),
      label: z.string().min(1),
    })).default([]),
  }) as z<Config>

  private readonly providerOrigins = new Map<string, DraftCatalogOrigin>()

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'composerCatalog')
    for (const declaration of config.providerOrigins ?? []) {
      const key = providerOriginKey(declaration.provider, declaration.source)
      if (this.providerOrigins.has(key)) {
        throw new Error(`composer catalog origin for provider '${declaration.provider}'${declaration.source === undefined ? '' : ` source '${declaration.source}'`} is already configured`)
      }
      this.providerOrigins.set(key, configuredOrigin(declaration))
    }
  }

  /**
   * Resolve the effective Commands and user-invocable Skills for one draft.
   * The request never accepts a path; Workspace ids resolve through the Host
   * registry, while an ungrouped draft passes `cwd: undefined` to Skills.
   * This operation reads registries and standing composition only. It never
   * creates or resumes an Agent, Session, or turn.
   * @param request - Host-addressed draft identity.
   * @returns current catalog plus contained area failures.
   */
  @Remote('listDraft')
  async listDraft(request: DraftComposerCatalogRequest): Promise<DraftComposerCatalog> {
    const target = await this.resolveTarget(request)
    const errors: DraftCatalogError[] = []
    if (target.presetError !== undefined) {
      const origin = fixedOrigin('agent')
      errors.push(
        catalogError('commands', 'agent-preset-unavailable', target.presetError.message, origin),
        catalogError('skills', 'agent-preset-unavailable', target.presetError.message, origin),
      )
    }

    const commands = this.commands(target.standingKey)
    const skills = await this.skills(target, errors)
    return catalogResult(commands, skills, errors)
  }

  /**
   * Resolve the final catalog for an existing Session. A live Agent is the
   * exact scope. A cold attached Session resolves its recorded preset's
   * standing composition without resuming an Agent or starting a turn.
   * @param request - Session identity to project.
   * @returns the unified final command and Skill catalog.
   */
  @Remote('listSession')
  async listSession(request: SessionComposerCatalogRequest): Promise<DraftComposerCatalog> {
    const sessionId = SessionId(request.sessionId)
    const session = this.ctx.get('sessions')?.get(sessionId)
    if (session === undefined) throw new ComposerCatalogSessionNotFound(request.sessionId)

    const live = this.ctx.get('agents')?.get(sessionId)
    const errors: DraftCatalogError[] = []
    let scope: ScopeKey | undefined = live
    let standingKey: ScopeKey | undefined
    if (scope === undefined) {
      try {
        const preset = this.ctx.sessionProjections.stateOf(session, 'agentPreset') ?? undefined
        standingKey = await this.ctx.agentPresets.standingKeyFor(preset)
        scope = standingKey
      } catch (error: unknown) {
        const origin = fixedOrigin('agent')
        errors.push(
          catalogError('commands', 'agent-preset-unavailable', toError(error).message, origin),
          catalogError('skills', 'agent-preset-unavailable', toError(error).message, origin),
        )
      }
    }
    const workspace = this.ctx.workspaceRegistry.list()
      .find(candidate => candidate.sessionIds.includes(sessionId))
    const target: DraftTarget = {
      ...session.header.cwd === undefined ? {} : { cwd: session.header.cwd },
      ...workspace === undefined ? {} : {
        workspaceOrigin: Object.freeze({ kind: 'workspace' as const, label: workspace.title }),
      },
      ...standingKey === undefined ? {} : { standingKey },
    }
    const registry = live === undefined
      ? this.skillRegistry(target)
      : this.ctx.agentPresets.serviceFor(live, 'skills') ?? this.ctx.skills
    const commands = this.commands(scope)
    const skills = await this.skills(target, errors, registry, scope)
    return catalogResult(commands, skills, errors)
  }

  /** Resolve Workspace and optional standing composition without creating runtime session state. */
  private async resolveTarget(request: DraftComposerCatalogRequest): Promise<DraftTarget> {
    if (request.workspaceId === undefined) return {}
    const workspace = this.ctx.workspaceRegistry.get(WorkspaceId(request.workspaceId))
    if (workspace === undefined) throw new DraftComposerWorkspaceNotFound(request.workspaceId)
    let standingKey: ScopeKey | undefined
    let presetError: Error | undefined
    try {
      standingKey = await this.ctx.agentPresets.standingKeyFor(request.agentPreset)
    } catch (error: unknown) {
      presetError = toError(error)
    }
    return {
      cwd: workspace.path,
      workspaceOrigin: Object.freeze({ kind: 'workspace', label: workspace.title }),
      ...standingKey === undefined ? {} : { standingKey },
      ...presetError === undefined ? {} : { presetError },
    }
  }

  /** Project effective registrations without exposing scope keys or provider ids. */
  private commands(scope: ScopeKey | undefined): DraftCommandDescriptor[] {
    return this.ctx.commands.listDiscoveryForScope(scope)
      .map(entry => Object.freeze({
        ...entry.descriptor,
        description: boundedDescription(entry.descriptor.description),
        origin: this.commandOrigin(entry),
      }))
      .sort(compareCommands)
  }

  /** Resolve the product owner of one effective command registration. */
  private commandOrigin(entry: CommandDiscoveryEntry): DraftCatalogOrigin {
    if (entry.provider !== undefined) {
      return this.providerOrigins.get(providerOriginKey(entry.provider)) ?? fixedOrigin('plugin')
    }
    return fixedOrigin(entry.layer === 'scoped' ? 'agent' : 'dsh')
  }

  /** Project the effective Skill view while containing registry-level discovery failure. */
  private async skills(
    target: DraftTarget,
    errors: DraftCatalogError[],
    registry = this.skillRegistry(target),
    scope: ScopeKey | undefined = target.standingKey,
  ): Promise<DraftSkillDescriptor[]> {
    let snapshot
    try {
      snapshot = await registry.snapshot({ cwd: target.cwd, scope })
    } catch (error: unknown) {
      errors.push(catalogError('skills', 'skill-catalog-failed', toError(error).message))
      return []
    }
    if (!snapshot.complete) {
      errors.push(catalogError(
        'skills',
        'skill-catalog-incomplete',
        'One or more Skill sources did not complete; successful entries remain available.',
      ))
    }
    return snapshot.skills
      .filter(isUserInvocable)
      .filter(skill => target.workspaceOrigin !== undefined || !isProjectSource(skill.source))
      .map(skill => Object.freeze({
        name: skill.name,
        description: boundedDescription(skill.description),
        modelInvocable: skill.invocation.modelInvocable,
        origin: this.skillOrigin(skill, target.workspaceOrigin),
      }))
      .sort(compareSkills)
  }

  /** Match formal preset behavior: use an isolated registry when mounted, otherwise the Host registry. */
  private skillRegistry(target: DraftTarget): SkillRegistry {
    if (target.standingKey === undefined) return this.ctx.skills
    return this.ctx.agentPresets.serviceForStanding(target.standingKey, 'skills') ?? this.ctx.skills
  }

  /** Resolve Skill source/provider facts to one user-facing product origin. */
  private skillOrigin(skill: SkillSummary, workspace: DraftCatalogOrigin | undefined): DraftCatalogOrigin {
    if (isProjectSource(skill.source)) return workspace ?? fixedOrigin('plugin')
    if (skill.source === 'user-dsh' || skill.source === 'user-agents') return fixedOrigin('user')
    const configured = this.providerOrigins.get(providerOriginKey(skill.provider, skill.source))
      ?? this.providerOrigins.get(providerOriginKey(skill.provider))
    if (configured !== undefined) return configured
    if (skill.source === 'custom') return fixedOrigin('user')
    if (skill.source === 'bundled') return fixedOrigin('dsh')
    return fixedOrigin('plugin')
  }
}

function providerOriginKey(provider: string, source?: string): string {
  return `${provider}\u0000${source ?? ''}`
}

function configuredOrigin(config: ProviderOriginConfig): DraftCatalogOrigin {
  if (config.kind === 'plugin') {
    return Object.freeze({ kind: 'plugin', label: config.label ?? 'Plugin' })
  }
  return fixedOrigin(config.kind)
}

function fixedOrigin(kind: 'dsh' | 'agent' | 'pto' | 'plugin' | 'user'): DraftCatalogOrigin {
  const label = kind === 'dsh' ? 'DSH'
    : kind === 'agent' ? 'Agent'
      : kind === 'pto' ? 'PTO'
        : kind === 'user' ? 'User'
          : 'Plugin'
  return Object.freeze({ kind, label })
}

function isProjectSource(source: SkillSource): boolean {
  return source === 'project-dsh' || source === 'project-agents'
}

function boundedDescription(description: string): string {
  if (description.length <= MAX_DESCRIPTION_LENGTH) return description
  return `${description.slice(0, MAX_DESCRIPTION_LENGTH - 3)}...`
}

function catalogResult(
  commands: DraftCommandDescriptor[],
  skills: DraftSkillDescriptor[],
  errors: DraftCatalogError[],
): DraftComposerCatalog {
  const payload = {
    commands,
    skills,
    ...errors.length === 0 ? {} : { partialErrors: errors },
  }
  return Object.freeze({
    revision: revisionOf(payload),
    commands: Object.freeze(commands),
    skills: Object.freeze(skills),
    ...errors.length === 0 ? {} : { partialErrors: Object.freeze(errors) },
  })
}

function catalogError(
  area: DraftCatalogError['area'],
  code: string,
  message: string,
  origin?: DraftCatalogOrigin,
): DraftCatalogError {
  return Object.freeze({ area, ...origin === undefined ? {} : { origin }, code, message })
}

function compareSkills(left: DraftSkillDescriptor, right: DraftSkillDescriptor): number {
  return skillOriginRank(left.origin.kind) - skillOriginRank(right.origin.kind)
    || compareCodePoints(left.origin.label, right.origin.label)
    || compareCodePoints(left.name, right.name)
}

function compareCommands(left: DraftCommandDescriptor, right: DraftCommandDescriptor): number {
  return commandOriginRank(left.origin.kind) - commandOriginRank(right.origin.kind)
    || compareCodePoints(left.origin.label, right.origin.label)
    || compareCodePoints(left.name, right.name)
}

function commandOriginRank(kind: DraftCatalogOrigin['kind']): number {
  switch (kind) {
    case 'dsh': return 0
    case 'agent': return 1
    case 'pto': return 2
    case 'plugin': return 3
    case 'user': return 4
    case 'workspace': return 5
  }
}

function skillOriginRank(kind: DraftCatalogOrigin['kind']): number {
  switch (kind) {
    case 'user': return 0
    case 'pto': return 1
    case 'workspace': return 2
    case 'dsh': return 3
    case 'plugin': return 4
    case 'agent': return 5
  }
}

function compareCodePoints(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function revisionOf(payload: object): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 20)
}

function toError(value: unknown): Error {
  if (value instanceof Error) return value
  try {
    return new Error(String(value))
  } catch {
    return new Error('[unrenderable failure]')
  }
}

export default ComposerCatalogGateway
