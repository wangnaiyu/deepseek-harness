/** Package-owned invariant companion for PTO experiments. @module @deepseek-ai/dsh-pto-experiments/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-pto-experiments'

/** Cordis companion plugin name. */
export const name = 'pto-experiments-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the private service owns every write, storage-domain
 * serializes durability, and the zod schema validates the complete ledger on reopen.
 */
const install: InvariantInstaller = Object.assign(() => {}, { inject: ['ptoExperiments'] })

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
