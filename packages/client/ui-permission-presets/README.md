# @deepseek-ai/dsh-client-ui-permission-presets

English | [中文](README.zh.md)

Permission browser surfaces for three related lifetimes. The General-settings row reads the explicitly exposed `permission` Settings descriptor, derives its options from the host's dynamic `defaultPreset` enum, and writes one `settings.mutate` path operation with the descriptor revision. Its observable rides the slot system's `hooks` compartment, so the renderer owns React hook binding; a push invalidation refetches the descriptor. This value applies only when a later session is created; changing it does not switch the current session. Choosing Full access requires an explicit risk acknowledgement before the row writes it.

For the New Session composer, the plugin registers a draft source through `ctx.conversation`: the same Host-described dynamic enum as a catalog plus browser-local staging callbacks. The resident permission chip consumes that source without changing Settings or Session persistence. First-send preparation executes `/permission <preset>` against the newly materialized Session before the captured prompt is released. Starting another draft or reconnecting drops an unsent choice. Full access keeps the same risk acknowledgement in this draft path.

The current-session surface remains a popupSelect DECORATION hung on the host `/permission` command (`ctx.commandUi.decorate`). A decoration is not a second command — the host command keeps its slash-menu row, the argued path (`/permission <preset>` switches directly), and the durable lifecycle logging; the decoration replaces only the bare invocation with the picker: one flat preset list with the current value marked active and kebab-case preset names rendered as title-case labels (`workspace-write` → `Workspace Write`, the composer chip's display transform twin), where a pick submits the `/permission <preset>` command line. Options and the active mark read the session's `permissions` projection (the same host-computed select the composer chip renders), so both current-session surfaces share one read source and one write path, and the pushed projection frame is the single confirmation both follow. The decoration is available exactly while the projection key is present; a permission-less composition shows neither picker nor Settings row.

The `/client` exports are the plugin body (`apply`/`inject`) plus the Settings-row shared types; the browser-draft controller stays package-internal.

## Model Experience

Indirectly, through the permission facts written by its surfaces: the Settings row causes a future session to start with whole-value knob events (`permission/preset`, `sandbox/mode`, `approval/policy`), while the current-session and first-send draft paths append the same facts through `/permission`; those events select the sandbox mode and approval policy later tool calls resolve. Draft picker interaction itself adds no prompt content and performs no Host write before first send.

#### KV Cache effect

No direct invalidation; the knob consumers own any request-prefix changes.

## Known Limitations and Deferred Work

- **The Settings row is Web-only** — non-Web clients may still switch the current session through `/permission`, but do not receive this browser contribution.
