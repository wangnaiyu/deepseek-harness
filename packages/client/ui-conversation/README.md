---
description: "Target-neutral conversation assembly and browser shell: event and view registries, per-session bindings, input state, slots, and temporary composer takeovers."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-conversation

English | [中文](README.zh.md)

## Summary

`ui-conversation` owns target-neutral Conversation assembly and the shared browser shell. It consumes Session Controller `SessionEventLikeEntry` feeds, exposes React-free registries and per-Session bindings through `ctx.uiConversation`, and contributes the `useConversation`, `useInput`, and `inputActions` standard props through `ctx.uiSession`. It also owns the per-session durable image URL cache: `ctx.uiConversation.imageUrl(sessionId, attachment)` resolves one session-authorized browser URL per attachment and revokes it with the Session binding, so every Conversation target shares one `session.attachment` read. Concrete targets such as Chat are separate packages that register their own Definitions, snapshot builders, Views, and renderers.

## Table of Contents

- [Package behavior](#package-behavior)
- [Conversation assembly](#conversation-assembly)
- [Shell and standard props](#shell-and-standard-props)
- [Temporary composer entries](#temporary-composer-entries)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="package-behavior"></a>
## Package behavior

Session-scoped command discovery and controls remain absent while a browser draft has no Agent identity. A manually typed slash command or canonical Skill gesture may itself be the first submit: after materialization the captured line is compared with the real Session capability catalog. A disappearance, source/policy change, or newly introduced command/Skill conflict rejects before prompt submission; the payload stays in the now-visible real Session composer for correction and retry.

A New Session keeps its target cwd, text, and attachments in a browser draft until first submit materializes a Host Session. Workspace selection retargets the draft. Generic files upload to the materialized Session before prompt submission. A rejected formal capability admission retains the payload in the real Session composer for correction. The root-scoped `conversation.hero.brand.mark` slot supplies the Hero mark. Host-cwd drafts and Sessions without registered Workspace ownership display `default`, with the exact cwd in the tooltip.

<a id="conversation-assembly"></a>
## Conversation assembly

`UiConversation.events` is the single registry for event Definitions, and `UiConversation.views` is the single registry for target snapshot builders. Both registries reject duplicate keys, preserve registration order, return idempotent disposers, and rebuild existing bindings when their contribution roster changes. `UiConversation.binding(bindingOrSessionId)` returns one identity-stable Conversation binding for the current Session Controller binding. It does not open another event source.

Approvals take over the composer through the chain this package declares: `ApprovalPanel` registers as a selector-routed `'conversation.composer'` entry (the ui-user-questions pattern) and occupies the composer in place of the InputBar while an approval wait is pending (amber strip, justification headline, paired command line from the running call's args, one-shot refuse/allow). The `PendingApproval` domain face in `contract/slots.ts` owns the wire encoding — the `ApprovalResponsePayload` value with the audit correlation — over the runtime's `PendingWait` carrier; the broadcast `approval/resolved` frame settles the wait and restores the composer. The runtime manager projects every approval or question wait through `SessionSummary.pendingInteraction`, including sessions never instantiated; `ui-workspace` owns its sidebar presentation. Pending waits leave the message flow entirely: questions (ui-user-questions) and approvals (ApprovalPanel) both answer through the composer takeover, so no display-only placeholder card remains. The bottom-row Access control mounts `PermissionSelect`: a real Session reads the host-computed `permissions` projection through the standard-kit `useProjection` (key absence hides the chip), while a New Session draft reads the optional source registered by the permission plugin through `ctx.conversation`. The chip opens a Menu-primitive dropdown whose kebab-case preset names render as title-case labels. Safe real-session picks submit `/permission <preset>` immediately, while draft picks remain local until first-send preparation; `danger-full-access` is presented as `Full access` and first opens an in-page Modal risk confirmation on both paths. The enabling action stays disabled until the user checks the acknowledgement; cancel, Escape, close, and mask click submit nothing.

The adapter passes each `SessionEventLikeEntry` directly to the assembler. Its outer `type` distinguishes durable events from Client-only transient events, while its inner `event` always exposes `type`, `seq`, `time`, and `data`; Definitions receive that inner `SessionEventLike`. Replacement windows may include both entry variants, while historical prepends carry durable entries and live appends may carry either. Every Definition uses the same `match` and `update` methods for both event forms, while `start` receives only a durable event and the assembler rejects a transient start. Definitions that do not consume Assistant deltas return `null` for `assistant/live-chunk`. Replacement windows and revision gaps rebuild from the complete loaded window; contiguous append, prepend, and Assistant-settlement revisions use incremental assembly. Settlement removes only the named attempt's transient matches, applies its optional durable entry, and replays the affected Contexts and dependents without replacing unrelated target nodes. The assembler owns Context matching, Turn/Step locations, target node materialization, target activity, and stable target sources. `ConversationSnapshot` contains only target-neutral views and active-target facts; Session lifecycle state remains in `SessionSnapshot`.

A target becomes active when shell selection resolves it or when its source receives a first subscriber. The assembler replaces that target from current Contexts once and keeps it active for later incremental flushes; creating a source does not activate it and unsubscription does not deactivate it.

Target packages declaration-merge their snapshot and Location data maps, then register with `ctx.uiConversation.events.register(...)` and `ctx.uiConversation.views.register(...)`. A target reads its Session-owned source with `ctx.uiConversation.binding(binding).target(targetId)`. Registrations are Cordis effects and their returned disposers remove the contribution from the same registry. The shared request inspection serves every target: `ctx.uiConversation.inspectSystemPrompt(previous, event)` interprets system messages and positional replacements as immutable loaded-surface state. It selects the last nonempty surviving system node in surface order, retains only surviving replacement positions for chained rewrites, and withholds the prompt after an unindexed older endpoint until prepend replay supplies its order. Target-owned Definitions retain historical cards independently. `ctx.uiConversation.inspectRequestPrompt(previous, header, system)` classifies request changes against that effective prompt; ordinary messages and stream chunks require no system-state work.

<a id="shell-and-standard-props"></a>
## Shell and standard props

The shared image slot props keep display choices separate from durable references: `thumbnail` requests a contained attachment-list thumbnail, while `compact` requests a cropped gallery tile. An optional per-image `label` supplies the accessible display name; loading and cache identity still use the original attachment reference. [ui-attachment](../ui-attachment/README.md) owns rendering and the lightbox.

The context-occupancy button shows a ring and percentage below the input card, after the Session statistics. Clicking it opens the token breakdown in a panel kept inside the viewport, including when no statistics are shown; the button stays hidden until context usage and capacity are available.

The composer registers the File command action and owns its label, availability, and native file-dialog callback. Menu availability and invocation both consult the mounted composer's current attachment-intake policy. Unmounting or locking the composer disables that action; disposing the plugin removes its registration. The callback binding stays inside the input module.

`SessionInputShell` owns one Lexical editor per Session through its private [DraftEditorRuntime](src/client/input/editor/runtime.ts), while retaining submission, attachment selection, and recovery decisions. [DraftEditor](src/client/input/editor/DraftEditor.tsx) renders the borrowed editor; InputBar retains its Hooks and refs and installs DOM behavior through [view-binding](src/client/input/editor/view-binding.ts). Editor-facing types live in [draft-editor.ts](src/client/contract/draft-editor.ts), with shared input and submission types in [input.ts](src/client/contract/input.ts). This separation does not support simultaneous editable roots for one Session; [the two-stage isolation proposal](../../../.agents/notes/proposed/architecture/2026-09-14-composer-model-and-draft-editor.md) defines the remaining work.

Claimed commands retain their identity and highlight when only their arguments and trailing separator are deleted; editing the command name releases the claim. The same rules apply to every command and locale, including `/goal`, `/目标`, `/plan`, and `/计划`. Command hints and ordinary placeholders remain hidden throughout IME composition and reappear only after the editor commits the final text and the corresponding input is empty.

Workspace selection uses `uiWorkspace.openWorkspace` to prepare the target and commit navigation. Draft text and attachments move in its synchronous preparation callback only while that request is current; later navigation or owner disposal leaves the original draft intact.

The package occupies the root-scoped `main` key `conversation`. Its `main.conversation` shell keeps the strict Session Header outside the optional-Session `conversation.content` Component Factory. The Factory owns the shared body and Composer, reads the current Session through its standard Hook, and exposes strict-Session `views` plus root-scoped `widthControls` local positions. Its default adapter renders the existing `conversation.session` entry, while the main occurrence selects the width handles; an embedded occurrence can replace `views` and omit those handles without rendering the main Header. `ctx.uiSession.provide()` materializes the Conversation and input sources from the same Session binding and supplies `inputActions` as a stable standard prop.

A blank Session retains the header's leading and corner controls, including the right-sidebar opener, while hiding its title, actions, utilities, and View tabs. Selecting a Workspace creates the Session needed by these controls; the first message is not required. Without a selected Session, the strict header is absent. Sidebar entries retain their own data and execution prerequisites.

View selection is deterministic: a registered persisted selection wins, otherwise registered `chat` wins, otherwise no View renders. It never chooses the first registered View. Shell phase combines Session lifecycle with the active-target set; no target-specific snapshot is read by the shell.

The shell reads the persisted View preference before rendering when a Session first binds or a cached Session becomes current, activates the registered preferred View or Chat fallback, and activates later tab or focus selections before committing them to the store. A blank Session still omits the `conversation.view` slot; no unselected target is activated.

Active transcripts in the main occurrence expose content-width drag handles in their uncovered side gutters; embedded occurrences omit them. A View that paints into a gutter raises only its concrete painted element above the handle; transparent full-width wrappers stay below so they do not claim empty gutter. This requires the path between that element and the Conversation body to remain outside an intermediate stacking context; the shipped Chromium behavior is pinned by the browser scenario. Chat applies the rule to table elements, while its column-bounded tool cards need no raise. Wheel motion over a handle still scrolls the transcript, while Ctrl+wheel remains a browser zoom gesture. The sticky composer intentionally owns its full footer band, which is not a resize target; an already-captured drag lifts its indicator until release ([decision](../../../.agents/notes/implemented/bug-fix/2026-09-14-transcript-width-handle-layering.md)).

The resident composer survives no-Session and Session transitions. Whitespace hides its placeholder; a whitespace-only draft without attachments cannot be sent. The no-Session state keeps the same composer surface mounted but inert while the Workspace picker connects a blank Session. The surface is a shell-owned Lexical editor: reference chips are atomic decorator nodes carrying the owner's serialization identity (submission expands them through the owner codec), claimed slash commands stay styled leading text, folder text references carry the folder glyph as an icon prefix, and the draft's clipboard projection is mirrored into the per-Session Conversation store. QueueDock reads `next-turn` directly from the Session `inbox` projection, including cold recovered messages. Queue operations address exact queue occurrences through the scoped `ctx.conversation` service; queue previews render sent text through the shared inline reference projection from `ui-primitives` (wire session forms fold to their label) and show local or durable images and files in original attachment order. Images use thumbnails; files use compact name-and-size cards. An edit exposes the literal sent text, and durable thumbnails resolve through the session image URL cache. Busy Enter behavior is stored in the Host-backed `ui-conversation` settings namespace. The composer keymap arbitrates the trigger menu's keys through the slash pipeline — Tab settles the highlighted completion (or drills a drillable one), Escape and Shift+Tab leave the menu without settling — and leaves every other key to the editor. An overlay that takes the keyboard hands it back through `SessionInput.focus()`, which rides Lexical's own focus so the caret returns where the draft left it rather than at the start.

Default sends commit optimistically: Enter clears the draft, occurrence table, and undo history in the same transaction, keeps the composer in `plain`, and runs the send as a detached attempt, so typing and further sends continue during the flight. `sendSession` registers a Session submission echo (`session.beginSubmission`) with the delivery mode before serializing, preserving selected image and file order in `pendingSubmissions`; Session derives the placement from that mode and its current running state, so idle sends use the transcript, busy Queue sends use QueueDock, and busy Steer sends use the pending-steering surface. It then yields one paint, encodes images through the browser's native `FileReader` data-URL path, and cites staged file receipts. Command submissions use the same receipts for generic files, so sending `/goal` or `/plan` never reads those browser files again. The prompt reuses the submission `requestId`; queue and history observation by that `rpcId` retires the echo once. Concurrent failures are restored together in submission order until the user edits the restored content; command submissions keep the frozen `submitting` phase. Detached attempts retain their attachment ids through admission and Session scope disposal. An observed retirement immediately exposes each image preview through the durable cache, replaces it with the canonical URL after fetching the admitted attachment, revokes each URL after its use ends, and releases file cards. Selected generic files enter one FIFO background-upload queue; `maxConcurrentFileUploads` defaults to two active Worker transports, the Conversation service retains queued and active operations plus byte progress across Session navigation, and removing a draft skips its queued transfer or aborts its active transport. Continuable subagents disable attachment intake and skip local echoes because their transport does not preserve the browser request id.

Queued submission echoes show “Sending…” beside disabled edit, remove, and steer buttons; a collapsed dock keeps the sending status in its header. A matching Host queue row replaces the echo and enables each action according to its normal text-content and running-state requirements. Prompt acknowledgement alone does not enable queue actions. A failed submission removes its echo and displays an error; the composer restores the failed draft when it is empty or still contains the previous automatic restoration, preserving subsequently typed text.

Disabled Send and Stop buttons suppress their tooltips, including a Stop button that becomes a disabled Send button when the turn ends. While a normal composer is running, its primary pointer action remains Stop when the draft is empty or input is unavailable. Actionable text or attachments switch the same seat to Send; clearing or successfully submitting the draft restores Stop. The busy-Enter setting selects the Queue or Steer delivery for ordinary Sessions and continuable children, and the running Send button delivers through the same mode plain Enter resolves to; while it is enabled (no upload pending) over a plain message draft its label names that mode (Queue message or Steer message), so the setting governs Enter and the button together while Cmd/Ctrl+Enter still uses the other mode, and idle sessions, empty drafts, and `/` command lines keep the plain Send label ([decision](../../../.agents/notes/implemented/bug-fix/2026-09-04-busy-send-button-follows-enter-setting.md)). Their QueueDock rows share Edit, Remove, and Steer, and an empty draft shares the steer-all chord. One-shot children remain read-only. Plan mode and active goals do not change attachment intake. Continuable children keep separate Send and Stop actions but expose no File row, paste, or drop intake; if their parent is offline, Send and the composer gestures lock while QueueDock controls for the live inbox remain available ([decisions](../../../.agents/notes/archived/bug-fix/2026-08-20-running-draft-primary-send.md), [inbox controls](../../../.agents/notes/implemented/feature/2026-08-27-continuable-subagent-human-inbox-control.md)).

File chips and editable skill references share a whole-reference hover background and follow the composer's line height and text baseline. The first click delegates preview opening to the registered reference source immediately, including the first click of a double-click sequence. Subsequent clicks retain native text selection; an existing noncollapsed selection suppresses pointer preview activation. Previewing does not change the draft, its clipboard projection, or submission.

When another writer owns the Session, the send-error toast asks the user to quit other running DSH instances and retry.

<a id="temporary-composer-entries"></a>
## Temporary composer entries

Plugins stage analysis launches through `conversation.guardedDrafts`: an owner, stable launch id, JSON payload, and browser draft text. The registered owner validates the captured intent before materialization and the Session binding before default prompt delivery. Browser interaction storage retains pending/admitted bindings across reloads; storage or owner failures reject sending. Edits retain identity, while starting another draft requires clearing the unsent analysis. Draft replacement is blocked during materialization, including after optimistic clearing. A successful check records admission state but never replaces Host validation on later sends. These records contain neither Host receipts nor Session history; clearing browser site data removes this recovery state.

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

The composer bar declares a session-scoped single seat for `'conversation.input.plan'` (right of access mode) and a `session-maybe` `'conversation.input.model'` seat (immediately before the pending indicator and send/stop controls), as well as list slots for overlay, dock, left, and right input extensions. Feature packages own each control and its state; ui-conversation supplies placement, the `locked` owner prop, and the standard slot shares. The leading plus button is a capability launcher, not an attachment surface. In a browser-only New Session draft, both `+` and typed `/` open the draft-eligible `/` source roster through one `InputTriggerController`; Workspace and staged Agent-preset changes retarget that controller without clearing text, and picks only splice text into the resident input. For a real Session, the existing command launcher and Session-owned command/Skill sources remain in place. `MenuView` is the sole floating menu and pick path in both states. Neither path adds a file row, file input, upload protocol, or second menu component. While the `plan` projection's effective target is plan mode, InputBar swaps its textarea placeholder to the plan-task wording, localized through the `conversation` locale namespace this package registers (the `placeholder.plan` / `hint.plan` keys) and shared verbatim with the claimed `/plan` command hint (a host-folded value read through the standard-kit `useProjection`; owner-supplied placeholders win). A pending composer takeover remains mounted when another conversation view is active so the blocked agent can still receive its answer; without a pending interaction, the active-session composer belongs to Chat. The composer-bar slot itself is `session-maybe`: a plain no-selection screen keeps message actions inert and opens the Workspace picker, while a New Session draft supplies a live browser-only input machine, capability text insertion, service-backed permission and Agent-preset staging, and draft-safe model selection. The bar never swaps in a parallel tree, so the textarea DOM survives Workspace selection and first-send materialization; controls that require an addressed Session remain empty until one exists.

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
- **Factory occurrences inherit their render-position Session** — `conversation.content` does not accept an independently addressed Session; that requires a separate Session-provider capability.


<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. Conversation Definitions, target builders, and Views are already validated by their owning registries and the Slot ledger.
