/**
 * Run-record tree derivation: the browsing region's second Tab, structurally
 * isomorphic to the session tree — one section per registered Workspace in
 * Host order, then Ungrouped.
 *
 * Two facts separate it from {@link ./tree.ts}:
 *
 * - **Ungrouped is an import bucket, not an overflow bucket.** The session
 *   tree renders Ungrouped only when loose sessions exist; here it renders
 *   unconditionally, because it carries the "open a run record" entry — the
 *   only way a record enters the list at all. An all-empty list that hid the
 *   bucket would hide its own entry point.
 * - **Attribution is decided once, at open time.** A record opened while no
 *   registered Workspace contained it stays in Ungrouped even after its
 *   parent project is registered later; that parent's own scan surfaces the
 *   same directory as its own row under the project group. The two rows are
 *   deliberate: sessions started from them differ in cwd, so they differ in
 *   what the agent may write.
 *
 * Paths ride the model as opaque locators only (row identity, display label,
 * the value handed to a consumer). No downstream key is derived from path
 * structure beyond the open-time containment test below.
 */
import type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { UNGROUPED_KEY, workspaceLabel } from './tree.ts'

/** One explicitly opened run directory, as persisted by the browser store. */
export interface OpenedRunRecord {
  /** Canonical absolute host path of the run directory (opaque locator). */
  path: string
  /** Group resolved when the record was opened: a Workspace id, or {@link UNGROUPED_KEY}. */
  groupKey: string
  /** Epoch ms of the open gesture; the list orders newest first. */
  openedAt: number
}

/** One run-record row. */
export interface RunRecordNode {
  /** Row identity — the canonical path, carried as an opaque locator. */
  id: string
  path: string
  /** Display label: the directory basename. */
  label: string
  openedAt: number
}

/** The backing Workspace of a project section; the import bucket has none. */
export interface RunRecordProject {
  workspaceId: WorkspaceId
  /** Registered directory path (opaque locator, shown in the hover card). */
  cwd: string
  /** Workspace creation time, epoch ms. */
  createdAt: number
}

/** One run-record group section: header row facts plus its visible rows. */
export interface RunRecordGroupNode {
  /** Group key: the Workspace id, or {@link UNGROUPED_KEY} for the import bucket. */
  key: string
  /** Backing Workspace facts; absent exactly for the import bucket. */
  project: RunRecordProject | undefined
  label: string
  expanded: boolean
  /** Total records in the group, folded or not. */
  recordCount: number
  /** Visible record rows (empty while the group is folded). */
  records: readonly RunRecordNode[]
}

/** Viewing state consumed by the derivation. */
export interface RunRecordView {
  expandedGroups: readonly string[]
  /** Trimmed filter text; an empty string lists everything. */
  query?: string
}

/** Drop trailing separators so a directory and its slashed form compare equal. */
function withoutTrailingSeparators(path: string): string {
  return path.replace(/[/\\]+$/, '')
}

/**
 * Whether `path` names a location inside `ancestor` (strict descendant; both
 * separators accepted, since the Host may be Windows). Comparison is exact:
 * a case-insensitive filesystem is not modeled here, so a case-differing
 * path lands in Ungrouped rather than being claimed by a project group.
 * @param path - candidate descendant path.
 * @param ancestor - candidate ancestor directory path.
 * @returns whether the candidate lies strictly below the ancestor.
 */
export function isDescendantPath(path: string, ancestor: string): boolean {
  const base = withoutTrailingSeparators(ancestor)
  if (base === '') return false
  const target = withoutTrailingSeparators(path)
  if (!target.startsWith(base)) return false
  const separator = target.charAt(base.length)
  return separator === '/' || separator === '\\'
}

/**
 * Resolve the group a newly opened run directory belongs to: the innermost
 * registered Workspace containing it, else the import bucket. Called once per
 * open gesture — the answer is then persisted with the record (see the module
 * doc on sticky attribution).
 * @param path - canonical absolute path of the opened run directory.
 * @param workspaces - registered Workspaces in Host order.
 * @returns the Workspace id as a group key, or {@link UNGROUPED_KEY}.
 */
export function containingGroupKey(path: string, workspaces: readonly WorkspaceView[]): string {
  let innermost: WorkspaceView | undefined
  for (const workspace of workspaces) {
    if (!isDescendantPath(path, workspace.path)) continue
    if (innermost === undefined || workspace.path.length > innermost.path.length) innermost = workspace
  }
  return innermost === undefined ? UNGROUPED_KEY : innermost.workspaceId
}

/** Case-insensitive match over the row's two user-visible strings. */
function matchesQuery(record: OpenedRunRecord, label: string, query: string): boolean {
  if (query === '') return true
  const needle = query.toLowerCase()
  return label.toLowerCase().includes(needle) || record.path.toLowerCase().includes(needle)
}

/**
 * Derive the run-record tree sections.
 *
 * Every registered Workspace contributes a section in Host order, and the
 * import bucket always trails them — including when it is empty, because it
 * carries the open entry. A record whose stored group key names a Workspace
 * that is no longer registered falls back to the bucket rather than
 * disappearing (deleting a Workspace registration must not delete records).
 * While a query is active, project sections without a match are dropped; the
 * bucket still renders so the open entry stays reachable.
 * @param workspaces - registered Workspaces in Host order.
 * @param records - persisted explicitly opened run records.
 * @param view - expansion keys plus the active filter text.
 * @returns group sections in render order.
 */
export function deriveRunRecordGroups(
  workspaces: readonly WorkspaceView[],
  records: readonly OpenedRunRecord[],
  view: RunRecordView,
): RunRecordGroupNode[] {
  const expanded = new Set(view.expandedGroups)
  const query = (view.query ?? '').trim()
  const registered = new Set<string>(workspaces.map(workspace => workspace.workspaceId as string))
  const byGroup = new Map<string, RunRecordNode[]>()
  for (const record of [...records].sort((a, b) => b.openedAt - a.openedAt)) {
    const label = workspaceLabel(record.path)
    if (!matchesQuery(record, label, query)) continue
    const key = registered.has(record.groupKey) ? record.groupKey : UNGROUPED_KEY
    const rows = byGroup.get(key)
    const node: RunRecordNode = { id: record.path, path: record.path, label, openedAt: record.openedAt }
    if (rows === undefined) byGroup.set(key, [node])
    else rows.push(node)
  }

  const section = (key: string, project: RunRecordProject | undefined, label: string): RunRecordGroupNode => {
    const rows = byGroup.get(key) ?? []
    const open = expanded.has(key)
    return { key, project, label, expanded: open, recordCount: rows.length, records: open ? rows : [] }
  }

  const groups: RunRecordGroupNode[] = []
  for (const workspace of workspaces) {
    // A filtered view lists only sections that answer the query; an unfiltered
    // one lists every project so the tree stays isomorphic to the session tree.
    if (query !== '' && (byGroup.get(workspace.workspaceId) ?? []).length === 0) continue
    groups.push(section(
      workspace.workspaceId,
      { workspaceId: workspace.workspaceId, cwd: workspace.path, createdAt: Date.parse(workspace.createdAt) },
      workspace.title,
    ))
  }
  groups.push(section(UNGROUPED_KEY, undefined, ''))
  return groups
}
