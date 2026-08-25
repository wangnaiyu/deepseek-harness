# Agent Note: Host-cwd Ungrouped sessions keep the composer live

Status: implemented

English | [中文](2026-08-24-host-cwd-ungrouped-session-composer.zh.md)

## Problem

The Ungrouped `+` originally called `session.create({})` immediately. Besides making the Host-cwd composer briefly lack its resolved path, that meant a click allocated a Session id and could create a persistence artifact even if the user never sent a message.

This made the Ungrouped row's explicit create action navigate to a real Session whose input remained unusable until the operator selected a Workspace, contradicting the Host-cwd creation contract.

## Decision

Both New Session buttons now create only `WorkspaceListState.sessionDraft`: browser-local text/images, a local revision, and a target Workspace/cwd, with no Session id and no Host call. The Ungrouped action targets the Host cwd already published by the connection handshake; the header action inherits explicit/current/recent Workspace and falls back to that cwd. Workspace picking only retargets the same draft.

The resident no-session composer receives a draft-safe input machine through the standard provide channel. First submit is the sole materialization boundary: it calls `session.create`, opens the returned Session, awaits feature preparation such as a staged Agent Preset, then submits the captured prompt. Create failure keeps the browser draft. Navigation hides every Host `blank` row, so the create-to-prompt interval does not add a sidebar entry.

The pre-Session draft cannot query an Agent-bound command catalog because it has no identity to address. Its leading Command button therefore inserts `/` at the current selection instead of opening that catalog; a typed slash command may still be the first submit, because materialization happens first and the captured line is then handed to the new Session input machine for adjudication against its actual catalog.

Controls whose source is not Agent-bound may remain live without weakening the lifecycle boundary. The model seat loads the Host-scoped `llm.models` catalog and stages the complete selection in browser memory. The Access seat derives its dynamic preset list from the Host Settings descriptor and likewise stages only the picked key. Ordered first-send preparation composes an Agent Preset first, applies staged model and permission choices to the resulting Session, and only then releases the captured prompt. Opening either menu or choosing either value allocates no Session id and writes no Session persistence; Full access still requires explicit risk acknowledgement before it can be staged.

Successful `session.create` responses still include the final resolved `cwd` for every request form. `SessionManager.create()` projects that value immediately for the real Session created at first send.

The blank-session Hero uses a registered Workspace title when one owns the Session and otherwise displays the stable `default` label shared with the Host-cwd persistence bucket. The Workspace chip exposes the exact cwd through its title tooltip. A selected blank Session with a non-empty cwd keeps the textarea editable; the Workspace picker remains available as an optional retarget action. Only no Session, or a provisional Session whose cwd is unavailable, uses the picker-only input posture.

A Session retains this behavior if its Workspace registration is deleted: Workspace membership controls grouping and registry operations, while Session cwd controls the agent's working scope.

The first accepted prompt flips the summary's `blank` flag to false; only that transition reveals and promotes the row in its Workspace or Ungrouped account.

## Alternatives considered

**Create immediately and merely hide the blank row.** This fixes presentation but violates the lifecycle boundary: an abandoned click still allocates identity and may leave storage behind.

**Wait for `session.list` or `host/session-added`.** Both eventually contain cwd, but making input availability depend on an additional echo reintroduces visible latency and ordering sensitivity after the create RPC has already committed the Session.

**Automatically register the Host cwd as a Workspace.** Registration changes durable grouping and account membership. Creating an explicitly Ungrouped Session must not mutate the Workspace registry.

**Require a Workspace for every browser prompt.** The Host supports cwd-scoped Sessions independently of the Workspace registry. Keeping the UI restriction would leave a valid backend capability unusable from its explicit browser entry.

## Consequences

- The `session.create` success value gains a required `cwd` field. The repository is pre-release, so test carriers and fixtures move to the complete response instead of accepting an optional compatibility field.
- Clicking either New Session entry performs no `session.create`, allocates no Session id, and writes no Session persistence artifact.
- The create response and `session.list` expose the same effective cwd after first-send materialization.
- Ungrouped Sessions remain outside Workspace membership and ordering even when their cwd equals a registered Workspace path.
- An expanded empty Ungrouped bucket owns its local empty hint even when other Workspace groups contain Sessions. Blank Sessions do not suppress that hint or render a provisional row.
- Runtime and conversation coverage pins no-create-on-click, first-send materialization, ordered preparation-before-prompt, visible cwd, editable draft input, retained Workspace-picker access, draft model staging, and draft Command insertion.
