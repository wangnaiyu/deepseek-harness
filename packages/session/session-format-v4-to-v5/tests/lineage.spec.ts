import { describe, expect, it } from 'vitest'
import { createSessionFormatCatalogWithChildren, sessionFormatCatalog } from '@deepseek-ai/dsh-session-format-catalog'
import { ptoV5SessionFormatCodec, restorePtoV5Artifact } from '../src/index.ts'
import type { SessionFormatEvent, SessionFormatHeader, SessionFormatJsonObject } from '@deepseek-ai/dsh-session-format'

const header: SessionFormatHeader = { version: 4, id: 'pto-upgrade', createdAt: 1, isSeeded: false, delegationDepth: 0 }
const user: SessionFormatEvent = { type: 'user/message', seq: 0, time: 2, surfaceOp: 'append', data: {
  role: 'user', id: 'question', source: { kind: 'pto-artifact-analysis', form: 'instructions', receipt: {
    requestId: 'request', sessionId: header.id, recordId: 'record', recordRevision: 'revision', actionId: 'deps', artifactRefs: ['deps.json'],
    skill: { name: 'analyze', provider: 'official', revision: 'fixed-skill' }, tool: { name: 'deps_viewer', revision: 'fixed-tool' },
  } }, content: [{ type: 'text', text: 'Inspect this record' }],
} }
const legacyUser: SessionFormatEvent = { ...user, data: { ...user.data as SessionFormatJsonObject, source: { kind: 'plugin', plugin: 'test-owner', form: 'notice' } } }
function restore(legacy: boolean, rows: readonly SessionFormatEvent[]) {
  const reader = createSessionFormatCatalogWithChildren([], legacy).createRestore({ type: 'session', ...header }, { recovery: 'strict', validation: 'current' })
  for (const row of rows) reader.decodeRow(row)
  return reader.finish()
}

describe('PTO format lineage upgrade', () => {
  it('requires explicit legacy selection and converts old plugin sources without modifying input', () => {
    const before = structuredClone(legacyUser)
    expect(() => restore(false, [legacyUser])).toThrow()
    const artifact = restore(true, [legacyUser])
    expect(artifact.header.version).toBe(5)
    expect(artifact.events[0]?.data).toMatchObject({ source: { kind: 'plugin:test-owner', form: 'notice' } })
    expect(legacyUser).toEqual(before)
  })
  it.each([false, true])('preserves PTO analysis metadata through lineage %s and native V5 re-open', (legacy) => {
    const artifact = restore(legacy, [user])
    const reader = sessionFormatCatalog.createRestore(ptoV5SessionFormatCodec.encodeHeader(artifact.header, artifact.inheritedEventCount), { recovery: 'strict', validation: 'current' })
    for (const event of artifact.events) reader.decodeRow(ptoV5SessionFormatCodec.encodeEvent(event))
    expect(reader.finish()).toEqual(artifact)
    expect(artifact.events[0]?.data).toEqual(user.data)
  })
  it('validates current delivery ownership including inherited upstream V4 coordinates', () => {
    const marker: SessionFormatEvent = { type: 'session-log-deepseek/delivery-accepted', seq: 1, time: 3,
      data: { sessionId: 'wrong', throughSeq: 0, sessionFormatVersion: 5 } }
    const artifact = { header: { ...header, version: 5 }, inheritedEventCount: 0, events: [user, marker] }
    expect(() => restorePtoV5Artifact(artifact, new Set(['user/message', marker.type]))).toThrow('wrong Session')
    expect(() => restorePtoV5Artifact({ ...artifact, events: [user, { ...marker, data: { sessionId: 'wrong', throughSeq: 0, sessionFormatVersion: 4 } }] }, new Set(['user/message', marker.type]))).toThrow('wrong Session')
  })
})
