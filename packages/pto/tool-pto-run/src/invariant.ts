/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-tool-pto-run`.
 * @module @deepseek-ai/dsh-tool-pto-run/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-pto-run'

/** Cordis companion plugin name. */
export const name = 'tool-pto-run-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** No runtime invariant: the read-only tools have no independent lifecycle stream to validate. */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
