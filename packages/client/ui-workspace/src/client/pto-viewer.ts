import type { DraftContent, ReferenceInsert } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { en, type WorkspaceKey } from './locales.ts'
/** Browser controller for the Host-owned PTO static-viewer lifecycle. */

import type {
  PtoArtifactRecordView, PtoArtifactViewerHandle, RemoteResult,
} from '@deepseek-ai/dsh-api-remotes/client'

/** Observable loading, viewer, or error state of the root controller. */
export type PtoViewerState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading'; readonly path: string }
  | { readonly kind: 'open'; readonly record: PtoArtifactRecordView; readonly handle: PtoArtifactViewerHandle; readonly analysisError?: string }
  | { readonly kind: 'error'; readonly path: string; readonly message: string }

/** Host admission receipt for the staged record and qualified Skill. */
export interface PtoAnalysisReceipt {
  readonly requestId: string
  readonly sessionId: string
  readonly recordId: string
  readonly recordRevision: string
  readonly actionId: string
  readonly artifactRefs: readonly string[]
  readonly skill: { readonly name: string; readonly provider: string; readonly revision: string }
  readonly tool: { readonly name: string; readonly revision: string }
}

interface PtoAnalysisIntent {
  readonly composerVersion?: 1
  readonly artifactRefs: readonly string[]
  readonly requestId: string
  readonly recordId: string
  readonly revision: string
  readonly actionId: string
  readonly requestedSkill: { readonly name: string; readonly provider: string; readonly revision: string }
}

/** Typed Host operations consumed by the browser viewer controller. */
export interface PtoViewerRemote {
  refresh: (recordId: string) => Promise<RemoteResult<PtoArtifactRecordView>>
  inspect: (request: { path: string }) => Promise<RemoteResult<PtoArtifactRecordView>>
  open: (request: { recordId: string; revision: string; actionId: string }) => Promise<RemoteResult<PtoArtifactViewerHandle>>
  close: (request: { handleId: string }) => Promise<RemoteResult<{ closed: boolean }>>
  admitAnalysis: (request: {
    requestId: string
    sessionId: string
    recordId: string
    revision: string
    actionId: string
    requestedSkill: { name: string; provider: string; revision: string }
  }) => Promise<RemoteResult<PtoAnalysisReceipt>>
}

