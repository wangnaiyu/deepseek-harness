/** PTO Agent 工作台 occupants for the generic browser-brand slots. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { PtoBrandMark, PtoBrandName } from './Brand.tsx'
import { en, NS, type PtoBrandKey, zh } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** PTO workbench wordmark copy. */
    ptoBrand: PtoBrandKey
  }
}

/** Required services: the UI slot registry and locale dictionary registry. */
export const inject = ['slots', 'locale']

/**
 * Fill every shipped brand slot as one declaration-aware registration set.
 * The workbench fork always presents the PTO brand, so this plugin registers
 * unconditionally (the upstream official plugin stays inert outside its
 * `official` build profile, leaving these holes to this occupant).
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-brand-pto: dictionaries')
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', () =>
      ctx.slots.inject('conversation.hero.brand.mark', function* () {
        yield ctx.slots.register({ name: 'sidebar.brand.mark' }, PtoBrandMark)
        yield ctx.slots.register({ name: 'sidebar.brand.name', locale: NS }, PtoBrandName)
        yield ctx.slots.register({ name: 'conversation.hero.brand.mark' }, PtoBrandMark)
      })))
}
