/**
 * Deterministic PyPTO 3.0 run recognition and artifact capability probing.
 * @module @deepseek-ai/dsh-tool-pto-run/run-artifacts
 */

import type { FileSystem, FsDirEntry, FsTarget } from '@deepseek-ai/dsh-fs'

/** PyPTO run kinds supported by the authoritative replay recognizer. */
export type PtoRunKind = 'l2' | 'l3'

/** One run found beneath the caller's workspace. */
export interface PtoRunSummary {
  relativePath: string
  displayPath: string
  kind: PtoRunKind
  recognitionMarker: 'kernel_config.py' | 'orchestration/host_orch.py'
}

/** Bounded discovery result. */
export interface PtoRunDiscovery {
  workspace: string
  visitedDirectories: number
  truncated: boolean
  runs: PtoRunSummary[]
}

/** Exact upstream literals for collecting one optional DFX capability. */
export interface PtoEvidenceCollection {
  runConfigLiteral: string
  pytestLiterals: string[]
  costNote?: 'workload-runs-twice'
}

/** One normalized evidence or rerun capability. */
export interface PtoRunCapability {
  name: string
  status: 'available' | 'not-observed' | 'unknown'
  evidence: string[]
  collection?: PtoEvidenceCollection
}

/** Compile-side artifact health, kept separate from optional DFX collection. */
export interface PtoRunHealth {
  compileStatus: 'artifacts-observed' | 'incomplete-or-failed' | 'unknown'
  compileEvidence: string[]
  diagnosticArtifacts: string[]
}

/** One L3 child build. */
export interface PtoSubBuild {
  name: string
  relativePath: string
  rerunFromDir: boolean
}

/** Deterministic inspection result for one recognized run. */
export interface PtoRunInspection extends PtoRunSummary {
  identityStatus: 'unverified'
  artifactInventoryTruncated: boolean
  subBuilds: PtoSubBuild[]
  runHealth: PtoRunHealth
  capabilities: PtoRunCapability[]
  rerunCapabilities: PtoRunCapability[]
}

/** User-selected data object classification. */
export type PtoRecordKind = 'run' | 'evidence-pack'

/** Artifact generation that is supported by a concrete recognizer. */
export type PtoArtifactGeneration = '3.0' | '2.0-pro' | 'unknown'

/** Runtime level proven by a run marker. */
export type PtoRuntimeLevel = 'L2' | 'L3' | 'unknown'

/** Per-artifact observation state; absence is never an aggregate run-health claim. */
export type PtoEvidenceStatus =
  | 'observed'
  | 'unchecked'
  | 'available'
  | 'missing'
  | 'invalid'
  | 'unreadable'
  | 'incompatible'

/** A bounded-inventory artifact reference with an opaque freshness token. */
export interface PtoArtifactRef {
  relativePath: string
  type: string
  version?: string
  size?: number
}

/** A machine-readable evidence issue suitable for localized presentation. */
export interface PtoEvidenceIssue {
  code: string
  message: string
}

/** Evidence facts for one stable business capability. */
export interface PtoEvidenceItem {
  type: string
  status: PtoEvidenceStatus
  artifactRefs: string[]
  issues: PtoEvidenceIssue[]
}

/** Fact-only profile for a recognized run or a markerless evidence pack. */
export interface PtoRecordProfile {
  id: string
  kind: PtoRecordKind
  relativePath: string
  displayPath: string
  revision: string
  generation: PtoArtifactGeneration
  runtimeLevel: PtoRuntimeLevel
  identityEvidence: string[]
  artifacts: PtoArtifactRef[]
  evidence: PtoEvidenceItem[]
  scan: {
    complete: boolean
    limits: string[]
  }
}

/** Dynamic readiness of one user-facing viewer or analysis action. */
export interface PtoActionReadiness {
  actionId: string
  kind: 'viewer' | 'analysis'
  status: 'available' | 'needs-preparation' | 'unavailable' | 'unknown'
  artifactRefs: string[]
  adapter?: { id: string; version: string }
  skill?: { name: string; provider: string; revision: string }
  reasons: PtoEvidenceIssue[]
}

/** Deployment capabilities consumed by the pure action resolver. */
export interface PtoActionEnvironment {
  dependencyRenderer: boolean
  officialDependencySkill?: { provider: string; revision: string }
}

/** Profile and its environment-dependent actions. */
export interface PtoRecordInspection {
  profile: PtoRecordProfile
  actions: PtoActionReadiness[]
}

