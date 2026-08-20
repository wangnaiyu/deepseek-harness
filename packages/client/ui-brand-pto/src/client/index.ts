/** PTO Agent 工作台 occupants for the generic browser-brand slots. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { PtoBrandMark, PtoBrandName } from './Brand.tsx'

/** Required service: the UI slot registry. */
export const inject = ['slots']

/**
 * Fill every shipped brand slot as one declaration-aware registration set.
 * The workbench fork always presents the PTO brand, so this plugin registers
 * unconditionally (the upstream official plugin stays inert outside its
 * `official` build profile, leaving these holes to this occupant).
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', () =>
      ctx.slots.inject('conversation.hero.brand.mark', function* () {
        yield ctx.slots.register({ name: 'sidebar.brand.mark' }, PtoBrandMark)
        yield ctx.slots.register({ name: 'sidebar.brand.name' }, PtoBrandName)
        yield ctx.slots.register({ name: 'conversation.hero.brand.mark' }, PtoBrandMark)
      })))
}
