/** Package-owned invariant companion for the browser-only PTO experiments UI. */
/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-pto-experiments'
export const name = 'client-ui-pto-experiments-invariant'
export const inject = ['invariants']
/** No runtime invariant: Host admission owns mutations and component generations reject stale completions. */
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
