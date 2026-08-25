/**
 * ui-permission browser half on a real cordis Context with fake command/
 * sessions faces: the plugin hangs the /permission popup decoration on the
 * host command; options flatten the session's permissions projection with
 * the current value active and `custom` excluded; availability follows the
 * projection key's presence; a pick submits the /permission line through
 * Session.command and surfaces rejection/unmatched as thrown errors; fiber
 * disposal removes the contribution (HMR safety). The same plugin registers
 * its Settings row and invalidates that row on host settings changes.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { TestRemote, scriptedSettingsRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { CommandDecoration } from '@deepseek-ai/dsh-client-ui-commands/client'
import type { PermissionSelect } from '@deepseek-ai/dsh-permission-presets/client'
import {
  PermissionRow, type PermissionRowInjected,
} from '../src/client/PermissionRow.tsx'
import type { DraftPermissionSource } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { apply, inject } from '../src/client/index.ts'
import { accessEn, accessZh } from '../src/client/locales.ts'

const sid = (k: string): SessionId => k as SessionId

const SELECT: PermissionSelect = {
  options: [
    { value: 'read-only', name: 'read-only', description: 'Reads only.' },
    { value: 'workspace-write', name: 'workspace-write' },
    { value: 'danger-full-access', name: 'danger-full-access' },
  ],
  currentValue: 'workspace-write',
}

const SETTINGS_SCHEMA = {
  uid: 5,
  refs: {
    1: { type: 'const', value: 'read-only' },
    2: { type: 'const', value: 'workspace-write' },
    3: { type: 'const', value: 'danger-full-access' },
    4: { type: 'union', list: [1, 2, 3] },
    5: { type: 'object', dict: { defaultPreset: 4 } },
  },
}

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry)
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('en')
  ctx.provide('locale', locale)
  const settingsRemote = scriptedSettingsRemote([{
    ns: 'permission', schema: SETTINGS_SCHEMA,
    value: { defaultPreset: 'workspace-write' },
    base: { defaultPreset: 'workspace-write' },
    applies: 'live' as const, secrets: [], revision: 1,
  }], { writable: true })
  const remote = new TestRemote(ctx, { settings: settingsRemote.settings })
  ctx.slots.register({
    name: 'root',
    children: {
      'settings.general.item': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  let decoration: CommandDecoration | undefined
  ctx.provide('commandUi', {
    decorate(c: CommandDecoration) {
      decoration = c
      return () => { decoration = undefined }
    },
  })
  const values = new Map<SessionId, PermissionSelect>()
  const commands: string[] = []
  let commandResult: { ok: boolean; matched?: boolean } = { ok: true, matched: true }
  const session = (id: SessionId) => ({
    projections: {
      faceOf: (key: string) => ({
        getSnapshot: () => (key === 'permissions' ? values.get(id) : undefined),
        subscribe: () => () => {},
      }),
    },
    command: (line: string) => {
      commands.push(line)
      return Promise.resolve(commandResult.ok
        ? { ok: true as const, value: { matched: commandResult.matched ?? true } }
        : { ok: false as const, error: { code: 'gateway/internal', message: 'boom' } })
    },
  })
  ctx.provide('sessions', {
    binding: (id: SessionId) => (values.has(id) ? { sessionId: id, session: session(id) } : undefined),
  })
  let draftPrepare: ((sessionId: SessionId) => Promise<void>) | undefined
  ctx.provide('uiWorkspace', {
    list: createSnapshotStore({ sessionDraft: { revision: 1, cwd: '/host/cwd' } }),
    prepareSessionDraft: (prepare: (sessionId: SessionId) => Promise<void>) => {
      draftPrepare = prepare
      return () => { draftPrepare = undefined }
    },
  } as never)
  let draftSource: DraftPermissionSource | undefined
  ctx.provide('conversation', {
    registerDraftPermissions: (source: DraftPermissionSource) => {
      draftSource = source
      return () => { if (draftSource === source) draftSource = undefined }
    },
  } as never)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return {
    ctx, fiber, locale, values, commands, remote,
    setResult: (r: { ok: boolean; matched?: boolean }) => { commandResult = r },
    decoration: () => decoration,
    permissionRow: () => ctx.slots.entries('settings.general.item')
      .find(entry => entry.component === PermissionRow),
    draftPermission: () => draftSource,
    prepareDraft: (sessionId: SessionId) => draftPrepare?.(sessionId) ?? Promise.resolve(),
  }
}

describe('ui-permission browser plugin', () => {
  it('hangs the /permission popup decoration on the host command', async () => {
    const b = await bench()
    const c = b.decoration()!
    expect(c.name).toBe('permission')
    expect(c.ui.kind).toBe('popupSelect')
    const row = b.permissionRow()!
    expect(row.options).toEqual({ id: 'permission', order: -20 })
    const injected = row.inject?.() as PermissionRowInjected | undefined
    expect(injected?.hooks.permission).toBeDefined()
    expect(typeof injected?.load).toBe('function')
    expect(typeof injected?.select).toBe('function')
    await injected!.load()
    await injected!.select('read-only')
  })

  it('stages a draft permission locally and applies it only after materialization', async () => {
    const b = await bench()
    const settingsFace = b.permissionRow()!.inject?.() as unknown as PermissionRowInjected
    await settingsFace.load()
    expect(settingsFace.hooks.permission.getSnapshot()).toMatchObject({
      status: 'ready', currentValue: 'workspace-write',
    })
    const face = b.draftPermission()!
    face.load()
    await vi.waitFor(() => { expect(face.store.getSnapshot()?.currentValue).toBe('workspace-write') })
    let unchangedNotifications = 0
    const stop = face.store.subscribe(() => { unchangedNotifications += 1 })
    await settingsFace.load()
    expect(unchangedNotifications).toBe(0)
    stop()
    expect(await face.command('/permission read-only')).toBe(true)
    expect(face.store.getSnapshot()?.currentValue).toBe('read-only')
    expect(b.commands).toEqual([])

    b.values.set(sid('materialized'), SELECT)
    await b.prepareDraft(sid('materialized'))
    expect(b.commands).toEqual(['/permission read-only'])
  })

  it('availability follows the projection key; options mark the current value active and exclude custom', async () => {
    const b = await bench()
    const c = b.decoration()!
    const proj = { sessionId: sid('s1') }
    expect(c.available(proj)).toBe(false)
    b.values.set(sid('s1'), { ...SELECT, options: [...SELECT.options, { value: 'custom', name: 'Custom' }], currentValue: 'custom' })
    expect(c.available(proj)).toBe(true)
    const options = await c.ui.options(proj, new AbortController().signal)
    expect(options.map(option => option.id)).toEqual(['read-only', 'workspace-write', 'danger-full-access'])
    expect(options.every(option => option.active !== true)).toBe(true)
    b.values.set(sid('s1'), SELECT)
    const again = await c.ui.options(proj, new AbortController().signal)
    expect(again.find(option => option.id === 'workspace-write')?.active).toBe(true)
    expect(again.find(option => option.id === 'read-only')?.detail).toBe('Reads only.')
    // English built-ins use product labels; other kebab-case names title-case.
    expect(again.map(option => option.label)).toEqual(['Read Only', 'Workspace Write', 'Full access'])
    expect(again.find(option => option.id === 'danger-full-access')?.confirmation).toEqual({
      title: 'Enable Full access?',
      description: accessEn['confirm.description'],
      acknowledgeLabel: 'I understand the risks and want to continue',
      cancelLabel: 'Cancel',
      confirmLabel: 'Enable Full access',
    })
    b.locale.setLocale('zh')
    const localized = await c.ui.options(proj, new AbortController().signal)
    expect(localized.map(option => option.label)).toEqual(['仅可查看', '工作区内修改', '完全权限'])
    expect(localized.find(option => option.id === 'danger-full-access')?.confirmation).toEqual({
      title: '确认启用完全权限？',
      description: accessZh['confirm.description'],
      acknowledgeLabel: '我已了解风险，并愿意继续',
      cancelLabel: '取消',
      confirmLabel: '启用完全权限',
    })
    b.values.set(sid('s1'), { ...SELECT, options: [
      { value: 'workspace-write', name: 'Project Files' },
      { value: 'danger-full-access', name: 'Operator Mode' },
      { value: 'custom-mode', name: 'custom-mode' },
      { value: '__proto__', name: '__proto__' },
      { value: 'plain', name: 'Ask Every Time' },
    ] })
    const passthrough = await c.ui.options(proj, new AbortController().signal)
    expect(passthrough.map(option => option.label)).toEqual([
      'Project Files', 'Operator Mode', 'Custom Mode', '__proto__', 'Ask Every Time',
    ])
    // A projection that vanished between availability and open throws.
    expect(() => c.ui.options({ sessionId: sid('ghost') }, new AbortController().signal))
      .toThrow(/not available on this host/)
  })

  it('a pick submits the /permission line; rejection and unmatched throw', async () => {
    const b = await bench()
    const c = b.decoration()!
    const proj = { sessionId: sid('s1') }
    b.values.set(sid('s1'), SELECT)
    await c.ui.onSelect({ id: 'danger-full-access', label: 'danger-full-access' }, proj)
    expect(b.commands).toEqual(['/permission danger-full-access'])
    b.setResult({ ok: false })
    await expect(c.ui.onSelect({ id: 'read-only', label: 'read-only' }, proj)).rejects.toThrow(/permission switch failed/)
    b.setResult({ ok: true, matched: false })
    await expect(c.ui.onSelect({ id: 'read-only', label: 'read-only' }, proj)).rejects.toThrow(/no \/permission command/)
    // An unmaterialized session throws before any submit.
    await expect(c.ui.onSelect({ id: 'read-only', label: 'read-only' }, { sessionId: sid('ghost') }))
      .rejects.toThrow(/not materialized/)
  })

  it('disposal removes the decoration (HMR safety)', async () => {
    const b = await bench()
    expect(b.decoration()).toBeDefined()
    b.remote.emit('settings/document-updated', ['another', 1])
    b.remote.emit('settings/document-updated', ['permission', 1])
    b.ctx.emit('connection/reset')
    await b.fiber.dispose()
    expect(b.decoration()).toBeUndefined()
    expect(b.permissionRow()).toBeUndefined()
  })
})
