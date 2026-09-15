import { describe, expect, it } from 'vitest'
import { Session, SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionFormatEvent } from '@deepseek-ai/dsh-session-format'
import { SessionFormatEventCollector } from '@deepseek-ai/dsh-session-format'
import { sessionFormatCatalog } from '@deepseek-ai/dsh-session-format-catalog'
import { assertPtoV4Header, ptoV4SessionFormatCodec, sessionFormatV3ToV4 } from '../src/index.ts'

function source() {
  const session = Session.create(SessionId('pto-v3-upgrade'))
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'retained prompt' }], source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  return { session, header: { ...session.header, version: 3, type: 'session', delegationDepth: 0 } }
}

describe('PTO V3 to V4 identity edge', () => {
  it('strictly restores V3 twice with unchanged event identities and rejects a future generation', () => {
    const { session, header } = source()
    const rows = session.snapshotEvents().map(event => ptoV4SessionFormatCodec.encodeEvent(event as unknown as SessionFormatEvent))
    const restore = () => {
      const reader = sessionFormatCatalog.createRestore(header, { recovery: 'strict', validation: 'current' })
      for (const row of rows) reader.decodeRow(row)
      return reader.finish()
    }
    const first = restore()
    expect(first.header.version).toBe(SESSION_FORMAT_VERSION)
    expect(first.events).toEqual(session.snapshotEvents())
    expect(restore()).toEqual(first)
    expect(header.version).toBe(3)
    expect(sessionFormatCatalog.readHeader({ ...header, version: 5 }).status).toBe('unsupported')
  })

  it('refuses malformed headers and unknown required events', () => {
    const { header } = source()
    expect(() => { assertPtoV4Header({ ...header, version: 3 }) }).toThrow('expected format v4')
    expect(() => { ptoV4SessionFormatCodec.decodeHeader({ ...header, version: 4, id: null }) }).toThrow()
    const reader = sessionFormatCatalog.createRestore(header, { recovery: 'strict', validation: 'current' })
    expect(() => {
      reader.decodeRow({ type: 'unknown/required', seq: 0, time: 0, data: {} })
      reader.finish()
    }).toThrow()
  })

  it('keeps independent inherited-cut state and preserves compact run identity', () => {
    const header = { ...source().session.header, version: 3, delegationDepth: 0 }
    const create = () => sessionFormatV3ToV4.createStage({
      sourceHeader: { ...header, isSeeded: true }, targetHeader: { ...header, version: 4, isSeeded: true },
      sourceInheritedEventCount: undefined, sourceKind: 'transformed',
    })
    const first = create()
    const other = create()
    const collector = new SessionFormatEventCollector()
    first.transformEvent({ type: 'session/end-seed', seq: 7, time: 0, data: { inherited: true } }, collector)
    expect(first.finish(collector)).toBe(7)
    expect(() => other.finish(collector)).toThrow('inherited cut')
    const run = { runType: 'assistant', firstSeq: 8, eventCount: 2, *expand() {} }
    let forwarded: unknown
    first.transformRun(run, { emitEvent() { throw new Error('must retain run') }, emitRun(value) { forwarded = value } })
    expect(forwarded).toBe(run)
  })
})
