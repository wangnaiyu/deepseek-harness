# Agent Note: Run Records sidebar information architecture

Status: implemented

English | [中文](2026-08-24-run-records-sidebar.zh.md)

## Problem

The browsing region's second Tab reserved navigation and search chrome under the name Run History but had no model, no rows, and no way for anything to enter it. The name also disagreed with the term the PTO workbench design uses for the object (运行记录 / run record). A run record is a directory of build and runtime artifacts the operator wants to look back through; the workbench needs it listed beside sessions without letting it masquerade as a task start, and without the session tree's ordering and grouping verbs, which a run list detached from a project cannot answer.

## Decision

The Tab is **Run Records**, and its panel is the session tree's structural twin: one section per registered Workspace in Host order, then Ungrouped. Everything else about it is deliberately poorer. Its header offers search alone — no new session, no view options, no grouping. Rows carry no order, no drag, and no click target: the card action set (view artifacts, open the report board, start a session) is a separate design, and until it exists the row must not promise a navigation it does not perform. The rail carries no run records at all, so collapsing the sidebar returns the region to Sessions and drops the run-record query with it rather than letting it filter sessions.

Ungrouped here is an **import bucket**, not the session tree's overflow bucket. It renders even while empty, because the hover-revealed trailing `＋` that opens a run directory hangs on that row and nowhere else; hiding an empty bucket would hide the list's only entry point. Project sections carry no `＋` — the runs under them are scanned, not added by hand — and no Workspace rename/delete menu, which belongs to the Sessions Tab that owns the registration.

Opening a run directory registers a browser-durable record and creates no Workspace; the registration is deferred to the first session started on the record, so a directory looked at once does not enter the Sessions Tab's workspace list. Group attribution is resolved **once, at that moment**: the innermost registered Workspace containing the path, else the bucket. It is then sticky. Registering a parent project later leaves the record where it was opened, and that parent's own scan surfaces the same directory as its own row — two rows for one directory, on purpose, because sessions started from them differ in cwd and therefore in what the agent may write.

Removing a record deregisters it and touches neither the directory nor its contents, the same retention boundary as deleting a Workspace registration, so it confirms the same way. Paths ride the model as opaque locators only — row identity, display label, the value handed to a consumer — and feed no semantic key beyond the open-time containment test.

The open flow reuses the surface's single `sidebar.workspaces.directoryFlow` occupant. `WorkspacePickFlow` gained one optional `adoptPath` callback that replaces Workspace adoption; the two triggers are mutually exclusive by Tab, so one occupant mount still serves both, and a failure lands in the same retryable folder-error dialog.

## Alternatives considered

**Re-evaluate attribution live against the current Workspace list.** Rejected: it contradicts the sticky case the design settles explicitly, and it would silently move a row — and change what a session started from it can write — because an unrelated project was registered.

**Hide the Ungrouped bucket while empty, matching the session tree, and offer a centre-of-panel empty-state button instead.** Rejected: the entry belongs on the row that owns the records, and a second call to action in the body duplicates it.

**Render the directory-flow hole a second time for the run-record trigger.** Rejected: the hole is `single` kind and its occupant renders unconditionally, so a second render site mounts the picking interaction twice.

**Give run-record rows a default click that starts a session.** Rejected: the list is for retrospection and picking. Making the row a task start would fix an action set that is still being designed.

## Consequences

The persisted browser state gained `openedRunRecords` and `runGroupExpansion`; because rehydration replaces state wholesale, the persist key moved from `dsh.workspace.view.v5` to `v6`, resetting grouping and ordering preferences once.

Project sections render empty until the discovery layer's on-demand recognizer scan exists — the tree, the attribution rule, and the row are ready for it, and nothing downstream keys off a path. Attribution compares paths exactly, so a case-insensitive filesystem can place a case-differing path in the bucket instead of its project section.

The native picker backend still titles its dialog `Select Workspace Directory`, which is wrong on the open-run-record path. Correcting it means letting the directory-flow seam carry an owner-supplied purpose, across the Service Definition and both backends; that is left as follow-up rather than widened into this change.

## Testing

Package GUI tests cover the Tab rename, the always-rendered bucket and its exclusive `＋`, opening a picked directory into a containing project and into the bucket, re-open deduplication, removal through the retention-boundary confirmation, label/path filtering, the deregistered-Workspace fallback, and the collapse-to-Sessions reset. A derivation unit spec covers descendant testing, innermost-Workspace attribution in either listed order, section order, fold behavior, sticky attribution, and the filtered view's bucket exemption. Built Web replay snapshots carry the renamed tab.