/** Deployment-owned scan limits. */
export interface ScanLimits {
  maxDepth: number
  maxDirectories: number
  maxRuns: number
  maxArtifactEntries: number
  maxProbeBytes: number
}

const PRUNED_DIRECTORIES = new Set(['.git', 'node_modules', '__pycache__', '3rdparty'])
const TIMELINE_FILE = /^(?:chip_swimlane_records|merged_swimlane(?:_.+)?)\.json$/u
const CRITICAL_PATH_FILE = /^CPM_.+\.json$/u
const DIAGNOSTIC_FILE = /(?:^|\/)(?:[^/]+\.(?:log|err|stderr|stdout)|error\.txt)$/u
const ARTIFACT_TYPES: ReadonlyArray<{
  type: string
  match: (path: string, basename: string) => boolean
}> = [
  { type: 'dependency-graph', match: (_path, basename) => basename === 'deps.json' },
  { type: 'dependency-viewer', match: (_path, basename) => basename === 'deps_viewer.html' },
  { type: 'name-map', match: (_path, basename) => basename === 'name_map.json' },
  { type: 'timeline', match: (_path, basename) => TIMELINE_FILE.test(basename) },
  { type: 'program-graph', match: (_path, basename) => basename === 'program.json' },
  { type: 'memory-map', match: (_path, basename) => basename === 'memory_map.html' },
  { type: 'critical-path', match: (_path, basename) => CRITICAL_PATH_FILE.test(basename) || basename === 'critical_path_report.md' },
  { type: 'ir-viewer', match: (_path, basename) => /(?:^|_)ir_trace\.html$/u.test(basename) },
  { type: 'ir-lowering', match: path => path.startsWith('passes_dump/') || /(?:^|\/)pass(?:es)?(?:\/|_)/iu.test(path) },
]

const PROFILE_ADAPTER = Object.freeze({ id: 'pto-static-html', version: '1' })

const DFX_COLLECTION = {
  timeline: {
    runConfigLiteral: 'RunConfig.enable_chip_swimlane',
    pytestLiterals: ['--enable-chip-swimlane', '--chip-swimlane-level N'],
    costNote: 'workload-runs-twice',
  },
  tensorValues: {
    runConfigLiteral: 'RunConfig.enable_dump_args',
    pytestLiterals: ['--dump-args [LEVEL]'],
  },
  hardwareCounters: {
    runConfigLiteral: 'RunConfig.enable_pmu',
    pytestLiterals: ['--enable-pmu [N]'],
  },
  taskGraph: {
    runConfigLiteral: 'RunConfig.enable_dep_gen',
    pytestLiterals: ['--enable-dep-gen'],
  },
  scopeStats: {
    runConfigLiteral: 'RunConfig.enable_scope_stats',
    pytestLiterals: ['--enable-scope-stats'],
  },
} as const satisfies Record<string, PtoEvidenceCollection>

/** Marker-backed recognition of one PyPTO 3.0 run directory. */
export interface PtoRunRecognition {
  kind: PtoRunKind
  recognitionMarker: PtoRunSummary['recognitionMarker']
}

interface ArtifactInventory {
  entries: Array<{
    path: string
    target: FsTarget
    version?: string
    size?: number
  }>
  truncated: boolean
}

function joinRelative(parent: string, child: string): string {
  return parent === '.' ? child : `${parent}/${child}`
}

async function childEntries(fs: FileSystem, directory: FsTarget, signal?: AbortSignal): Promise<FsDirEntry[]> {
  return fs.listDir(directory, signal)
}

function directEntry(entries: readonly FsDirEntry[], name: string, type?: FsDirEntry['type']): FsDirEntry | undefined {
  return entries.find(entry => entry.name === name && (type === undefined || entry.type === type))
}

async function recognizeEntries(
  fs: FileSystem,
  entries: readonly FsDirEntry[],
  signal?: AbortSignal,
): Promise<PtoRunRecognition | undefined> {
  if (directEntry(entries, 'kernel_config.py', 'file') !== undefined) {
    return { kind: 'l2', recognitionMarker: 'kernel_config.py' }
  }
  const orchestration = directEntry(entries, 'orchestration', 'directory')
  if (orchestration === undefined) return undefined
  const orchestrationEntries = await childEntries(fs, orchestration.target, signal)
  return directEntry(orchestrationEntries, 'host_orch.py', 'file') === undefined
    ? undefined
    : { kind: 'l3', recognitionMarker: 'orchestration/host_orch.py' }
}

