/** Package-owned invariant companion. @module @deepseek-ai/dsh-client-ui-composer-catalog/invariant */
/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-composer-catalog'
export const name = 'client-ui-composer-catalog-invariant'
export const inject = ['invariants']
/** No runtime invariant: this Client source owns no independent lifecycle stream. */
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
