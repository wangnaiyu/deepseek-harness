---
description: "Target-neutral conversation assembly and browser shell: event and view registries, per-session bindings, input state, slots, and temporary composer takeovers."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-conversation

English | [中文](README.zh.md)

## Summary

`ui-conversation` owns target-neutral Conversation assembly and the shared browser shell. It consumes Session Controller `SessionEventLikeEntry` feeds, exposes React-free registries and per-Session bindings through `ctx.uiConversation`, and contributes the `useConversation`, `useInput`, and `inputActions` standard props through `ctx.uiSession`. It also owns the per-session durable image URL cache: `ctx.uiConversation.imageUrl(sessionId, attachment)` resolves one session-authorized browser URL per attachment and revokes it with the Session binding, so every Conversation target shares one `session.attachment` read. Concrete targets such as Chat are separate packages that register their own Definitions, snapshot builders, Views, and renderers.

Session-scoped command discovery and controls remain absent while a browser draft has no Agent identity. A manually typed slash command may itself be the first submit: after materialization the captured line is adjudicated again by the real Session command catalog.

Compaction renders as one collapsed row at the checkpoint's flow position without replacing the transcript above it. Automatic compaction uses the context-compacted title. Every completed marker with a loaded `compaction/summary` event shows the replaced-item and estimated-token counts and discloses the summary on click. Manual `/compact` starts as a running `compact` row; on successful settlement its explicit summary-event reference folds that command into the checkpoint row under the same React key. A completed checkpoint keeps the context-compaction icon at rest and replaces it with the collapsed or expanded disclosure only on hover or keyboard focus. Input rejection, no compactable history, cancellation, and failure retain the generic command row and its handler-authored text. Pairing never depends on adjacency because durable context may be injected while compaction is running. The framed checkpoint payload is model-facing and never renders; when the cited `compaction/summary` event is outside the loaded window, the checkpoint remains visible but non-expandable.

The resident conversation shell survives no-session and session transitions. A plain no-selection screen keeps the dashed composer as a Workspace-picker trigger; starting New Session instead installs a browser-only input machine and target cwd with no Session id, so text and images are editable without creating or persisting anything. Picking a Workspace only retargets that draft. Its first submit creates the Host Session, applies staged preparation, and sends the captured prompt; the same textarea DOM survives the transition. A Host-cwd draft and a real Session without registered Workspace ownership both label the chip `default`; its title tooltip still exposes the exact cwd used for execution. The Hero's leading mark is the independent root-scoped `conversation.hero.brand.mark` slot, with the fish mark as its fallback. Separate strict-session header and body outlets fill only after materialization. Blank Host sessions render the same composer body as active sessions but remain absent from navigation until a prompt is accepted. In the active phase the session header shows the current session title, optional lineage controls, and view tabs as ordinary column chrome; ordinary fork lineage remains session data and is not projected into the header. Beneath it the scrollport (`data-conversation-scroll`) holds the flowing views and the sticky composer stack (stats dock + input docks + bar). That scrollport reserves its scrollbar gutter unconditionally, and a view opting into a composer overlay leaves it a scroll container, so the input card keeps one horizontal position whether or not the transcript scrolls and whichever view tab is shown ([decision](../../../.agents/notes/implemented/bug-fix/2026-08-04-composer-tab-gutter-reservation.md)). Wheel over the textarea chains: the capped draft scrolls locally until its edge, then forwards to that host. Safari alone receives a pre-paint recovery when a native edit shortens the draft and leaves stale soft-wrap overflow; draft growth, programmatic updates, and other browsers never read layout for that recovery ([decision](../../../.agents/notes/archived/bug-fix/2026-08-13-safari-textarea-soft-wrap-reflow.md)).

## Table of Contents

