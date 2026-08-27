/**
 * Trigger candidate menu: renders the InputTriggerService menu store into the
 * conversation.input.overlay anchor. Closed state renders null (the overlay
 * slot stays mounted); groups render in roster order under localized title
 * rows, pending groups as a loading row; pointer picks route back through
 * the service (combobox pattern — focus never leaves the textarea, so rows
 * are mousedown-handled and the highlight is exposed via
 * aria-activedescendant on the listbox).
 */
import { Fragment, useEffect, useRef, useSyncExternalStore } from 'react'
import clsx from 'clsx'
import { useAnchoredMaxHeight } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './MenuView.module.css'
import type { MenuViewInjected } from './slots.ts'
import type { MenuKey } from './locales.ts'

/** Full menu props: injected face + the locale seat. */
export type MenuViewProps = MenuViewInjected & PropsLocale<'slash.menu'>

/** Design cap on the list height (figma SLASH 39:26572 MenuDropdown). */
const MAX_HEIGHT = 320
/** Product cap for the visible description, including an explicit ellipsis. */
const DESCRIPTION_LIMIT = 80

function boundedDescription(description: string): string {
  return description.length > DESCRIPTION_LIMIT
    ? `${description.slice(0, DESCRIPTION_LIMIT - 3)}...`
    : description
}

/** DOM id of one option row (the aria-activedescendant target). */
function optionId(source: string, index: number): string {
  return `dsh-slash-option-${source}-${index}`
}

/**
 * Render the candidate menu overlay entry.
 * @param props - injected face (the menu store and the pick route); `t` rides the standard locale seat.
 * @returns the dropdown while open; null while closed.
 */
export function MenuView({ menu, onPick, onDismiss, onRetry = () => {}, t }: MenuViewProps) {
  const state = useSyncExternalStore(
    fn => menu.subscribe(fn),
    () => menu.getSnapshot(),
  )
  const listRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  // The list is bottom-anchored above the composer; clamp the design cap to
  // the space above it, re-measured on every store update (the anchor moves
  // when the composer grows).
  const maxHeight = useAnchoredMaxHeight(listRef, MAX_HEIGHT, state)
  const highlight = state.open ? state.highlight : null
  // Focus stays in the textarea (combobox pattern), so keyboard moves must
  // reveal the active option explicitly. Native scrollIntoView walks every
  // scrollable ancestor and can move the conversation column; constrain the
  // adjustment to the menu's own viewport instead.
  useEffect(() => {
    if (highlight === null) return
    const viewport = viewportRef.current
    const option = document.getElementById(optionId(highlight.source, highlight.index))
    if (viewport === null || option === null) return
    const viewportRect = viewport.getBoundingClientRect()
    const optionRect = option.getBoundingClientRect()
    if (optionRect.top < viewportRect.top) viewport.scrollTop -= viewportRect.top - optionRect.top
    else if (optionRect.bottom > viewportRect.bottom) viewport.scrollTop += optionRect.bottom - viewportRect.bottom
  }, [highlight])
  // Dismiss on pointer outside the menu AND outside the composer card
  // (clicking the textarea or bottom bar must not close the menu).
  useEffect(() => {
    if (!state.open) return
    const onPointerDown = (ev: PointerEvent): void => {
      if (!(ev.target instanceof Node)) return
      if (listRef.current?.contains(ev.target)) return
      const composerCard = listRef.current?.closest('[data-composer-card]')
      if (composerCard?.contains(ev.target)) return
      onDismiss()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => { document.removeEventListener('pointerdown', onPointerDown, true) }
  }, [state.open, onDismiss])
  if (!state.open) return null
  return (
    <div
      ref={listRef}
      className={css.menu}
      style={{ maxHeight }}
      role="listbox"
      aria-label={t('suggestions.aria')}
      aria-activedescendant={highlight !== null ? optionId(highlight.source, highlight.index) : undefined}
    >
      <div ref={viewportRef} className={css.viewport}>
        {state.groups.map(group => (group.status === 'ready' && group.items.length === 0 && (group.issues?.length ?? 0) === 0)
          ? null
          : (
            <Fragment key={group.source}>
              {/* Source names key the dictionary open-endedly: the lookup chain
                  returns an unknown key verbatim, so an unregistered source
                  shows its raw name — hence the cast past the typed key union. */}
              {group.showGroupTitle === false || group.items.some(item => item.section !== undefined)
                ? null
                : <div className={css.groupTitle} role="presentation" data-source={group.source}>{t(group.source as MenuKey)}</div>}
              {group.status === 'pending'
                ? <div className={css.loading} data-source={group.source}>{t('loading')}</div>
                : group.status === 'error'
                  ? <div className={css.issue} data-source={group.source}>
                    <span>{t('failed')}</span>
                    <button type="button" onMouseDown={(ev) => { ev.preventDefault(); onRetry(group.source) }}>{t('retry')}</button>
                  </div>
                  : <>{group.items.map((item, index) => {
                    const active = highlight !== null && highlight.source === group.source && highlight.index === index
                    return (
                      <Fragment key={optionId(group.source, index)}>
                        {item.section !== undefined && item.section !== group.items[index - 1]?.section
                          ? <div className={css.sectionTitle} role="presentation">{item.section}</div>
                          : null}
                        <button
                          id={optionId(group.source, index)}
                          type="button"
                          role="option"
                          aria-selected={active}
                          aria-label={[item.name, item.description, item.origin].filter(Boolean).join(', ')}
                          className={clsx(css.item, active && css.active)}
                          // mousedown, not click: the textarea keeps focus (combobox
                          // pattern) — preventing default stops the focus steal, and the
                          // pick runs before any blur-driven teardown.
                          onMouseDown={(ev) => {
                            ev.preventDefault()
                            onPick(group.source, index)
                          }}
                        >
                          <span className={css.itemIcon} aria-hidden>{item.icon}</span>
                          <span className={css.itemName}>{item.name}</span>
                          {item.description !== undefined && (
                            <span className={css.itemDescription} title={item.description}>
                              {boundedDescription(item.description)}
                            </span>
                          )}
                          {item.origin !== undefined && <span className={css.itemOrigin} title={item.origin}>{item.origin}</span>}
                        </button>
                        {group.issues?.filter(issue => issue.section === (item.section ?? '')
                        && group.items.findLastIndex(row => (row.section ?? '') === issue.section) === index).map(issue => (
                          <div className={css.issue} key={`${issue.section}:${issue.message}`} title={issue.message}>
                            <span>{issue.message}</span>
                            <button type="button" disabled={group.refreshing === true} onMouseDown={(ev) => { ev.preventDefault(); onRetry(group.source) }}>
                              {group.refreshing === true ? t('loading') : t('retry')}
                            </button>
                          </div>
                        ))}
                      </Fragment>
                    )
                  })}
                  {group.issues?.filter(issue => !group.items.some(item => (item.section ?? '') === issue.section)).map(issue => (
                    <Fragment key={`${issue.section}:${issue.message}`}>
                      {issue.section === '' ? null : <div className={css.sectionTitle} role="presentation">{issue.section}</div>}
                      <div className={css.issue} title={issue.message}>
                        <span>{issue.message}</span>
                        <button type="button" disabled={group.refreshing === true} onMouseDown={(ev) => { ev.preventDefault(); onRetry(group.source) }}>
                          {group.refreshing === true ? t('loading') : t('retry')}
                        </button>
                      </div>
                    </Fragment>
                  ))}</>}
            </Fragment>
          ))}
      </div>
    </div>
  )
}
