# @deepseek-ai/dsh-client-ui-input-trigger

English | [中文](README.zh.md)

Input trigger pipeline plugin: `/` and `@` detection under the caret (word-boundary + guard-tier rules), the grouped candidate menu, and pick routing to registered sources. `ctx.inputTriggers` owns the source roster and resolves one `InputTriggerController` per Session scope (`sessionOf`) plus one explicitly bound browser-draft controller (`bindDraft`/`draft`). Sources receive an `InputTriggerTarget`: a Session identity, or a draft revision with optional Workspace and Agent preset ids. Legacy sources remain Session-only unless they opt into `targets: ['draft']`. The conversation wiring layer drives `track`/`arbitrate`/`onSpace`/`adjudicate`; `toggleSource` opens one source and `toggleTrigger` opens every eligible source for shared chrome such as `+`. Picks on a Session dispatch scoped input events, while the draft binding applies the same span-CAS outcomes directly to its resident input machine without creating a Session. Sources whose `lexicon` roll changes after warm implement `subscribeLexicon`; the controller re-polls on notification. The pipeline remains command-agnostic: space/enter adjudication polls optional hooks in registration order, and `SubmitEnvelope` lets a command refuse attached images it cannot consume.

Layering: `src/core/` is the pure core — `detectTrigger`, `menuReduce`/`seedGroups`/`MENU_CLOSED`, `exactMatch`, zero React/DOM/cordis; `src/client/service.ts` is the shell wiring the core to the menu snapshot store, generation-gated and `AbortSignal`-superseded candidate fetches, and the pick paths. A failed source remains as an isolated retry row; a successful source can also return contained section issues without losing its candidates. `ReferenceInsert.appearance` optionally identifies a `session`, `file`, or `folder` display without changing its serialized `ref`; the consuming composer owns the glyph and color. `src/types.ts` and the two `contract.ts` files are the frozen cross-package contract; changes require main-thread arbitration.

MenuView renders the menu store into the `conversation.input.overlay` slot (list kind, `session-maybe`) and renders null while closed. Typed triggers seed every eligible source registered for that trigger; a programmatic launcher can seed one source or the entire trigger roster. Groups sort by `order`; `showGroupTitle: false` and candidate `section` values support an untitled Commands block followed by a Skills heading. Every row reserves an icon cell and can render a bounded description plus right-aligned `origin`; title text and the accessible label retain the full values. Failed groups and contained section issues expose Retry without hiding successful groups. The list height clamps to the space above the composer, and outside pointer input dismisses it. Combobox focus stays in the textarea, rows pick on mousedown, and the highlight rides `aria-activedescendant`.

The `/client` exports are the plugin body (`apply`/`inject`), `InputTriggerService`, `MenuViewInjected`, and the contract types. MenuView itself is internal — the slot registration closes over it.

## Model Experience

None, as the trigger pipeline is browser presentation only — picks produce `CommandClaim`/`ReferenceInsert` data whose model-visible consequences (host command execution; inserted reference text riding an ordinary prompt) are owned by the consuming host and input-machine packages.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Global source layer only** — session-scope source registration (per-session shadowing, ScopedLayers-alike) is designed but not enabled; the ledger tracks the trigger condition (a real per-session source need).
- **`InputTriggerCandidate.icon` renders as text** — MenuView drops the string into the icon slot verbatim; wiring to the design-system icon enum (iconFile five-variant family) lands when that enum ships.
- **Overlay SlotMap merge home is split from slot ownership** — the sole `conversation.input.overlay` merge lives here, while ui-conversation owns its anchor, children declaration, and lifecycle because the dependency direction is ui-conversation → ui-input-trigger.
