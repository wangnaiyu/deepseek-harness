import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import type { DraftComposerCatalog } from '@deepseek-ai/dsh-api-remotes/client'
import type { InputTriggerCandidate, InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { InputTriggerService } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { apply, inject } from '../src/client/index.ts'

const catalog: DraftComposerCatalog = {
  revision: 'host-rev',
  commands: [
    { name: 'analyze', description: 'Analyze evidence', origin: { kind: 'pto', label: 'PTO' } },
    { name: 'plan', description: 'Plan work', origin: { kind: 'agent', label: 'Agent' } },
  ],
  skills: [
    { name: 'mine', description: 'Personal workflow', modelInvocable: true, origin: { kind: 'user', label: 'User' } },
    { name: 'evidence', description: 'Collect evidence', modelInvocable: true, origin: { kind: 'pto', label: 'PTO' } },
  ],
  partialErrors: [{ area: 'skills', code: 'partial', message: 'one plugin failed', origin: { kind: 'plugin', label: 'Acme' } }],
}

async function bench(
  result: () => Promise<
    { ok: true; value: DraftComposerCatalog } | { ok: false; error: { code: string; message: string } }
  >,
) {
  const ctx = new Context()
  let source: InputTriggerSource | undefined
  let disposed = false
  ctx.provide('inputTriggers', {
    registerSource(candidate: InputTriggerSource) {
      source = candidate
      return () => { disposed = true }
    },
  })
  const composerCatalog = { listDraft: vi.fn(result) }
  ctx.provide('remote', { composerCatalog })
  ctx.provide('remote.composerCatalog', composerCatalog)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, fiber, source: source!, listDraft: composerCatalog.listDraft, disposed: () => disposed }
}

const target = (revision = '1:workspace') => ({
  kind: 'draft' as const,
  draftRevision: revision,
  workspaceId: 'workspace',
})
const req = (query = '') => ({
  query, position: 'leading' as const, drilled: false, signal: new AbortController().signal,
})

