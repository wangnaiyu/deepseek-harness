import { FishLogo } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './Brand.module.css'

type PtoBrandMarkProps = HeroBrandMarkOwnerProps & SidebarBrandMarkOwnerProps

/**
 * Render the PTO mark with the presentation requested by its host surface.
 * @param props - Host-supplied mark presentation.
 * @returns the whale mark (the workbench keeps the whale as its logo).
 */
export function PtoBrandMark({ size, className }: PtoBrandMarkProps) {
  return <FishLogo size={size} className={className} />
}

/**
 * Render the PTO name artwork without its independently slotted mark.
 * @returns the "PTO Agent 工作台" wordmark with a DSH badge plate.
 */
export function PtoBrandName({ t }: PropsLocale<'ptoBrand'>) {
  return (
    <span className={css.root} aria-hidden="true">
      <span className={css.wordmark}>{t('wordmark')}</span>
      <span className={css.badgePlate}>
        <span className={css.badgeText}>{t('badge')}</span>
      </span>
    </span>
  )
}
