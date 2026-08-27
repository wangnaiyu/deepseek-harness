/** Package-owned invariant companion for the PTO experiment dashboard gateway. */
/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-host-pto-experiment-dashboard'
export const name = 'host-pto-experiment-dashboard-invariant'
export const inject = ['invariants']
/** No runtime invariant: registry admission and the gateway's owned controller map close mutations. */
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