/**
 * Recognize one directory by the same PyPTO 3.0 markers used by discovery.
 * Directory names and timestamps never participate. A missing marker returns
 * `undefined`; filesystem and cancellation failures propagate.
 * @param fs - Filesystem capability that owns the target.
 * @param target - Directory to recognize.
 * @param signal - Optional cooperative cancellation signal.
 * @returns marker-backed run kind, or `undefined` when the directory is not a recognized run.
 */
export async function recognizePtoRun(
  fs: FileSystem,
  target: FsTarget,
  signal?: AbortSignal,
): Promise<PtoRunRecognition | undefined> {
  return recognizeEntries(fs, await childEntries(fs, target, signal), signal)
}

/**
 * Discover recognized runs without treating `next_levels` child builds as independent runs.
 * @param fs - Filesystem capability used for stable target traversal.
 * @param workspace - Canonical Session workspace root and containment boundary.
 * @param limits - Deployment-owned scan bounds.
 * @param signal - Optional cooperative cancellation signal.
 * @returns Bounded discovery facts and recognized runs.
 */
export async function discoverPtoRuns(
  fs: FileSystem,
  workspace: FsTarget,
  limits: ScanLimits,
  signal?: AbortSignal,
): Promise<PtoRunDiscovery> {
  const queue: Array<{ target: FsTarget; relativePath: string; depth: number }> = [
    { target: workspace, relativePath: '.', depth: 0 },
  ]
  const visited = new Set<string>()
  const runs: PtoRunSummary[] = []
  let visitedDirectories = 0
  let truncated = false

  while (queue.length > 0) {
    if (signal?.aborted) throw new Error('PTO run discovery aborted')
    if (visitedDirectories >= limits.maxDirectories || runs.length >= limits.maxRuns) {
      truncated = true
      break
    }
    const current = queue.shift()
    if (current === undefined) break
    const identity = String(current.target.targetKey)
    if (visited.has(identity) || !fs.contains(workspace, current.target)) continue
    visited.add(identity)
    visitedDirectories += 1

    const entries = await childEntries(fs, current.target, signal)
    const recognition = await recognizeEntries(fs, entries, signal)
    if (recognition !== undefined) {
      runs.push({
        relativePath: current.relativePath,
        displayPath: current.target.displayPath,
        kind: recognition.kind,
        recognitionMarker: recognition.recognitionMarker,
      })
      continue
    }
    if (current.depth >= limits.maxDepth) {
      if (entries.some(entry => entry.type === 'directory' && !PRUNED_DIRECTORIES.has(entry.name))) truncated = true
      continue
    }
    for (const entry of entries) {
      if (entry.type !== 'directory' || PRUNED_DIRECTORIES.has(entry.name)) continue
      if (!fs.contains(workspace, entry.target)) continue
      queue.push({
        target: entry.target,
        relativePath: joinRelative(current.relativePath, entry.name),
        depth: current.depth + 1,
      })
    }
  }

  return { workspace: workspace.displayPath, visitedDirectories, truncated, runs }
}

async function inventoryArtifacts(
  fs: FileSystem,
  run: FsTarget,
  maxEntries: number,
  signal?: AbortSignal,
): Promise<ArtifactInventory> {
  const artifactEntries: ArtifactInventory['entries'] = []
  const queue: Array<{ target: FsTarget; relativePath: string; depth: number }> = [
    { target: run, relativePath: '.', depth: 0 },
  ]
  const visited = new Set<string>()
  let truncated = false
  while (queue.length > 0) {
    if (signal?.aborted) throw new Error('PTO run inspection aborted')
    const current = queue.shift()
    if (current === undefined) break
    const identity = String(current.target.targetKey)
    if (visited.has(identity) || !fs.contains(run, current.target)) continue
    visited.add(identity)
    const entries = await childEntries(fs, current.target, signal)
    for (const entry of entries) {
      if (artifactEntries.length >= maxEntries) {
        truncated = true
        return { entries: artifactEntries, truncated }
      }
      const relativePath = joinRelative(current.relativePath, entry.name)
      if (entry.type === 'file') {
        artifactEntries.push({
          path: relativePath,
          target: entry.target,
          ...(entry.version === undefined ? {} : { version: String(entry.version) }),
          ...(entry.size === undefined ? {} : { size: entry.size }),
        })
      }
      if (entry.type !== 'directory' || !fs.contains(run, entry.target)) continue
      if (entry.name === 'next_levels' || current.relativePath.startsWith('next_levels')) continue
      if (PRUNED_DIRECTORIES.has(entry.name)) continue
      if (current.depth < 4) queue.push({ target: entry.target, relativePath, depth: current.depth + 1 })
    }
  }
  return { entries: artifactEntries, truncated }
}

