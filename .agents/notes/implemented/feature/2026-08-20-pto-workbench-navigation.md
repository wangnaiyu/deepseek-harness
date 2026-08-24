# Agent Note: PTO workbench navigation and blank-session layout

Status: implemented

English | [中文](2026-08-20-pto-workbench-navigation.zh.md)

## Problem

The expanded sidebar duplicated New Session as a large shell-level action while the workspace browser owned the rest of session navigation. It had no durable place for run records. On the blank-session surface, the welcome headline and the resident composer shared one centered stack, so the input moved with the decorative content instead of keeping a predictable bottom position. The PTO wordmark was also encoded as an SVG despite being ordinary interface text and a badge.

## Decision

The expanded `sidebar.workspaces` region owns a two-tab navigation surface: Sessions and Run Records. Sessions retains the workspace/session tree and its search, grouping, ordering, add-workspace, and New Session controls. Run Records has a separate tab panel and search presentation without mounting session-tree actions. The collapsed rail retains its direct New Session shortcut because the tab surface does not fit the rail.

The blank-session composer seat remains resident and fills the conversation column. A dedicated welcome area consumes the free space and centers the headline, while the workspace selector and input remain at the bottom. The hero no longer renders a brand-mark fish beside the headline. The conversation scroll container keeps vertical scrolling enabled at every phase.

The PTO brand name renders as semantic HTML styled by a CSS module: the product name and DSH badge remain one visual wordmark without encoding interface text into SVG geometry. The PTO brand package publishes its client bundle and source map so the CSS import is present in packaged builds.

## Alternatives considered

**Keep the expanded New Session capsule in the sidebar shell.** Rejected because it duplicates an action that belongs with the selected Sessions view and leaves the Run Records view under unrelated session chrome.

**Center the welcome copy, workspace selector, and composer as one stack.** Rejected because the resident input should keep a stable, reachable location while the decorative welcome content owns only the remaining space.

**Keep the SVG wordmark.** Rejected because normal text and badge layout is easier to align, theme, test, and package with HTML and CSS.

## Consequences

The expanded sidebar exposes keyboard-navigable tabs and one active tab panel. Switching views clears the current search and closes session-only workspace picking. The Run Records panel's own model and rows arrived later, in [Run Records sidebar information architecture](2026-08-24-run-records-sidebar.md). Existing session behavior is unchanged in the Sessions panel, and collapsed mode still offers one-click New Session.

The blank-session welcome is visually independent from the composer without replacing the textarea subtree during session startup. Narrow or enlarged content can still scroll vertically. The brand wordmark follows browser text rendering and the client package now carries its CSS-backed entry artifacts.

## Testing

Package GUI tests cover the PTO brand, blank-session skeleton, sidebar shell, workspace tabs, keyboard navigation, and session controls. Built Web replay covers assembled brand rendering, startup tree stability, one-axis conversation overflow, sidebar lifecycle chrome, and navigation panes.
