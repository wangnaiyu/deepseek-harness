import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as ComposerCatalogInvariant from '../src/invariant.ts'
import { apply } from '../src/index.ts'

describe('invariant companion', () => {
  it('reserves package ownership with an empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(ComposerCatalogInvariant).await()).resolves.toBeDefined()
  })

  it('has an empty node half', () => {
    apply()
    expect(typeof apply).toBe('function')
  })
})
