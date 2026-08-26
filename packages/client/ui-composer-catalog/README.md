# @deepseek-ai/dsh-client-ui-composer-catalog

English | [中文](README.zh.md)

Unified capability source for the browser-only New Session composer. It calls the Host-owned `composerCatalog.listDraft({ workspaceId?, agentPreset? })` seam and projects Commands and user-invocable Skills into the generic [`ui-input-trigger`](../ui-input-trigger/README.md) menu. The source serves draft targets only: existing Session command execution and Skill discovery remain owned by `ui-commands` and `ui-skill`.

The leading `+` launcher and typed `/` both use the same draft controller and source. Commands occupy the first untitled section; Skills follow under a `Skills` heading. Each row reserves a leading icon position and shows name, a bounded single-line description, and the trusted product origin at the trailing edge. Search matches name, description, and origin. Full descriptions and origins remain available through title and accessible-label text.

One Host request is single-flighted per draft target revision. Workspace and staged Agent-preset changes both update that target without clearing the editor; the conversation wiring dismisses the old menu, so its aborted request cannot publish into the new target. Transport failure leaves a retryable source row, while Host-contained area errors render beside successful rows and can invalidate only this source before retry without hiding successful sibling sources. Picks only splice text into the draft: `/<command> ` for Commands and canonical `/skill <name> ` for Skills. The settled catalog publishes both canonical and legacy-compatible lexemes for derived input decoration. Host parsing and deterministic Skill injection remain owned by `dsh-tool-skill` at `agent/pre-step`.

## Model Experience

None, as this package changes browser discovery and draft text only; it does not load Skill instructions, create a Session, send a prompt, or register a model-facing tool.

#### KV Cache effect

None until the user submits the draft through a later execution stage.

## Known Limitations and Deferred Work

- Session catalogs still use their existing command and Skill sources; source/origin normalization after Session materialization remains deferred.
