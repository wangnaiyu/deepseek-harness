/** Unified command/Skill discovery source for a browser-only new-session draft. */
import type {
  DraftComposerCatalog, DraftComposerCatalogRequest,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {
  CandidateRequest, ClientDraftContext, InputTriggerCandidate, InputTriggerCandidateList,
  InputTriggerServiceContract, InputTriggerSource,
} from '@deepseek-ai/dsh-client-ui-input-trigger/client'

interface CacheEntry {
  readonly promise: Promise<DraftComposerCatalog>
  readonly abort: AbortController
  settled?: DraftComposerCatalog
}

/** Required services: generated Remote namespace plus the generic trigger registry. */
export const inject = ['remote', 'remote.composerCatalog', 'inputTriggers']

function requestOf(target: ClientDraftContext): DraftComposerCatalogRequest {
  return {
    ...target.workspaceId === undefined ? {} : { workspaceId: target.workspaceId },
    ...target.agentPreset === undefined ? {} : { agentPreset: target.agentPreset },
  }
}

function matches(candidate: { name: string; description: string; origin: { label: string } }, raw: string): boolean {
  const query = raw.trim().toLocaleLowerCase()
  if (query === '') return true
  return candidate.name.toLocaleLowerCase().includes(query)
    || candidate.description.toLocaleLowerCase().includes(query)
    || candidate.origin.label.toLocaleLowerCase().includes(query)
}

const cacheKey = (target: ClientDraftContext): string =>
  `${target.draftRevision}\u0000${target.workspaceId ?? ''}\u0000${target.agentPreset ?? ''}`

/** Mount the one draft-only source. */
export function apply(ctx: ClientContext): void {
  const cache = new Map<string, CacheEntry>()
  const lexiconListeners = new Set<() => void>()
  const notifyLexicon = (): void => { for (const listener of lexiconListeners) listener() }

  const clear = (): void => {
    for (const entry of cache.values()) entry.abort.abort()
    cache.clear()
    notifyLexicon()
  }

  const load = (target: ClientDraftContext): Promise<DraftComposerCatalog> => {
    const key = cacheKey(target)
    const existing = cache.get(key)
    if (existing !== undefined) return existing.promise
    const abort = new AbortController()
    const promise = ctx.remote.composerCatalog.listDraft(requestOf(target)).then((result) => {
      if (abort.signal.aborted) throw abort.signal.reason
      if (!result.ok) throw new Error(`composerCatalog.listDraft failed: ${result.error.code}: ${result.error.message}`)
      const current = cache.get(key)
      if (current?.abort === abort) current.settled = result.value
      notifyLexicon()
      return result.value
    })
    const entry: CacheEntry = { promise, abort }
    cache.set(key, entry)
    promise.catch(() => { if (cache.get(key) === entry) cache.delete(key) })
    return promise
  }

  const candidates = async (target: ClientDraftContext, req: CandidateRequest): Promise<InputTriggerCandidateList> => {
    const catalog = await load(target)
    if (req.signal.aborted) return []
    const commands: InputTriggerCandidate[] = catalog.commands
      .filter(command => matches(command, req.query))
      .map(command => ({
        name: command.name,
        description: command.description,
        origin: command.origin.label,
        value: `command:${command.name}`,
      }))
    const skills: InputTriggerCandidate[] = catalog.skills
      .filter(skill => matches(skill, req.query))
      .map(skill => ({
        name: skill.name,
        description: skill.description,
        origin: skill.origin.label,
        section: 'Skills',
        value: `skill:${skill.name}`,
      }))
    const issues = catalog.partialErrors?.map(error => ({
      section: error.area === 'commands' ? '' : 'Skills',
      message: error.origin === undefined ? error.message : `${error.origin.label}: ${error.message}`,
    }))
    const rows: InputTriggerCandidate[] = [...commands, ...skills]
    return issues === undefined || issues.length === 0
      ? rows
      : Object.assign(rows, { issues })
  }

  const source: InputTriggerSource = {
    trigger: '/',
    name: 'composer-catalog',
    order: -10,
    showGroupTitle: false,
    targets: ['draft'],
    candidates: (target, req) => target.kind === 'draft' ? candidates(target, req) : Promise.resolve([]),
    retry: (target) => {
      if (target.kind !== 'draft') return
      const entry = cache.get(cacheKey(target))
      entry?.abort.abort()
      cache.delete(cacheKey(target))
      notifyLexicon()
    },
    onPick: ({ candidate, session: target }) => {
      if (target.kind !== 'draft' || candidate.value === undefined) return undefined
      if (candidate.value.startsWith('skill:')) return { text: `/skill ${candidate.value.slice(6)} ` }
      if (candidate.value.startsWith('command:')) return { text: `/${candidate.value.slice(8)} ` }
      return undefined
    },
    lexicon: (target) => {
      if (target.kind !== 'draft') return []
      const catalog = cache.get(cacheKey(target))?.settled
      if (catalog === undefined) return undefined
      return [
        ...catalog.commands.map(command => command.name),
        ...catalog.skills.flatMap(skill => [skill.name, `skill ${skill.name}`]),
      ]
    },
    subscribeLexicon: (_target, listener) => {
      lexiconListeners.add(listener)
      return () => { lexiconListeners.delete(listener) }
    },
    warm: (target) => { if (target.kind === 'draft') load(target).catch(() => {}) },
  }

  const inputTriggers = ctx.get('inputTriggers') as InputTriggerServiceContract
  ctx.on('connection/reset', clear)
  ctx.effect(() => {
    const unregister = inputTriggers.registerSource(source)
    return () => { unregister(); clear() }
  }, 'ui-composer-catalog: draft source')
}