describe('draft composer catalog source', () => {
  it('declares the generated Remote and trigger dependencies', () => {
    expect(inject).toEqual(['remote', 'remote.composerCatalog', 'inputTriggers'])
  })

  it('projects Commands first and Skills second with origin, search, contained errors, and canonical pick text', async () => {
    const b = await bench(() => Promise.resolve({ ok: true, value: catalog }))
    expect(b.source).toMatchObject({ trigger: '/', name: 'composer-catalog', targets: ['draft'], showGroupTitle: false })
    const all = await b.source.candidates(target(), req())
    expect(all.map(row => [row.section ?? '', row.name, row.origin])).toEqual([
      ['', 'analyze', 'PTO'],
      ['', 'plan', 'Agent'],
      ['Skills', 'mine', 'User'],
      ['Skills', 'evidence', 'PTO'],
    ])
    expect(all.issues).toEqual([{ section: 'Skills', message: 'Acme: one plugin failed' }])
    const byOrigin = await b.source.candidates(target(), req('pto'))
    expect(byOrigin.map(row => row.name)).toEqual(['analyze', 'evidence'])
    expect(b.source.onPick({ candidate: all[0]!, session: target(), position: 'leading', via: 'menu', action: 'pick', span: { start: 0, end: 0, draftRev: 1 } }))
      .toEqual({ text: '/analyze ' })
    expect(b.source.onPick({ candidate: all[2]!, session: target(), position: 'leading', via: 'menu', action: 'pick', span: { start: 0, end: 0, draftRev: 1 } }))
      .toEqual({ text: '/skill mine ' })
  })

  it('single-flights one draft revision, refetches a changed target, and disposes cleanly', async () => {
    const b = await bench(() => Promise.resolve({ ok: true, value: catalog }))
    await Promise.all([b.source.candidates(target(), req()), b.source.candidates(target(), req('plan'))])
    expect(b.listDraft).toHaveBeenCalledTimes(1)
    expect(b.listDraft).toHaveBeenCalledWith({ workspaceId: 'workspace' })
    await b.source.candidates(target('1:other-workspace'), req())
    expect(b.listDraft).toHaveBeenCalledTimes(2)
    await b.fiber.dispose()
    expect(b.disposed()).toBe(true)
  })

  it('keeps a Command and Skill with the same name in their own sections and disambiguates pick text', async () => {
    const sameName: DraftComposerCatalog = {
      revision: 'same-name',
      commands: [{ name: 'analyze', description: 'Command', origin: { kind: 'pto', label: 'PTO' } }],
      skills: [{ name: 'analyze', description: 'Skill', modelInvocable: true, origin: { kind: 'pto', label: 'PTO' } }],
    }
    const b = await bench(() => Promise.resolve({ ok: true, value: sameName }))
    const rows = await b.source.candidates(target(), req())
    expect(rows.map(row => [row.section ?? '', row.name])).toEqual([['', 'analyze'], ['Skills', 'analyze']])
    const pick = (candidate: InputTriggerCandidate) => b.source.onPick({
      candidate, session: target(), position: 'leading', via: 'menu', action: 'pick', span: { start: 0, end: 0, draftRev: 1 },
    })
    expect(pick(rows[0]!)).toEqual({ text: '/analyze ' })
    expect(pick(rows[1]!)).toEqual({ text: '/skill analyze ' })
  })

  it('drops a failed cache entry so retry reaches the Host again', async () => {
    let attempt = 0
    const b = await bench(() => {
      attempt += 1
      return Promise.resolve(attempt === 1
        ? { ok: false as const, error: { code: 'offline', message: 'offline' } }
        : { ok: true as const, value: catalog })
    })
    await expect(b.source.candidates(target(), req())).rejects.toThrow(/offline/)
    await expect(b.source.candidates(target(), req())).resolves.toHaveLength(4)
    expect(b.listDraft).toHaveBeenCalledTimes(2)
  })

  it('invalidates a successful partial result before explicit retry', async () => {
    const b = await bench(() => Promise.resolve({ ok: true, value: catalog }))
    const first = await b.source.candidates(target(), req())
    expect(first.issues).toHaveLength(1)
    b.source.retry?.(target())
    await b.source.candidates(target(), req())
    expect(b.listDraft).toHaveBeenCalledTimes(2)
  })

  it('rejects an in-flight pre-reset snapshot instead of publishing it after reconnect', async () => {
    let resolve!: (value: { ok: true; value: DraftComposerCatalog }) => void
    const pending = new Promise<{ ok: true; value: DraftComposerCatalog }>((done) => { resolve = done })
    const b = await bench(() => pending)
    const rows = b.source.candidates(target(), req())
    b.ctx.emit('connection/reset')
    resolve({ ok: true, value: catalog })
    await expect(rows).rejects.toBeDefined()
  })

  it('serves typed `/` and the `+` launcher through one draft controller without creating a Session', async () => {
    const ctx = new Context()
    const create = vi.fn()
    ctx.provide('sessions', { scopeOf: () => undefined, create })
    await ctx.plugin(InputTriggerService)
    const composerCatalog = { listDraft: () => Promise.resolve({ ok: true as const, value: catalog }) }
    ctx.provide('remote', { composerCatalog })
    ctx.provide('remote.composerCatalog', composerCatalog)
    await ctx.plugin({ inject: [...inject], apply }).await()
    let draft = '/'
    let draftRev = 1
    ctx.inputTriggers.bindDraft({
      target,
      apply: (outcome, span) => {
        if (outcome === undefined || outcome === 'handled' || !('text' in outcome) || span.draftRev !== draftRev) return false
        draft = draft.slice(0, span.start) + outcome.text + draft.slice(span.end)
        draftRev += 1
        return true
      },
    })
    const controller = ctx.inputTriggers.draft()!
    controller.track(draft, 1, { tier: 'plain' }, draftRev)
    await vi.waitFor(() => { expect(controller.menu.getSnapshot().groups[0]?.status).toBe('ready') })
    expect(controller.menu.getSnapshot().groups[0]?.items.map(row => row.name)).toEqual(['analyze', 'plan', 'mine', 'evidence'])
    controller.pick('composer-catalog', 0)
    expect(draft).toBe('/analyze ')

    draft = ''
    controller.toggleTrigger({
      trigger: '/', query: '', quoted: false, position: 'leading',
      span: { start: 0, end: 0, draftRev },
    })
    await vi.waitFor(() => { expect(controller.menu.getSnapshot().groups[0]?.status).toBe('ready') })
    controller.pick('composer-catalog', 2)
    expect(draft).toBe('/skill mine ')
    expect(create).not.toHaveBeenCalled()
  })
})
