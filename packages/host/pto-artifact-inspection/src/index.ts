/** Host-confined PTO data-record profile and exact-file viewer lifecycle. */

import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-subprocess'
import {
  isUserInvocable,
  renderSkillContent,
  type SkillDefinition,
  type SkillInvocationSource,
} from '@deepseek-ai/dsh-skill'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { inspectPtoRecord, type PtoRecordInspection } from '@deepseek-ai/dsh-tool-pto-run'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  PtoArtifactCloseRequest,
  PtoArtifactCloseResult,
  PtoArtifactAnalysisAdmitRequest,
  PtoArtifactAnalysisReceipt,
  PtoArtifactInspectRequest,
  PtoArtifactOpenRequest,
  PtoArtifactRecordView,
  PtoArtifactViewerHandle,
} from './types.ts'

export type * from './types.ts'

const JSON_OUTPUT = {
  schema: { type: 'json' as const },
  render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host-confined PTO artifact inspector and static viewer lifecycle. */
    ptoArtifactInspection: PtoArtifactInspectionGateway
  }
}

interface RegisteredRecord {
  readonly target: FsTarget
}

interface ActiveViewer {
  readonly disposeRoute: () => void
}

interface AdmittedAnalysis {
  readonly receipt: PtoArtifactAnalysisReceipt
  readonly skill: SkillDefinition
  readonly requestFingerprint: string
}

interface PtoArtifactAnalysisSource {
  readonly kind: 'pto-artifact-analysis'
  readonly form: 'instructions'
  readonly receipt: PtoArtifactAnalysisReceipt
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'pto-artifact-analysis': PtoArtifactAnalysisSource
  }
}

/** Deployment limits and pinned official analysis dependencies. */
export interface Config {
  /** Maximum number of artifact entries inspected per record. */
  maxArtifactEntries?: number
  /** Maximum bytes read from one metadata probe. */
  maxProbeBytes?: number
  /** Absolute URL prefix for revocable exact-file viewer routes. */
  routePrefix?: string
  /** Provider identity required for official dependency analysis. */
  officialDependencySkillProvider?: string
  /** Exact official Skill revision accepted at admission. */
  officialDependencySkillRevision?: string
  /** Pinned tool revision recorded in analysis receipts. */
  dependencyAnalysisToolRevision?: string
  /** Absolute path to the pinned upstream dependency tool. */
  dependencyAnalysisToolPath?: string
  /** Application-owned directory for dependency tool outputs. */
  dependencyAnalysisOutputRoot?: string
  /** Python executable used to launch the pinned tool. */
  pythonExecutable?: string
}

export const Config: z<Config> = z.object({
  maxArtifactEntries: z.number().step(1).min(1).default(2_000),
  maxProbeBytes: z.number().step(1).min(1).default(8 * 1024 * 1024),
  routePrefix: z.string().default('/pto-artifacts/view'),
  officialDependencySkillProvider: z.string().min(1),
  officialDependencySkillRevision: z.string().min(1),
  dependencyAnalysisToolRevision: z.string().min(1),
  dependencyAnalysisToolPath: z.string().min(1),
  dependencyAnalysisOutputRoot: z.string().min(1),
  pythonExecutable: z.string().min(1).default('python3'),
})

type ValidatedConfig = Required<Pick<Config, 'maxArtifactEntries' | 'maxProbeBytes' | 'routePrefix'>> & {
  officialDependencySkillProvider: string | undefined
  officialDependencySkillRevision: string | undefined
  dependencyAnalysisToolRevision: string | undefined
  dependencyAnalysisToolPath: string | undefined
  dependencyAnalysisOutputRoot: string | undefined
  pythonExecutable: string
}

