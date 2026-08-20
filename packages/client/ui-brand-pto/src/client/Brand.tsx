import { FishLogo } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'

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
export function PtoBrandName() {
  return (
    <svg
      width={156}
      height={24}
      viewBox="26 0 156 24"
      fill="none"
      aria-hidden="true"
    >
      <text
        x="29"
        y="12"
        dominantBaseline="central"
        fontSize="11.5"
        fontWeight="600"
        fill="currentColor"
        fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Helvetica, Arial, sans-serif"
      >PTO Agent 工作台</text>
      <rect x="129.348" y="5.5" width="52" height="14" rx="2" fill="currentColor"/>
      <text
        x="155.348"
        y="12.5"
        dominantBaseline="central"
        textAnchor="middle"
        fontSize="9.5"
        fontWeight="700"
        fill="var(--dsw-alias-label-primary-inverted)"
        fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Helvetica, Arial, sans-serif"
      >DSH</text>
    </svg>
  )
}
