// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SubmissionBindings } from '../src/client/submission-bindings.ts'

const binding = { owner: 'analysis', id: 'launch-1', payload: { record: 'record-1' } }
const target = (sessionId?: string) => ({ ...(sessionId === undefined ? {} : { sessionId }), signal: new AbortController().signal })
beforeEach(() => { localStorage.clear() })
afterEach(() => { localStorage.clear() })

it('preserves intent across reload, materialization, admission failure and same-session retry', async () => {
  const source = new SubmissionBindings()
  source.stage(binding, 'question')
  source.edit('edited question')
  const reloaded = new SubmissionBindings()
  const saved = reloaded.read('browser')!
  expect(saved).toMatchObject({ binding, text: 'edited question' })
  const gate = vi.fn().mockRejectedValueOnce(new Error('provider missing')).mockResolvedValue(undefined)
  reloaded.register('analysis', gate)
  reloaded.bind('session-1', saved)
  expect(reloaded.read('browser')).toBeUndefined()
  await expect(reloaded.check(reloaded.read('session-1'), target('session-1'))).rejects.toThrow('provider missing')
  expect(reloaded.read('session-1')?.binding).toEqual(binding)
  const again = new SubmissionBindings()
  again.register('analysis', gate)
  await again.check(again.read('session-1'), target('session-1'))
  expect(gate).toHaveBeenLastCalledWith(binding, expect.objectContaining({ sessionId: 'session-1' }))
})

it('rejects unknown owners and malformed bindings while leaving ordinary sessions alone', async () => {
  const ledger = new SubmissionBindings()
  await ledger.check(ledger.read('ordinary'), target('ordinary'))
  ledger.stage(binding, 'question')
  await expect(ledger.check(ledger.read('browser'), target())).rejects.toThrow('unavailable')
  localStorage.setItem('dsh.conversation.launch.v1.browser', '{"version":1,"text":"question"}')
  expect(() => ledger.read('browser')).toThrow('invalid')
})

it('coalesces concurrent checks and never accepts an aborted waiter', async () => {
  let release!: () => void
  const barrier = new Promise<void>((resolve) => { release = resolve })
  const ledger = new SubmissionBindings()
  const gate = vi.fn(() => barrier)
  ledger.register('analysis', gate)
  ledger.stage(binding, 'question')
  const abort = new AbortController()
  const a = ledger.check(ledger.read('browser'), target())
  const b = ledger.check(ledger.read('browser'), { signal: abort.signal })
  const rejected = expect(b).rejects.toThrow('cancelled')
  abort.abort(new Error('cancelled'))
  release()
  await a
  await rejected
  expect(gate).toHaveBeenCalledTimes(1)
})

it('never discards the browser binding when persisting its materialized identity fails', () => {
  const ledger = new SubmissionBindings()
  ledger.stage(binding, 'question')
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
  try { expect(() =>{  ledger.bind('session-1', ledger.read('browser')!) }).toThrow('quota') }
  finally { write.mockRestore() }
  expect(ledger.read('browser')?.binding.id).toBe('launch-1')
})

it('rejects all concurrent sends if persistence fails after Host admission', async () => {
  let release!: () => void
  const ledger = new SubmissionBindings()
  ledger.stage(binding, 'question')
  ledger.bind('session-1', ledger.read('browser')!)
  ledger.register('analysis', () => new Promise<void>((resolve) => { release = resolve }))
  const first = ledger.check(ledger.read('session-1'), target('session-1'))
  const second = ledger.check(ledger.read('session-1'), target('session-1'))
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
  release()
  try {
    await expect(first).rejects.toThrow('quota')
    await expect(second).rejects.toThrow('quota')
  } finally { write.mockRestore() }
  expect(ledger.read('session-1')?.phase).toBe('pending')
})

it('retains pending identity when cancelled during admission and rejects changed identity', async () => {
  let release!: () => void
  const ledger = new SubmissionBindings()
  ledger.stage(binding, 'question')
  ledger.bind('session-1', ledger.read('browser')!)
  ledger.register('analysis', () => new Promise<void>((resolve) => { release = resolve }))
  const abort = new AbortController()
  const pending = ledger.check(ledger.read('session-1'), { sessionId: 'session-1', signal: abort.signal })
  abort.abort(new Error('cancelled'))
  release()
  await expect(pending).rejects.toThrow('cancelled')
  expect(ledger.read('session-1')?.phase).toBe('pending')
  const retry = ledger.check(ledger.read('session-1'), target('session-1'))
  ledger.stage({ ...binding, id: 'other-launch' }, 'new question')
  ledger.bind('session-1', ledger.read('browser')!)
  release()
  await expect(retry).rejects.toThrow('changed')
})

it('rejects malformed state, disposed owners and unavailable browser storage', async () => {
  const ledger = new SubmissionBindings()
  const off = ledger.register('analysis', async () => {})
  expect(() => ledger.register('analysis', async () => {})).toThrow('already registered')
  off(); off()
  ledger.stage(binding, 'question')
  await expect(ledger.check(ledger.read('browser'), target())).rejects.toThrow('unavailable')
  for (const invalid of [null, {}, { version: 1, text: '', phase: 'pending', binding: { owner: 'analysis' } }]) {
    localStorage.setItem('dsh.conversation.launch.v1.browser', JSON.stringify(invalid))
    expect(() => ledger.read('browser')).toThrow('invalid')
  }
  vi.stubGlobal('localStorage', undefined)
  try {
    expect(ledger.read('ordinary')).toBeUndefined()
    ledger.clearBrowser()
    expect(() =>{  ledger.stage(binding, 'question') }).toThrow('unavailable')
  } finally { vi.unstubAllGlobals() }
})