function validatedConfig(config: Config): ValidatedConfig {
  const resolved = {
    maxArtifactEntries: config.maxArtifactEntries ?? 2_000,
    maxProbeBytes: config.maxProbeBytes ?? 8 * 1024 * 1024,
    routePrefix: config.routePrefix ?? '/pto-artifacts/view',
    officialDependencySkillProvider: config.officialDependencySkillProvider,
    officialDependencySkillRevision: config.officialDependencySkillRevision,
    dependencyAnalysisToolRevision: config.dependencyAnalysisToolRevision,
    dependencyAnalysisToolPath: config.dependencyAnalysisToolPath,
    dependencyAnalysisOutputRoot: config.dependencyAnalysisOutputRoot,
    pythonExecutable: config.pythonExecutable ?? 'python3',
  }
  if (!Number.isSafeInteger(resolved.maxArtifactEntries) || resolved.maxArtifactEntries < 1) {
    throw new TypeError('pto-artifact-inspection: maxArtifactEntries must be a positive safe integer')
  }
  if (!Number.isSafeInteger(resolved.maxProbeBytes) || resolved.maxProbeBytes < 1) {
    throw new TypeError('pto-artifact-inspection: maxProbeBytes must be a positive safe integer')
  }
  if (!/^\/[a-z0-9/-]+$/u.test(resolved.routePrefix) || resolved.routePrefix.endsWith('/')) {
    throw new TypeError('pto-artifact-inspection: routePrefix must be a lowercase absolute path without a trailing slash')
  }
  return resolved
}

function recordView(recordId: string, inspected: PtoRecordInspection): PtoArtifactRecordView {
  return Object.freeze({
    recordId,
    profile: Object.freeze({ ...inspected.profile, id: recordId }),
    actions: Object.freeze(inspected.actions),
  })
}

function safeTitle(path: string): string {
  const basename = path.slice(path.lastIndexOf('/') + 1)
  return basename === '' ? 'PTO artifact' : basename
}

/** User-gesture registration, profile refresh, and exact viewer route owner. */
export class PtoArtifactInspectionGateway extends TypertRemoteService {
  static inject = ['fs', 'webServer', 'tools']

