import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as ToolPtoRun from '@deepseek-ai/dsh-tool-pto-run'

describe('dsh-tool-pto-run real-load-path guard', () => {
  it('preserves the namespace plugin contract through Loader unwrapping', async () => {
    expect('default' in ToolPtoRun).toBe(false)
    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(ToolPtoRun) as Record<string, unknown>
    expect(unwrapped).toBe(ToolPtoRun)
    expect(unwrapped.name).toBe('tool-pto-run')
    expect(unwrapped.inject).toEqual(['tools', 'fs', 'systemPrompt'])

    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalFileSystem, { cwd: process.cwd() })
    const fiber = await ctx.plugin(unwrapped as unknown as Parameters<Context['plugin']>[0], {})
    expect(ctx.tools.schemas().map(schema => schema.name)).toEqual([
      'pto_run_discover',
      'pto_run_inspect',
    ])
    await fiber.dispose()
    await ctx.fiber.dispose()
  })
})