function resultValue<T>(operation: string, result: RemoteResult<T>): T {
  if (result.ok) return result.value
  throw new Error(`${operation} failed: ${result.error.code}: ${result.error.message}`)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** One root-scoped controller; its snapshot is consumed by both sidebar and overlay slots. */
export class PtoViewerController {
  private state: PtoViewerState = Object.freeze({ kind: 'idle' })
  private readonly listeners = new Set<() => void>()
  private generation = 0
  private activeHandle: PtoArtifactViewerHandle | undefined

  constructor(private readonly remote: PtoViewerRemote, private readonly t: (key: WorkspaceKey) => string = key => en[key]) {}

  /** Read the current immutable viewer snapshot. */
  readonly getSnapshot = (): PtoViewerState => this.state

  /** Subscribe to state changes; returns the listener disposer. */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private publish(state: PtoViewerState): void {
    this.state = Object.freeze(state)
    for (const listener of this.listeners) listener()
  }

  /**
   * Profile and open the best currently available viewer without creating a Session.
   * @param path - explicit directory to inspect.
   */
  async open(path: string): Promise<void> {
    const generation = ++this.generation
    this.publish({ kind: 'loading', path })
    try {
      const record = resultValue('ptoArtifactInspection.inspect', await this.remote.inspect({ path }))
      const action = ['open.dependency-graph', 'open.memory-map', 'open.ir-lowering']
        .map(actionId => record.actions.find(candidate => candidate.actionId === actionId))
        .find(candidate => candidate?.status === 'available')
      if (action === undefined) {
        const reason = record.actions.find(candidate => candidate.kind === 'viewer')?.reasons[0]?.message
        throw new Error(reason ?? 'This data record has no supported viewer.')
      }
      const handle = resultValue('ptoArtifactInspection.open', await this.remote.open({
        recordId: record.recordId,
        revision: record.profile.revision,
        actionId: action.actionId,
      }))
      if (generation !== this.generation) {
        await this.remote.close({ handleId: handle.handleId })
        return
      }
      const previous = this.activeHandle
      this.activeHandle = handle
      this.publish({ kind: 'open', record, handle })
      if (previous !== undefined) await this.remote.close({ handleId: previous.handleId })
    } catch (error: unknown) {
      if (generation === this.generation) this.publish({ kind: 'error', path, message: errorMessage(error) })
    }
  }

  /**
   * Switch among viewer actions already proven available for the open Record revision.
   * @param actionId - available viewer action in the current record.
   */
  async switchViewer(actionId: string): Promise<void> {
    const current = this.state
    if (current.kind !== 'open' || current.handle.actionId === actionId) return
    const action = current.record.actions.find(candidate => candidate.actionId === actionId)
    if (action?.kind !== 'viewer' || action.status !== 'available') {
      throw new Error(`PTO viewer action '${actionId}' is not available for this record`)
    }
    const generation = ++this.generation
    const handle = resultValue('ptoArtifactInspection.open', await this.remote.open({
      recordId: current.record.recordId,
      revision: current.record.profile.revision,
      actionId,
    }))
    if (generation !== this.generation) {
      await this.remote.close({ handleId: handle.handleId })
      return
    }
    const previous = this.activeHandle
    this.activeHandle = handle
    this.publish({ kind: 'open', record: current.record, handle })
    if (previous !== undefined) await this.remote.close({ handleId: previous.handleId })
  }

  /** Stage one new launch; the Conversation owner protects existing drafts.
   * @param beginDraft - Protected draft staging callback.
   */
  stageAnalysis(beginDraft: (text: DraftContent, intent: PtoAnalysisIntent) => void): void {
    const current = this.state
    if (current.kind !== 'open') throw new Error('A PTO viewer must be open before staging analysis')
    const action = current.record.actions.find(candidate =>
      candidate.actionId === 'analyze.dependency-redundancy'
      && candidate.kind === 'analysis' && candidate.status === 'available')
    if (action?.skill === undefined) throw new Error('Dependency redundancy analysis is not available for this record')
    try {
      const intent: PtoAnalysisIntent = {
        composerVersion: 1,
        requestId: `pto-analysis-${globalThis.crypto.randomUUID()}`,
        artifactRefs: [...action.artifactRefs],
        recordId: current.record.recordId,
        revision: current.record.profile.revision,
        actionId: action.actionId,
        requestedSkill: { ...action.skill },
      }
      const reference = this.reference(intent)
      const prefix = `/skill ${intent.requestedSkill.name} `
      beginDraft({
        text: `${prefix}${reference.clipboardText} ${this.t('analysis.question')}`,
        references: [{ ...reference, occurrenceId: 0, offset: prefix.length, length: reference.clipboardText.length }],
      }, intent)
      void this.close().catch((error: unknown) => { this.reportRecoveryError(error) })
    } catch (error) {
      this.publish({ ...current, analysisError: errorMessage(error) })
      throw error
    }
  }

  /** Build the same atomic reference inserted by the PTO candidate source.
   * @param payload - Bound analysis intent.
   * @returns Source-owned Record reference, independent of Session cwd.
   */
  reference(payload: unknown): ReferenceInsert {
    const intent = payload as Partial<PtoAnalysisIntent> | null
    if (intent === null || typeof intent !== 'object' || typeof intent.recordId !== 'string'
      || typeof intent.revision !== 'string' || !intent.artifactRefs?.includes('deps.json')) {
      throw new Error(this.t('analysis.invalid'))
    }
    return { source: 'pto-artifact', ref: JSON.stringify({ recordId: intent.recordId, revision: intent.revision, artifactRef: 'deps.json' }),
      label: 'deps.json', appearance: 'file', clipboardText: '@deps.json', activatable: true }
  }

  /** Resolve a reference against the Host's current Record inventory.
   * @param ref - Opaque source-owned reference.
   * @returns Full current Record after exact revision validation.
   */
  async resolveReference(ref: string): Promise<PtoArtifactRecordView> {
    const value = JSON.parse(ref) as { recordId?: unknown; revision?: unknown; artifactRef?: unknown } | null
    if (value === null || typeof value.recordId !== 'string' || typeof value.revision !== 'string' || value.artifactRef !== 'deps.json') {
      throw new Error(this.t('analysis.invalid'))
    }
    const record = resultValue('ptoArtifactInspection.refresh', await this.remote.refresh(value.recordId))
    if (record.profile.revision !== value.revision) throw new Error(this.t('analysis.retry'))
    return record
  }

  /** Reopen a referenced Record with a fresh viewer handle, retiring the previous handle.
   * @param ref - Exact Record/revision/artifact reference.
   */
  async openReference(ref: string): Promise<void> {
    const generation = ++this.generation
    const record = await this.resolveReference(ref)
    const handle = resultValue('ptoArtifactInspection.open', await this.remote.open({
      recordId: record.recordId, revision: record.profile.revision, actionId: 'open.dependency-graph',
    }))
    if (generation !== this.generation) { await this.remote.close({ handleId: handle.handleId }); return }
    const previous = this.activeHandle
    this.activeHandle = handle
    this.publish({ kind: 'open', record, handle })
    if (previous !== undefined) await this.remote.close({ handleId: previous.handleId })
  }

  /** Validate persisted intent, and re-admit against the real Session before every send.
   * @param payload - Persisted owner payload.
   * @param requestId - Stable launch id.
   * @param sessionId - Actual Session after materialization.
   * @param content - Actual captured editor input before serialization.
   * @param admitted - Whether this launch already passed Session admission.
   */
  async checkAnalysis(payload: unknown, requestId: string, sessionId?: string, content?: DraftContent, admitted = false): Promise<void> {
    if (typeof payload !== 'object' || payload === null) throw new Error(this.t('analysis.missing'))
    const intent = payload as Partial<PtoAnalysisIntent>
    if (!Array.isArray(intent.artifactRefs) || !intent.artifactRefs.includes('deps.json') || intent.artifactRefs.some(ref => typeof ref !== 'string')
      || intent.requestId !== requestId || typeof intent.recordId !== 'string'
      || typeof intent.revision !== 'string' || intent.actionId !== 'analyze.dependency-redundancy'
      || typeof intent.requestedSkill?.name !== 'string'
      || typeof intent.requestedSkill.provider !== 'string' || typeof intent.requestedSkill.revision !== 'string') {
      throw new Error(this.t('analysis.invalid'))
    }
    if (intent.composerVersion === 1 && (!admitted || /(?:^|\s)\/skill\b/.test(content?.text ?? '') || (content?.references.length ?? 0) > 0)) {
      const expected = this.reference(intent)
      const gestures = [...(content?.text ?? '').matchAll(/(?:^|\s)\/skill[\t ]+([a-z0-9-]+)(?=\s|$)/g)]
      if (content === undefined || gestures.length !== 1 || gestures[0]?.[1] !== intent.requestedSkill.name
        || content.references.filter(ref => ref.source === expected.source).length !== 1
        || !content.references.some(ref => ref.source === expected.source && ref.ref === expected.ref && !ref.invalid)) {
        throw new Error(this.t('analysis.tokens'))
      }
    }
    if (sessionId === undefined) return
    try {
      resultValue('ptoArtifactInspection.admitAnalysis', await this.remote.admitAnalysis({
        requestId, sessionId, recordId: intent.recordId, revision: intent.revision,
        actionId: intent.actionId, requestedSkill: { ...intent.requestedSkill },
      }))
    } catch (error) {
      throw new Error(`${errorMessage(error)}. ${this.t('analysis.retry')}`)
    }
  }

  /** Surface a failed restore without removing the registered submission gate.
   * @param error - Restoration failure.
   */
  reportRecoveryError(error: unknown): void {
    this.publish({ kind: 'error', path: '', message: errorMessage(error) })
  }

  /** Close the current route or dismiss a pending/error surface. */
  async close(): Promise<void> {
    ++this.generation
    const current = this.state
    this.publish({ kind: 'idle' })
    const handle = this.activeHandle ?? (current.kind === 'open' ? current.handle : undefined)
    this.activeHandle = undefined
    if (handle !== undefined) await this.remote.close({ handleId: handle.handleId })
  }

  /** Revoke any current Host handle during plugin disposal. */
  async dispose(): Promise<void> {
    await this.close()
    this.listeners.clear()
  }
}