  private readonly config: ValidatedConfig
  private readonly records = new Map<string, RegisteredRecord>()
  private readonly viewers = new Map<string, ActiveViewer>()
  private readonly admissionsByRequest = new Map<string, AdmittedAnalysis>()
  private readonly admissionsBySession = new Map<string, AdmittedAnalysis>()

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'ptoArtifactInspection')
    this.config = validatedConfig(config)
    ctx.tools.register(defineTool({
      name: 'pto_dependency_redundancy',
      description: 'Run the pinned official PyPTO dependency reducer in both required modes for a first-send-admitted PTO data record.',
      parameters: {
        record_id: { type: 'string', required: true, description: 'The admitted PTO record id from the structured analysis context.' },
        record_revision: { type: 'string', required: true, description: 'The exact admitted record revision.' },
      },
      output: JSON_OUTPUT,
      isConcurrencySafe: () => false,
      execute: async (args, exec) => await this.runDependencyAnalysis(
        args.record_id,
        args.record_revision,
        exec.agent,
        exec.signal,
      ) as never,
    }))
    ctx.on('agent/pre-step', async ({ agent, messages }, next): Promise<PreStepDecision> => {
      const admission = this.admissionsBySession.get(String(agent.id))
      if (admission === undefined || !messages.some(message => message.source.kind === 'user')) return next()
      const decision = await next()
      if (decision.kind === 'reject') return decision
      // The admitted qualified definition owns this launch. Canonical /skill
      // gestures may already have injected the same instructions downstream.
      // Never erase a conflicting provider or changed body to make it appear valid.
      const normalizedMessages = decision.messages.filter((message) => {
        if (message.source.kind !== 'skill-invocation' || message.source.name !== admission.skill.name) return true
        if (message.source.provider !== admission.skill.provider
          || message.content.length !== 1 || message.content[0]?.type !== 'text'
          || message.content[0].text !== renderSkillContent(admission.skill)) {
          throw new Error('PTO analysis Skill gesture does not match the admitted qualified definition')
        }
        return false
      })
      if (this.hasAnalysisContext(agent, decision.messages, admission.receipt.requestId)) {
        return { ...decision, messages: normalizedMessages }
      }
      const context = createUserMessage({
        content: [{ type: 'text', text: renderAnalysisContext(admission.receipt) }],
        source: {
          kind: 'pto-artifact-analysis',
          form: 'instructions',
          receipt: admission.receipt,
        },
      })
      const skillSource: SkillInvocationSource = {
        kind: 'skill-invocation',
        name: admission.skill.name,
        provider: admission.skill.provider,
        form: 'instructions',
      }
      const skill = createUserMessage({
        content: [{ type: 'text', text: renderSkillContent(admission.skill) }],
        source: skillSource,
      })
      return { ...decision, messages: [...normalizedMessages, context, skill] }
    }, { prepend: true })
    ctx.effect(() => () => {
      for (const viewer of this.viewers.values()) viewer.disposeRoute()
      this.viewers.clear()
      this.records.clear()
      this.admissionsByRequest.clear()
      this.admissionsBySession.clear()
    }, 'pto-artifact-inspection: revoke records and viewer routes')
  }

  private async inspectTarget(recordId: string, registered: RegisteredRecord): Promise<PtoArtifactRecordView> {
    const inspected = await inspectPtoRecord(
      this.ctx.fs,
      registered.target,
      '.',
      this.config.maxArtifactEntries,
      {
        dependencyRenderer: false,
        ...this.config.officialDependencySkillProvider === undefined
          || this.config.officialDependencySkillRevision === undefined
          ? {}
          : {
            officialDependencySkill: {
              provider: this.config.officialDependencySkillProvider,
              revision: this.config.officialDependencySkillRevision,
            },
          },
      },
      undefined,
      this.config.maxProbeBytes,
    )
    return recordView(recordId, inspected)
  }

  /**
   * Register one explicit directory and return a fresh fact-only profile.
   * @param request - user-selected Host path.
   * @returns registered record and current action readiness.
   */
  @Remote('inspect')
  async inspect(request: PtoArtifactInspectRequest): Promise<PtoArtifactRecordView> {
    const path = request.path.trim()
    if (path === '') throw new TypeError('path must be a non-empty directory path')
    const target = await this.ctx.fs.resolve(path)
    const info = await this.ctx.fs.stat(target)
    if (info?.type !== 'directory') throw new Error('path must name an existing directory')
    const recordId = `pto-record-${randomUUID()}`
    const registered = { target }
    const view = await this.inspectTarget(recordId, registered)
    this.records.set(recordId, registered)
    return view
  }

  /**
   * Refresh a previously registered record without accepting a new path.
   * @param recordId - Host-issued record identity.
   * @returns refreshed profile and action readiness.
   */
  @Remote('refresh')
  async refresh(recordId: string): Promise<PtoArtifactRecordView> {
    const registered = this.records.get(recordId)
    if (registered === undefined) throw new Error(`PTO data record '${recordId}' is not registered on this Host`)
    return this.inspectTarget(recordId, registered)
  }

  /**
   * Open one currently available self-contained HTML action.
   * @param request - fixed record revision and viewer action.
   * @returns revocable exact-route viewer handle.
   */
  @Remote('open')
  async open(request: PtoArtifactOpenRequest): Promise<PtoArtifactViewerHandle> {
    const registered = this.records.get(request.recordId)
    if (registered === undefined) throw new Error(`PTO data record '${request.recordId}' is not registered on this Host`)
    const current = await this.inspectTarget(request.recordId, registered)
    if (current.profile.revision !== request.revision) throw new Error('PTO data record changed; refresh before opening it')
    const action = current.actions.find(candidate => candidate.actionId === request.actionId)
    if (action?.status !== 'available' || action.kind !== 'viewer') {
      throw new Error(`PTO viewer action '${request.actionId}' is not available`)
    }
    const artifactRef = action.artifactRefs[0]
    if (artifactRef === undefined || !artifactRef.toLowerCase().endsWith('.html')) {
      throw new Error(`PTO viewer action '${request.actionId}' has no supported static HTML artifact`)
    }
    const artifact = await this.ctx.fs.resolve(artifactRef, { cwd: registered.target.displayPath })
    if (!this.ctx.fs.contains(registered.target, artifact)) throw new Error('PTO artifact escaped its registered record')
    const info = await this.ctx.fs.stat(artifact)
    if (info?.type !== 'file') throw new Error('PTO viewer artifact is no longer a regular file')
    const expected = current.profile.artifacts.find(candidate => candidate.relativePath === artifactRef)?.version
    if (expected !== undefined && String(info.version) !== expected) throw new Error('PTO viewer artifact changed; refresh before opening it')

    const handleId = `pto-viewer-${randomUUID()}`
    const token = randomUUID().replaceAll('-', '')
    const urlPath = `${this.config.routePrefix}/${token}`
    const route: WebRoute = {
      kind: 'exact',
      path: urlPath,
      handler: async (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.writeHead(405, { Allow: 'GET, HEAD' })
          res.end()
          return
        }
        const fresh = await this.ctx.fs.stat(artifact)
        if (fresh?.type !== 'file' || String(fresh.version) !== String(info.version)) {
          res.writeHead(409, { 'Cache-Control': 'no-store' })
          res.end('Artifact changed; close and reopen the viewer.')
          return
        }
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'Referrer-Policy': 'no-referrer',
          'Content-Security-Policy': "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-ancestors 'self'",
          ...(fresh.size === undefined ? {} : { 'Content-Length': fresh.size }),
        })
        if (req.method === 'HEAD') {
          res.end()
          return
        }
        const controller = new AbortController()
        res.once('close', () => {
          if (!res.writableEnded) controller.abort()
        })
        const stream = await this.ctx.fs.streamText(artifact, controller.signal)
        for await (const chunk of stream) {
          if (!res.write(chunk)) await once(res, 'drain')
        }
        res.end()
      },
    }
    const disposeRoute = this.ctx.webServer.register(route)
    this.viewers.set(handleId, { disposeRoute })
    return Object.freeze({
      handleId,
      actionId: request.actionId,
      title: safeTitle(artifactRef),
      artifactRef,
      kind: 'static-html',
      urlPath,
      features: Object.freeze({ selection: false, deeplink: false }),
    })
  }

  /**
   * Revoke one viewer URL; closing never changes the original artifact.
   * @param request - Host-issued viewer handle identity.
   * @returns whether a live route was closed.
   */
  @Remote('close')
  close(request: PtoArtifactCloseRequest): PtoArtifactCloseResult {
    const viewer = this.viewers.get(request.handleId)
    if (viewer === undefined) return Object.freeze({ closed: false })
    viewer.disposeRoute()
    this.viewers.delete(request.handleId)
    return Object.freeze({ closed: true })
  }

  /**
   * Fail-closed first-send admission for one structured dependency analysis draft.
   * @param request - idempotent Session/record/action/Skill tuple.
   * @returns immutable invocation receipt used by the first model step.
   */
  @Remote('admitAnalysis')
  async admitAnalysis(request: PtoArtifactAnalysisAdmitRequest): Promise<PtoArtifactAnalysisReceipt> {
    const fingerprint = JSON.stringify(request)
    const duplicate = this.admissionsByRequest.get(request.requestId)
    if (duplicate !== undefined) {
      if (duplicate.requestFingerprint !== fingerprint) {
        throw new Error(`PTO analysis request '${request.requestId}' was already used with another payload`)
      }
      return duplicate.receipt
    }
    const registered = this.records.get(request.recordId)
    if (registered === undefined) throw new Error(`PTO data record '${request.recordId}' is not registered on this Host`)
    const current = await this.inspectTarget(request.recordId, registered)
    if (current.profile.revision !== request.revision) {
      throw new Error('PTO data record changed; refresh the analysis draft before sending')
    }
    const action = current.actions.find(candidate => candidate.actionId === request.actionId)
    if (action?.status !== 'available' || action.kind !== 'analysis' || action.skill === undefined) {
      throw new Error(`PTO analysis action '${request.actionId}' is not available`)
    }
    if (action.skill.name !== request.requestedSkill.name
      || action.skill.provider !== request.requestedSkill.provider
      || action.skill.revision !== request.requestedSkill.revision) {
      throw new Error('PTO analysis Skill tuple changed; refresh the analysis draft before sending')
    }
    const agents = this.ctx.get('agents')
    const skills = this.ctx.get('skills')
    if (agents === undefined || skills === undefined) {
      throw new Error('PTO analysis Agent/Skill services are unavailable')
    }
    const agent = agents.get(SessionId(request.sessionId))
    if (agent === undefined) throw new Error(`PTO analysis Session '${request.sessionId}' has no live Agent scope`)
    const skill = await skills.getQualified({
      name: request.requestedSkill.name,
      provider: request.requestedSkill.provider,
    }, {
      cwd: agent.session.header.cwd,
      scope: agent,
    })
    if (skill === undefined || !isUserInvocable(skill)) {
      throw new Error('The requested official Skill is unavailable for user invocation in this Session')
    }
    const toolRevision = this.config.dependencyAnalysisToolRevision
    if (toolRevision === undefined) throw new Error('The official dependency analysis tool is not configured')
    const receipt: PtoArtifactAnalysisReceipt = Object.freeze({
      requestId: request.requestId,
      sessionId: request.sessionId,
      recordId: request.recordId,
      recordRevision: request.revision,
      actionId: request.actionId,
      artifactRefs: Object.freeze([...action.artifactRefs]),
      skill: Object.freeze({ ...request.requestedSkill }),
      tool: Object.freeze({ name: 'pto_dependency_redundancy', revision: toolRevision }),
    })
    const admitted = { receipt, skill, requestFingerprint: fingerprint }
    this.admissionsByRequest.set(request.requestId, admitted)
    this.admissionsBySession.set(request.sessionId, admitted)
    return receipt
  }

  private hasAnalysisContext(agent: Agent, proposed: readonly { source: { kind: string } }[], requestId: string): boolean {
    const matches = (source: unknown): boolean => {
      if (typeof source !== 'object' || source === null) return false
      const candidate = source as { kind?: unknown; receipt?: { requestId?: unknown } }
      return candidate.kind === 'pto-artifact-analysis' && candidate.receipt?.requestId === requestId
    }
    return proposed.some(message => matches(message.source))
      || agent.session.snapshotEvents().some(event => event.type === 'user/message' && matches(event.data.source))
  }

  private async runDependencyAnalysis(
    recordId: string,
    recordRevision: string,
    agent: Agent | undefined,
    signal: AbortSignal,
  ): Promise<Record<string, unknown>> {
    if (agent === undefined) throw new Error('PTO dependency analysis requires a live Session Agent')
    const admission = this.admissionsBySession.get(String(agent.id))
    if (admission === undefined
      || admission.receipt.recordId !== recordId
      || admission.receipt.recordRevision !== recordRevision) {
      throw new Error('PTO dependency analysis was not admitted for this Session and record revision')
    }
    const registered = this.records.get(recordId)
    if (registered === undefined) throw new Error(`PTO data record '${recordId}' is no longer registered`)
    const current = await this.inspectTarget(recordId, registered)
    if (current.profile.revision !== recordRevision) {
      throw new Error('PTO data record changed after admission; refresh and retry')
    }
    const artifactRef = admission.receipt.artifactRefs[0]
    if (artifactRef === undefined) throw new Error('The admitted analysis has no dependency graph input')
    const input = await this.ctx.fs.resolve(artifactRef, { cwd: registered.target.displayPath })
    if (!this.ctx.fs.contains(registered.target, input)) throw new Error('PTO dependency input escaped its registered record')
    const inputInfo = await this.ctx.fs.stat(input)
    if (inputInfo?.type !== 'file') throw new Error('PTO dependency input is no longer a regular file')
    const toolPath = this.config.dependencyAnalysisToolPath
    const outputRoot = this.config.dependencyAnalysisOutputRoot
    if (toolPath === undefined || outputRoot === undefined) {
      throw new Error('The pinned PTO dependency analysis tool/output root is not configured')
    }
    await mkdir(resolve(outputRoot), { recursive: true })
    const outputDirectory = await mkdtemp(join(resolve(outputRoot), 'dependency-redundancy-'))
    const subprocess = this.ctx.get('subprocess')
    if (subprocess === undefined) throw new Error('The PTO dependency subprocess service is unavailable')
    const python = await subprocess.resolveExecutable(this.config.pythonExecutable, undefined, signal)
    const modes = []
    for (const mode of ['reduced', 'reduced_dataflow'] as const) {
      const outputPath = join(outputDirectory, `${mode}.txt`)
      const child = subprocess.spawn({
        argv: [python, resolve(toolPath), input.displayPath, '--format', 'text', '--edge-mode', mode, '-o', outputPath],
        cwd: registered.target.displayPath,
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: 1024 * 1024 },
          stderr: { maxBytes: 256 * 1024 },
        },
        graceMs: 2_000,
        signal,
      })
      const outcome = await child.done
      const stdout = child.collected.stdout?.readFrom(0)
      const stderr = child.collected.stderr?.readFrom(0)
      if (stdout?.lossy === true || stderr?.lossy === true) {
        throw new Error(`PTO dependency ${mode} output exceeded its bounded capture`)
      }
      if (outcome.exitCode !== 0 || outcome.signal !== null) {
        throw new Error(`PTO dependency ${mode} failed (exit=${String(outcome.exitCode)}, signal=${String(outcome.signal)}): ${stderr?.text.trim() ?? ''}`)
      }
      const lines = (stdout?.text ?? '').trim().split('\n').filter(Boolean)
      const edgeLines = lines.filter(line => line.startsWith('  - '))
      modes.push(Object.freeze({
        mode,
        headline: lines.find(line => !line.startsWith('  - ')) ?? '',
        redundantEdges: Object.freeze(edgeLines.map(line => line.slice(4))),
        cycleWarning: /cycle/iu.test(stderr?.text ?? ''),
        stderr: stderr?.text.trim() ?? '',
        outputRef: outputPath,
      }))
    }
    return {
      receipt: admission.receipt,
      input: { artifactRef, version: String(inputInfo.version) },
      modes: Object.freeze(modes),
      limitations: Object.freeze([
        'one captured graph and one topology',
        'dependency removal does not by itself prove a timing improvement',
      ]),
    }
  }
}

function renderAnalysisContext(receipt: PtoArtifactAnalysisReceipt): string {
  return [
    '<pto_artifact_analysis>',
    `record_id: ${receipt.recordId}`,
    `record_revision: ${receipt.recordRevision}`,
    `action_id: ${receipt.actionId}`,
    `artifact_refs: ${receipt.artifactRefs.join(', ')}`,
    `skill: ${receipt.skill.provider}/${receipt.skill.name}@${receipt.skill.revision}`,
    `tool: ${receipt.tool.name}@${receipt.tool.revision}`,
    `invocation_request_id: ${receipt.requestId}`,
    '',
    `Call the ${receipt.tool.name} tool with this record id, record revision, and both reduced modes before answering.`,
    'Report conclusions, evidence, limitations, and next steps. Treat task ids as scoped to this exact record revision.',
    '</pto_artifact_analysis>',
  ].join('\n')
}

export default PtoArtifactInspectionGateway
