/** Legacy PTO V4 writes publish verified V5 successors beside immutable originals. */
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, onTestFinished } from 'vitest'
import JsonlSessionPersistence from '../src/index.ts'
import { generationLogPath } from '../src/format.ts'
import { compressZstdFrame } from '../src/zstd.ts'

const id = SessionId('pto-legacy')
const header = { type: 'session', version: 4, id, createdAt: 1, isSeeded: false, delegationDepth: 0 }
const row = { type: 'user/message', seq: 0, time: 2, surfaceOp: 'append', data: {
  id: 'question', role: 'user', source: { kind: 'plugin', plugin: 'legacy-owner', form: 'notice' }, content: [{ type: 'text', text: 'original message' }],
} }

describe.each(['none', 'zstd'] as const)('PTO lineage publication (%s)', (compression) => {
  async function setup(legacyPtoV4: boolean) {
    const root = await mkdtemp(join(tmpdir(), 'dsh-pto-lineage-'))
    const ctx = new Context()
    onTestFinished(async () => { try { await ctx.fiber.dispose() } finally { await rm(root, { recursive: true, force: true }) } })
    const path = generationLogPath(root, undefined, id, 4, compression)
    await mkdir(dirname(path), { recursive: true })
    const lines = [header, row].map(value => JSON.stringify(value) + '\n')
    const bytes = compression === 'none' ? Buffer.from(lines.join('')) : Buffer.concat(await Promise.all(lines.map(compressZstdFrame)))
    await writeFile(path, bytes)
    await ctx.plugin(JsonlSessionPersistence, { root, compression, legacyPtoV4 })
    return { ctx, root, path, bytes }
  }
  it('prepares without writes, publishes once, and reopens natively with original bytes intact', async () => {
    const f = await setup(true)
    const currentPath = generationLogPath(f.root, undefined, id, 5, compression)
    const reader = await f.ctx.sessionPersistence.open(id, 'read')
    const expected = (await reader.read()).events
    expect(reader.header.version).toBe(5)
    expect(expected[0]?.data).toMatchObject({ source: { kind: 'plugin:legacy-owner', form: 'notice' } })
    await reader.close()
    await expect(readFile(currentPath)).rejects.toMatchObject({ code: 'ENOENT' })
    const writer = await f.ctx.sessionPersistence.open(id, 'write')
    expect((await writer.read()).events).toEqual(expected)
    await writer.close()
    expect(await readFile(f.path)).toEqual(f.bytes)
    const successor = await readFile(currentPath)
    expect(successor.length).toBeGreaterThan(0)
    const reopened = await f.ctx.sessionPersistence.open(id, 'read')
    expect((await reopened.read()).events).toEqual(expected)
    await reopened.close()
    expect(await readFile(currentPath)).toEqual(successor)
  })
  it('refuses the legacy body without explicit selection and creates no successor', async () => {
    const f = await setup(false)
    await expect(f.ctx.sessionPersistence.open(id, 'write')).rejects.toThrow()
    expect(await readFile(f.path)).toEqual(f.bytes)
    expect((await readdir(dirname(f.path))).filter(name => name !== 'session.lock')).toHaveLength(1)
  })
})