function available(
  name: string,
  evidence: string[],
  collection?: PtoEvidenceCollection,
): PtoRunCapability {
  return {
    name,
    status: evidence.length === 0 ? 'not-observed' : 'available',
    evidence,
    ...(collection === undefined ? {} : { collection }),
  }
}

function matching(paths: readonly string[], predicate: (path: string, basename: string) => boolean): string[] {
  return paths.filter((path) => {
    const basename = path.slice(path.lastIndexOf('/') + 1)
    return predicate(path, basename)
  })
}

async function inspectSubBuilds(
  fs: FileSystem,
  entries: readonly FsDirEntry[],
  signal?: AbortSignal,
): Promise<PtoSubBuild[]> {
  const nextLevels = directEntry(entries, 'next_levels', 'directory')
  if (nextLevels === undefined) return []
  const children = await childEntries(fs, nextLevels.target, signal)
  const result: PtoSubBuild[] = []
  for (const child of children) {
    if (child.type !== 'directory' || !fs.contains(nextLevels.target, child.target)) continue
    const childFiles = await childEntries(fs, child.target, signal)
    result.push({
      name: child.name,
      relativePath: `next_levels/${child.name}`,
      rerunFromDir: directEntry(childFiles, 'compiled_meta.json', 'file') !== undefined,
    })
  }
  return result
}

function artifactType(path: string): string | undefined {
  const basename = path.slice(path.lastIndexOf('/') + 1)
  return ARTIFACT_TYPES.find(candidate => candidate.match(path, basename))?.type
}

function profileRevision(entries: ArtifactInventory['entries']): string {
  // FNV-1a is deliberately a compact change token, not a content-integrity
  // digest. The opaque filesystem versions remain the stale-check authority.
  let value = 0x811c9dc5
  for (const entry of entries) {
    const row = `${entry.path}\0${entry.version ?? ''}\0${entry.size ?? ''}\n`
    for (let index = 0; index < row.length; index += 1) {
      value ^= row.charCodeAt(index)
      value = Math.imul(value, 0x01000193)
    }
  }
  return `inventory-v1-${(value >>> 0).toString(16).padStart(8, '0')}`
}

function evidenceItem(
  type: string,
  artifacts: readonly PtoArtifactRef[],
  status: PtoEvidenceStatus,
  issues: PtoEvidenceIssue[] = [],
): PtoEvidenceItem {
  return {
    type,
    status,
    artifactRefs: artifacts.map(artifact => artifact.relativePath),
    issues,
  }
}

