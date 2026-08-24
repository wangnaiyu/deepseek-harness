import { describe, expect, it } from 'vitest'
import type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { OpenedRunRecord } from '../src/client/runRecords.ts'
import { containingGroupKey, deriveRunRecordGroups, isDescendantPath } from '../src/client/runRecords.ts'
import { UNGROUPED_KEY } from '../src/client/tree.ts'

const workspace = (id: string, path: string): WorkspaceView => ({
  workspaceId: id as WorkspaceId, path, title: id, sessionIds: [],
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
})
const record = (path: string, groupKey: string, openedAt: number): OpenedRunRecord => ({ path, groupKey, openedAt })

describe('isDescendantPath', () => {
  it('accepts strict descendants under either separator', () => {
    expect(isDescendantPath('/projects/alpha/build_output/mm', '/projects/alpha')).toBe(true)
    expect(isDescendantPath('/projects/alpha/build_output/mm', '/projects/alpha/')).toBe(true)
    expect(isDescendantPath('C:\\projects\\alpha\\out', 'C:\\projects\\alpha')).toBe(true)
  })

  it('rejects the directory itself, a name-prefix sibling, and an empty ancestor', () => {
    expect(isDescendantPath('/projects/alpha', '/projects/alpha')).toBe(false)
    expect(isDescendantPath('/projects/alpha-2/out', '/projects/alpha')).toBe(false)
    expect(isDescendantPath('/projects/beta/out', '/projects/alpha')).toBe(false)
    expect(isDescendantPath('/projects/alpha/out', '')).toBe(false)
  })
})

describe('containingGroupKey', () => {
  it('resolves the innermost containing workspace in either listed order', () => {
    const workspaces = [workspace('outer', '/projects'), workspace('inner', '/projects/alpha')]
    expect(containingGroupKey('/projects/alpha/build_output/mm', workspaces)).toBe('inner')
    expect(containingGroupKey('/projects/beta/build_output/mm', workspaces)).toBe('outer')
    // The nested workspace listed first must not be widened by the outer one.
    expect(containingGroupKey('/projects/alpha/build_output/mm', [...workspaces].reverse())).toBe('inner')
  })

  it('falls back to the import bucket with nothing containing the path', () => {
    expect(containingGroupKey('/elsewhere/mm', [workspace('alpha', '/projects/alpha')])).toBe(UNGROUPED_KEY)
  })
})

describe('deriveRunRecordGroups', () => {
  const alpha = workspace('alpha', '/projects/alpha')

  it('renders the import bucket even with no records at all', () => {
    const groups = deriveRunRecordGroups([], [], { expandedGroups: [] })
    expect(groups).toHaveLength(1)
    expect(groups[0]?.key).toBe(UNGROUPED_KEY)
    expect(groups[0]?.project).toBeUndefined()
    expect(groups[0]?.recordCount).toBe(0)
  })

  it('lists every workspace section in Host order before the bucket', () => {
    const groups = deriveRunRecordGroups([alpha, workspace('beta', '/projects/beta')], [], { expandedGroups: [] })
    expect(groups.map(group => group.key)).toEqual(['alpha', 'beta', UNGROUPED_KEY])
  })

  it('lists a group\u2019s records newest-open first, and only while expanded', () => {
    const records = [
      record('/projects/alpha/out/first', 'alpha', 1),
      record('/projects/alpha/out/second', 'alpha', 2),
    ]
    const folded = deriveRunRecordGroups([alpha], records, { expandedGroups: [] })
    expect(folded[0]?.recordCount).toBe(2)
    expect(folded[0]?.records).toEqual([])

    const open = deriveRunRecordGroups([alpha], records, { expandedGroups: ['alpha'] })
    expect(open[0]?.records.map(node => node.label)).toEqual(['second', 'first'])
    expect(open[0]?.records[0]?.id).toBe('/projects/alpha/out/second')
    expect(open[0]?.project).toEqual({
      workspaceId: 'alpha', cwd: '/projects/alpha', createdAt: Date.parse('2026-01-01T00:00:00.000Z'),
    })
    expect(deriveRunRecordGroups([alpha], records, { expandedGroups: [] })[1]?.project).toBeUndefined()
  })

  it('keeps a record whose workspace registration is gone, in the bucket', () => {
    const groups = deriveRunRecordGroups([], [record('/projects/alpha/out/mm', 'alpha', 1)], {
      expandedGroups: [UNGROUPED_KEY],
    })
    expect(groups[0]?.records.map(node => node.label)).toEqual(['mm'])
  })

  it('keeps an opened record where it was opened after its parent is registered', () => {
    // Sticky attribution: the record was opened while nothing contained it,
    // so registering /projects/alpha later does not move its row.
    const groups = deriveRunRecordGroups([alpha], [record('/projects/alpha/out/mm', UNGROUPED_KEY, 1)], {
      expandedGroups: ['alpha', UNGROUPED_KEY],
    })
    expect(groups[0]?.records).toEqual([])
    expect(groups[1]?.records.map(node => node.label)).toEqual(['mm'])
  })

  it('filters by label or path and drops project sections without a match', () => {
    const records = [
      record('/projects/alpha/out/mm_1', 'alpha', 1),
      record('/elsewhere/gemm_2', UNGROUPED_KEY, 2),
    ]
    const view = { expandedGroups: ['alpha', UNGROUPED_KEY] }

    const byLabel = deriveRunRecordGroups([alpha], records, { ...view, query: '  MM_1 ' })
    expect(byLabel.map(group => group.key)).toEqual(['alpha', UNGROUPED_KEY])
    expect(byLabel[1]?.records).toEqual([])

    const byPath = deriveRunRecordGroups([alpha], records, { ...view, query: '/elsewhere' })
    // The bucket always survives the filter; the project section does not.
    expect(byPath.map(group => group.key)).toEqual([UNGROUPED_KEY])
    expect(byPath[0]?.records.map(node => node.label)).toEqual(['gemm_2'])
  })
})