- [Conversation assembly](#conversation-assembly)
- [Shell and standard props](#shell-and-standard-props)
- [Temporary composer entries](#temporary-composer-entries)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="conversation-assembly"></a>
## Conversation assembly

`UiConversation.events` is the single registry for event Definitions, and `UiConversation.views` is the single registry for target snapshot builders. Both registries reject duplicate keys, preserve registration order, return idempotent disposers, and rebuild existing bindings when their contribution roster changes. `UiConversation.binding(bindingOrSessionId)` returns one identity-stable Conversation binding for the current Session Controller binding. It does not open another event source.

Approvals take over the composer through the chain this package declares: `ApprovalPanel` registers as a selector-routed `'conversation.composer'` entry (the ui-user-questions pattern) and occupies the composer in place of the InputBar while an approval wait is pending (amber strip, justification headline, paired command line from the running call's args, one-shot refuse/allow). The `PendingApproval` domain face in `contract/slots.ts` owns the wire encoding — the `ApprovalResponsePayload` value with the audit correlation — over the runtime's `PendingWait` carrier; the broadcast `approval/resolved` frame settles the wait and restores the composer. The runtime manager projects every approval or question wait through `SessionSummary.pendingInteraction`, including sessions never instantiated; `ui-workspace` owns its sidebar presentation. Pending waits leave the message flow entirely: questions (ui-user-questions) and approvals (ApprovalPanel) both answer through the composer takeover, so no display-only placeholder card remains. The bottom-row Access control mounts `PermissionSelect`: a real Session reads the host-computed `permissions` projection through the standard-kit `useProjection` (key absence hides the chip), while a New Session draft reads the optional source registered by the permission plugin through `ctx.conversation`. The chip opens a Menu-primitive dropdown whose kebab-case preset names render as title-case labels. Safe real-session picks submit `/permission <preset>` immediately, while draft picks remain local until first-send preparation; `danger-full-access` is presented as `Full access` and first opens an in-page Modal risk confirmation on both paths. The enabling action stays disabled until the user checks the acknowledgement; cancel, Escape, close, and mask click submit nothing.

The adapter passes each `SessionEventLikeEntry` directly to the assembler. Its outer `type` distinguishes scalar and packed records, while its inner `event` always exposes `type`, `seq`, `time`, and `data`; Definitions receive that inner `SessionEventLike`. Historical replace and prepend accept both entry variants, while live append accepts only `SessionLiveEventEntry`. Every Definition uses the same `match` and `update` methods for both event forms, while `start` receives only a standard event and the assembler rejects a packed start. Definitions that do not consume Assistant deltas return `null` for the packed tags. Replacement windows and revision gaps rebuild from the complete loaded window; contiguous append and prepend revisions use incremental assembly without expanding packed members. The assembler owns Context matching, Turn/Step locations, target node materialization, target activity, and stable target sources. `ConversationSnapshot` contains only target-neutral views and active-target facts; Session lifecycle state remains in `SessionSnapshot`.

A target becomes active when shell selection resolves it or when its source receives a first subscriber. The assembler replaces that target from current Contexts once and keeps it active for later incremental flushes; creating a source does not activate it and unsubscription does not deactivate it.

Target packages declaration-merge their snapshot and Location data maps, then register with `ctx.uiConversation.events.register(...)` and `ctx.uiConversation.views.register(...)`. A target reads its Session-owned source with `ctx.uiConversation.binding(binding).target(targetId)`. Registrations are Cordis effects and their returned disposers remove the contribution from the same registry.

<a id="shell-and-standard-props"></a>
## Shell and standard props

The package registers the optional-Session `conversation` shell, strict Session header/body entries, View list, composer chain and bar, input regions, Hero regions, queue dock, draft persistence, and phase calculation. `ctx.uiSession.provide()` materializes the Conversation and input sources from the same Session binding and supplies `inputActions` as a stable standard prop.

View selection is deterministic: a registered persisted selection wins, otherwise registered `chat` wins, otherwise no View renders. It never chooses the first registered View. Shell phase combines Session lifecycle with the active-target set; no target-specific snapshot is read by the shell.

The shell reads the persisted View preference before rendering when a Session first binds or a cached Session becomes current, activates the registered preferred View or Chat fallback, and activates later tab or focus selections before committing them to the store. A blank Session still omits the `conversation.view` slot; no unselected target is activated.

The resident composer survives no-Session and Session transitions. The no-Session state keeps the same composer surface mounted but inert while the Workspace picker connects a blank Session. The surface is a shell-owned Lexical editor: reference chips are atomic decorator nodes carrying the owner's serialization identity (submission expands them through the owner codec), claimed slash commands stay styled leading text, folder text references carry the folder glyph as an icon prefix, and the draft's clipboard projection is mirrored into the per-Session Conversation store. Queue operations address exact queue occurrences through the scoped `ctx.conversation` service; queue previews render sent text through the shared inline reference projection from `ui-primitives` (wire session forms fold to their label) and show local image previews or durable image parts as thumbnails, while an edit exposes the literal sent text. Durable thumbnails resolve through the session image URL cache. Busy Enter behavior is stored in the Host-backed `ui-conversation` settings namespace.

Default sends commit optimistically: Enter clears the draft, occurrence table, and undo history in the same transaction, keeps the composer in `plain`, and runs the send as a detached attempt, so typing and further sends continue during the flight. `sendSession` registers a Session submission echo (`session.beginSubmission`) with the delivery mode before serializing; Session derives the placement from that mode and its current running state, so idle sends use the transcript, busy Queue sends use QueueDock, and busy Steer sends use the pending-steering surface. It then yields one paint and encodes images through the browser's native `FileReader` data-URL path. Concurrent failures are restored together in submission order until the user edits the restored content; command submissions keep the frozen `submitting` phase. Detached attempts retain their image ids through admission and Session scope disposal. When an echo retires as observed, the durable image cache exposes its preview immediately, fetches the admitted attachment, replaces the preview with the canonical URL, and revokes each URL after its use ends. Direct subagent continuations skip local echoes because their transport does not preserve the browser request id.

While a normal composer is running, its primary pointer action remains Stop when the draft is empty or input is unavailable. Actionable text or attachments switch the same seat to Queue Send; clearing or successfully submitting the draft restores Stop. The busy-Enter setting continues to select the Queue or Steer keyboard action. Continuable subagents keep separate Send and Stop actions ([decision](../../../.agents/notes/implemented/bug-fix/2026-08-20-running-draft-primary-send.md)).

<a id="temporary-composer-entries"></a>
## Temporary composer entries

`conversation.composer` is a generic chain. Its complete owner currency is:

```ts type-equiv
/** Owner values used to elect a composer takeover. */
interface ComposerChainProps {
  /** Current Session identity used by temporary business-owned entries. */
  sessionId: SessionId | undefined
  /** Current Session lifecycle state, absent without a selected Session. */
  session: SessionSnapshot | undefined
  /** Effective business-owned interaction awaiting the user in this Session. */
  pendingInteraction: SessionPendingInteraction | undefined
}
```

A business package may install one entry only while a Remote waterfall request is pending:

The composer bar declares a session-scoped single seat for `'conversation.input.plan'` (right of access mode) and a `session-maybe` `'conversation.input.model'` seat (immediately before the pending indicator and send/stop controls), as well as list slots for overlay, dock, left, and right input extensions. Feature packages own each control and its state; ui-conversation supplies placement, the `locked` owner prop, and the standard slot shares. The leading plus button is a Command launcher, not an attachment surface. For a real Session it asks `InputTriggerController` to open only the `/` trigger's `command` source over the current textarea selection, while ui-input-trigger's existing `MenuView` remains the sole floating menu and pick path. A browser-only New Session draft has no Agent command directory, so the same button inserts `/` at the current selection and restores the caret; first submit materializes the Session before the captured command is adjudicated. Neither path adds a file row, file input, upload protocol, or second menu component. While the `plan` projection's effective target is plan mode, InputBar swaps its textarea placeholder to the plan-task wording, localized through the `conversation` locale namespace this package registers (the `placeholder.plan` / `hint.plan` keys) and shared verbatim with the claimed `/plan` command hint (a host-folded value read through the standard-kit `useProjection`; owner-supplied placeholders win). A pending composer takeover remains mounted when another conversation view is active so the blocked agent can still receive its answer; without a pending interaction, the active-session composer belongs to Chat. The composer-bar slot itself is `session-maybe`: a plain no-selection screen keeps message actions inert and opens the Workspace picker, while a New Session draft supplies a live browser-only input machine, the Command insertion path, service-backed permission staging, and draft-safe model selection. The bar never swaps in a parallel tree, so the textarea DOM survives Workspace selection and first-send materialization; controls that require an addressed Session remain empty until one exists.

```tsx
import type { ComposerChainProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChainSelect, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

interface Request {
  readonly sessionId: SessionId
}

type RequestComposerProps =
  PropsRuntime<'conversation.composer'> & { matched: Request }

const select: ChainSelect<ComposerChainProps, Request> = owner =>
  owner.sessionId === request.sessionId ? request : null

const dispose = ctx.slots.register(
  { name: 'conversation.composer', select },
  RequestComposer,
)

try {
  return await request.result
} finally {
  dispose()
}
```

The selector must be a pure function of the owner currency. Its non-null return is delivered to the component as `matched`; `PropsRuntime<'conversation.composer'>` supplies the standard Session and global props. Chain order remains ascending `priority`, then registration order, and the first non-null selector wins. The shell keeps the default composer mounted beneath a takeover. Request state, listeners, response encoding, and any request-specific child slots belong to the business package; they are not carried by `SessionSnapshot` or declared by this core package.

<a id="model-experience"></a>
## Model Experience

None, as this package renders browser state and sends user-admitted inputs through Session Controller APIs without constructing model requests.

#### KV Cache effect

None; Conversation assembly and browser input state do not alter provider-side prompt caching.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Only registered targets can render** — the shell deliberately has no implicit fallback target beyond the registered `chat` preference.


<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. Conversation Definitions, target builders, and Views are already validated by their owning registries and the Slot ledger.