async function dependencyEvidence(
  fs: FileSystem,
  artifacts: readonly PtoArtifactRef[],
  entriesByPath: ReadonlyMap<string, ArtifactInventory['entries'][number]>,
  maxProbeBytes: number,
  signal?: AbortSignal,
): Promise<PtoEvidenceItem> {
  if (artifacts.length === 0) return evidenceItem('dependency-graph', artifacts, 'missing')
  const issues: PtoEvidenceIssue[] = []
  let unchecked = false
  for (const artifact of artifacts) {
    const entry = entriesByPath.get(artifact.relativePath)
    if (entry === undefined) continue
    if (entry.size !== undefined && entry.size > maxProbeBytes) {
      unchecked = true
      issues.push({ code: 'probe-size-limit', message: `Artifact exceeds the ${maxProbeBytes} byte profile probe limit.` })
      continue
    }
    try {
      const parsed: unknown = JSON.parse(await fs.readText(entry.target, signal))
      if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as { tasks?: unknown }).tasks)) {
        issues.push({ code: 'unsupported-deps-schema', message: 'deps.json must be an object with a tasks array.' })
      }
    } catch (error: unknown) {
      issues.push({
        code: error instanceof SyntaxError ? 'invalid-json' : 'artifact-unreadable',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }
  if (issues.some(issue => issue.code === 'artifact-unreadable')) {
    return evidenceItem('dependency-graph', artifacts, 'unreadable', issues)
  }
  if (issues.some(issue => issue.code === 'invalid-json' || issue.code === 'unsupported-deps-schema')) {
    return evidenceItem('dependency-graph', artifacts, 'invalid', issues)
  }
  return evidenceItem('dependency-graph', artifacts, unchecked ? 'unchecked' : 'available', issues)
}

function action(
  actionId: string,
  kind: PtoActionReadiness['kind'],
  status: PtoActionReadiness['status'],
  artifactRefs: string[],
  reasons: PtoEvidenceIssue[] = [],
  extra: Pick<PtoActionReadiness, 'adapter' | 'skill'> = {},
): PtoActionReadiness {
  return { actionId, kind, status, artifactRefs, reasons, ...extra }
}

/**
 * Resolve environment-dependent viewer and analysis actions from profile facts.
 * @param profile - fact-only profile at the current record revision.
 * @param environment - available adapters and qualified official Skill identity.
 * @returns readiness and reasons for each supported action.
 */
export function resolvePtoActions(
  profile: PtoRecordProfile,
  environment: PtoActionEnvironment,
): PtoActionReadiness[] {
  const byType = new Map(profile.evidence.map(item => [item.type, item]))
  const deps = byType.get('dependency-graph')
  const dependencyViewer = byType.get('dependency-viewer')
  const memoryMap = byType.get('memory-map')
  const timeline = byType.get('timeline')
  const program = byType.get('program-graph')
  const criticalPath = byType.get('critical-path')
  const ir = byType.get('ir-lowering')
  const irViewer = byType.get('ir-viewer')
  const actions: PtoActionReadiness[] = []

  if (dependencyViewer?.status === 'available') {
    actions.push(action('open.dependency-graph', 'viewer', 'available', dependencyViewer.artifactRefs, [], { adapter: PROFILE_ADAPTER }))
  } else if (deps?.status === 'available' && environment.dependencyRenderer) {
    actions.push(action('open.dependency-graph', 'viewer', 'needs-preparation', deps.artifactRefs, [
      { code: 'viewer-generation-required', message: 'A static dependency viewer must be prepared from deps.json.' },
    ], { adapter: PROFILE_ADAPTER }))
  } else {
    actions.push(action('open.dependency-graph', 'viewer', 'unavailable', deps?.artifactRefs ?? [], [
      ...(deps?.issues ?? []),
      {
        code: deps?.status === 'available' ? 'dependency-renderer-unavailable' : 'dependency-evidence-unavailable',
        message: deps?.status === 'available'
          ? 'No compatible dependency renderer is configured.'
          : 'No compatible dependency graph evidence is available.',
      },
    ]))
  }

  const skill = environment.officialDependencySkill
  if (deps?.status === 'available' && skill !== undefined) {
    actions.push(action('analyze.dependency-redundancy', 'analysis', 'available', deps.artifactRefs, [], {
      skill: { name: 'dependency-redundancy', provider: skill.provider, revision: skill.revision },
    }))
  } else {
    actions.push(action('analyze.dependency-redundancy', 'analysis', 'unavailable', deps?.artifactRefs ?? [], [
      ...(deps?.issues ?? []),
      {
        code: deps?.status !== 'available' ? 'dependency-evidence-unavailable' : 'official-skill-unavailable',
        message: deps?.status !== 'available'
          ? 'No compatible dependency graph evidence is available.'
          : 'The pinned official dependency-redundancy Skill is unavailable.',
      },
    ]))
  }

  for (const [actionId, item] of [
    ['open.memory-map', memoryMap],
  ] as const) {
    actions.push(item?.status === 'available'
      ? action(actionId, 'viewer', 'available', item.artifactRefs, [], { adapter: PROFILE_ADAPTER })
      : action(actionId, 'viewer', 'unavailable', item?.artifactRefs ?? [], [{ code: 'evidence-unavailable', message: 'No supported static HTML artifact is available.' }]))
  }

  actions.push(irViewer?.status === 'available'
    ? action('open.ir-lowering', 'viewer', 'available', irViewer.artifactRefs, [], { adapter: PROFILE_ADAPTER })
    : action('open.ir-lowering', 'viewer', 'unavailable', ir?.artifactRefs ?? [], [{
      code: ir === undefined || ir.artifactRefs.length === 0 ? 'evidence-unavailable' : 'adapter-unavailable',
      message: ir === undefined || ir.artifactRefs.length === 0
        ? 'Required evidence was not observed.'
        : 'IR evidence was observed, but no supported self-contained IR trace HTML was found.',
    }]))

  for (const [actionId, item] of [
    ['open.timeline', timeline],
    ['open.critical-path', criticalPath],
    ['open.program-graph', program],
  ] as const) {
    actions.push(item !== undefined && item.artifactRefs.length > 0
      ? action(actionId, 'viewer', 'unavailable', item.artifactRefs, [{ code: 'adapter-unavailable', message: 'Evidence was observed, but this viewer adapter is not installed.' }])
      : action(actionId, 'viewer', 'unavailable', [], [{ code: 'evidence-unavailable', message: 'Required evidence was not observed.' }]))
  }
  return actions
}

/**
 * Inspect one selected directory as a run or markerless evidence pack.
 * Only bounded metadata and small deps.json inputs are read; discovered code
 * and HTML are never executed by recognition.
 * @param fs - filesystem used for confined reads.
 * @param record - selected directory target.
 * @param relativePath - display path relative to the caller context.
 * @param maxArtifactEntries - maximum inventory entries.
 * @param environment - available adapters and qualified official Skill identity.
 * @param signal - optional cancellation signal.
 * @param maxProbeBytes - maximum bytes per metadata probe.
 * @returns record profile and available actions.
 */
export async function inspectPtoRecord(
  fs: FileSystem,
  record: FsTarget,
  relativePath: string,
  maxArtifactEntries: number,
  environment: PtoActionEnvironment,
  signal?: AbortSignal,
  maxProbeBytes = 8 * 1024 * 1024,
): Promise<PtoRecordInspection> {
  const direct = await childEntries(fs, record, signal)
  const recognition = await recognizeEntries(fs, direct, signal)
  const inventory = await inventoryArtifacts(fs, record, maxArtifactEntries, signal)
  const artifacts: PtoArtifactRef[] = inventory.entries.flatMap((entry) => {
    const type = artifactType(entry.path)
    return type === undefined ? [] : [{
      relativePath: entry.path,
      type,
      ...(entry.version === undefined ? {} : { version: entry.version }),
      ...(entry.size === undefined ? {} : { size: entry.size }),
    }]
  })
  if (recognition === undefined && artifacts.length === 0) {
    throw new Error('Not a PTO data record: no supported run marker or artifact was observed')
  }
  const entriesByPath = new Map(inventory.entries.map(entry => [entry.path, entry]))
  const artifactsOf = (type: string): PtoArtifactRef[] => artifacts.filter(artifact => artifact.type === type)
  const legacyObserved = artifacts.some(artifact => artifact.type === 'program-graph'
    || (artifact.type === 'timeline' && artifact.relativePath.endsWith('merged_swimlane.json')))
  const identityEvidence = recognition === undefined ? [] : [recognition.recognitionMarker]
  const evidence: PtoEvidenceItem[] = [
    await dependencyEvidence(fs, artifactsOf('dependency-graph'), entriesByPath, maxProbeBytes, signal),
    evidenceItem('dependency-viewer', artifactsOf('dependency-viewer'), artifactsOf('dependency-viewer').length === 0 ? 'missing' : 'available'),
    evidenceItem('name-map', artifactsOf('name-map'), artifactsOf('name-map').length === 0 ? 'missing' : 'observed'),
    evidenceItem('timeline', artifactsOf('timeline'), artifactsOf('timeline').length === 0 ? 'missing' : 'observed'),
    evidenceItem('program-graph', artifactsOf('program-graph'), artifactsOf('program-graph').length === 0 ? 'missing' : 'observed'),
    evidenceItem('memory-map', artifactsOf('memory-map'), artifactsOf('memory-map').length === 0 ? 'missing' : 'available'),
    evidenceItem('critical-path', artifactsOf('critical-path'), artifactsOf('critical-path').length === 0 ? 'missing' : 'observed'),
    evidenceItem('ir-viewer', artifactsOf('ir-viewer'), artifactsOf('ir-viewer').length === 0 ? 'missing' : 'available'),
    evidenceItem('ir-lowering', artifactsOf('ir-lowering'), artifactsOf('ir-lowering').length === 0 ? 'missing' : 'observed'),
  ]
  const revision = profileRevision(inventory.entries)
  const profile: PtoRecordProfile = {
    id: `pto:${String(record.targetKey)}`,
    kind: recognition === undefined ? 'evidence-pack' : 'run',
    relativePath,
    displayPath: record.displayPath,
    revision,
    generation: recognition !== undefined ? '3.0' : legacyObserved ? '2.0-pro' : 'unknown',
    runtimeLevel: recognition?.kind === 'l2' ? 'L2' : recognition?.kind === 'l3' ? 'L3' : 'unknown',
    identityEvidence,
    artifacts,
    evidence,
    scan: {
      complete: !inventory.truncated,
      limits: inventory.truncated ? [`maxArtifactEntries=${maxArtifactEntries}`] : [],
    },
  }
  return { profile, actions: resolvePtoActions(profile, environment) }
}

/**
 * Inspect evidence and rerun capabilities without reading artifact contents or inferring causality.
 * @param fs - Filesystem capability used for stable target traversal.
 * @param run - Canonical workspace-contained run target.
 * @param relativePath - Caller-facing run reference retained in the result.
 * @param maxArtifactEntries - Maximum file entries admitted to the bounded inventory.
 * @param signal - Optional cooperative cancellation signal.
 * @returns Recognizer, evidence, and rerun capability observations.
 */
export async function inspectPtoRun(
  fs: FileSystem,
  run: FsTarget,
  relativePath: string,
  maxArtifactEntries: number,
  signal?: AbortSignal,
): Promise<PtoRunInspection> {
  const entries = await childEntries(fs, run, signal)
  const recognition = await recognizeEntries(fs, entries, signal)
  if (recognition === undefined) {
    throw new Error('Not a PyPTO 3.0 run: expected kernel_config.py or orchestration/host_orch.py')
  }
  const inventory = await inventoryArtifacts(fs, run, maxArtifactEntries, signal)
  const paths = inventory.entries.map(entry => entry.path)
  const subBuilds = recognition.kind === 'l3' ? await inspectSubBuilds(fs, entries, signal) : []
  const compiledMeta = matching(paths, path => path === 'compiled_meta.json')
  const subBuildMeta = subBuilds.filter(item => item.rerunFromDir).map(item => `${item.relativePath}/compiled_meta.json`)
  const compileEvidence = matching(paths, path => (
    path.startsWith('passes_dump/')
    || path.startsWith('ptoas/')
    || path.startsWith('kernels/')
  ))
  const compileStatus: PtoRunHealth['compileStatus'] = compileEvidence.length === 0
    ? 'unknown'
    : 'artifacts-observed'

  return {
    relativePath,
    displayPath: run.displayPath,
    kind: recognition.kind,
    recognitionMarker: recognition.recognitionMarker,
    identityStatus: 'unverified',
    artifactInventoryTruncated: inventory.truncated,
    subBuilds,
    runHealth: {
      compileStatus,
      compileEvidence,
      diagnosticArtifacts: matching(paths, path => DIAGNOSTIC_FILE.test(path)),
    },
    capabilities: [
      available('timeline', matching(paths, (_path, basename) => TIMELINE_FILE.test(basename)), DFX_COLLECTION.timeline),
      available('tensorValues', matching(paths, path => path.startsWith('dfx_outputs/args_dump/')), DFX_COLLECTION.tensorValues),
      available('hardwareCounters', matching(paths, path => path === 'dfx_outputs/pmu.csv'), DFX_COLLECTION.hardwareCounters),
      available('taskGraph', matching(paths, path => path === 'dfx_outputs/deps.json'), DFX_COLLECTION.taskGraph),
      available('scopeStats', matching(paths, path => path === 'dfx_outputs/scope_stats/scope_stats.jsonl'), DFX_COLLECTION.scopeStats),
      available('irLowering', matching(paths, path => path.startsWith('passes_dump/'))),
      available('compileHints', matching(paths, path => path === 'report/perf_hints.log')),
      available('memoryAllocation', matching(paths, (_path, basename) => basename === 'memory_map.html')),
      available('criticalPath', matching(paths, (_path, basename) => CRITICAL_PATH_FILE.test(basename) || basename === 'critical_path_report.md')),
    ],
    rerunCapabilities: [
      available('rerunFromDir', [...compiledMeta, ...subBuildMeta]),
      available('rerunFromScript', matching(paths, path => path === 'debug/run.py')),
      { name: 'fullRecompile', status: 'unknown', evidence: [] },
    ],
  }
}
