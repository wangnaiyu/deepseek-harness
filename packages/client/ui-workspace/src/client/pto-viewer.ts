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
  readonly artifactRefs: readonly string[]
  readonly requestId: string
  readonly recordId: string
  readonly revision: string
  readonly actionId: string
  readonly requestedSkill: { readonly name: string; readonly provider: string; readonly revision: string }
}

/** Typed Host operations consumed by the browser viewer controller. */
export interface PtoViewerRemote {
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
  stageAnalysis(beginDraft: (text: string, intent: PtoAnalysisIntent) => void): void {
    const current = this.state
    if (current.kind !== 'open') throw new Error('A PTO viewer must be open before staging analysis')
    const action = current.record.actions.find(candidate =>
      candidate.actionId === 'analyze.dependency-redundancy'
      && candidate.kind === 'analysis' && candidate.status === 'available')
    if (action?.skill === undefined) throw new Error('Dependency redundancy analysis is not available for this record')
    try {
      beginDraft('分析此数据记录中的冗余依赖。请给出结论、证据、限制和下一步。', {
        requestId: `pto-analysis-${globalThis.crypto.randomUUID()}`,
        artifactRefs: [...action.artifactRefs],
        recordId: current.record.recordId,
        revision: current.record.profile.revision,
        actionId: action.actionId,
        requestedSkill: { ...action.skill },
      })
      this.publish({ kind: 'open', record: current.record, handle: current.handle })
    } catch (error) {
      this.publish({ ...current, analysisError: errorMessage(error) })
      throw error
    }
  }

  /** Validate persisted intent, and re-admit against the real Session before every send.
   * @param payload - Persisted owner payload.
   * @param requestId - Stable launch id.
   * @param sessionId - Actual Session after materialization.
   */
  async checkAnalysis(payload: unknown, requestId: string, sessionId?: string): Promise<void> {
    if (typeof payload !== 'object' || payload === null) throw new Error(this.t('analysis.missing'))
    const intent = payload as Partial<PtoAnalysisIntent>
    if (!Array.isArray(intent.artifactRefs) || !intent.artifactRefs.includes('deps.json') || intent.artifactRefs.some(ref => typeof ref !== 'string')
      || intent.requestId !== requestId || typeof intent.recordId !== 'string'
      || typeof intent.revision !== 'string' || intent.actionId !== 'analyze.dependency-redundancy'
      || typeof intent.requestedSkill?.name !== 'string'
      || typeof intent.requestedSkill.provider !== 'string' || typeof intent.requestedSkill.revision !== 'string') {
      throw new Error(this.t('analysis.invalid'))
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
