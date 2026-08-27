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

/** Deployment-owned scan limits. */
export interface ScanLimits {
  maxDepth: number
  maxDirectories: number
  maxRuns: number
  maxArtifactEntries: number
}

const PRUNED_DIRECTORIES = new Set(['.git', 'node_modules', '__pycache__', '3rdparty'])
const TIMELINE_FILE = /^(?:chip_swimlane_records|merged_swimlane(?:_.+)?)\.json$/u
const CRITICAL_PATH_FILE = /^CPM_.+\.json$/u
const DIAGNOSTIC_FILE = /(?:^|\/)(?:[^/]+\.(?:log|err|stderr|stdout)|error\.txt)$/u

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
  paths: string[]
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
  const paths: string[] = []
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
      if (paths.length >= maxEntries) {
        truncated = true
        return { paths, truncated }
      }
      const relativePath = joinRelative(current.relativePath, entry.name)
      if (entry.type === 'file') paths.push(relativePath)
      if (entry.type !== 'directory' || !fs.contains(run, entry.target)) continue
      if (entry.name === 'next_levels' || current.relativePath.startsWith('next_levels')) continue
      if (PRUNED_DIRECTORIES.has(entry.name)) continue
      if (current.depth < 4) queue.push({ target: entry.target, relativePath, depth: current.depth + 1 })
    }
  }
  return { paths, truncated }
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
  const paths = inventory.paths
  const subBuilds = recognition.kind === 'l3' ? await inspectSubBuilds(fs, entries, signal) : []
  const compiledMeta = matching(paths, path => path === 'compiled_meta.json')
  const subBuildMeta = subBuilds.filter(item => item.rerunFromDir).map(item => `${item.relativePath}/compiled_meta.json`)
  const compileEvidence = matching(paths, path => (
    path.startsWith('passes_dump/')
    || path.startsWith('ptoas/')
    || path.startsWith('kernels/')
  ))
  const compileStatus: PtoRunHealth['compileStatus'] = inventory.truncated || recognition.kind === 'l3'
    ? 'unknown'
    : compileEvidence.length === 0
      ? 'incomplete-or-failed'
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
