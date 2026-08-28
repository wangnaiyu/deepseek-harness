---
description: "Session-addressed Host Remote for listing, executing, and cancelling durable PTO experiments; for deployments and maintainers operating the browser dashboard edge."
kind: "package-reference"
---

# @deepseek-ai/dsh-host-pto-experiment-dashboard

English | [中文](README.zh.md)

## Summary

Host Remote edge for the PTO experiment dashboard. A request supplies an existing `sessionId`, never a path. The gateway resolves the Workspace cwd from authoritative Session metadata, reads `@deepseek-ai/dsh-pto-experiments`, and returns a bounded, newest-first presentation without storage keys, filesystem target identities, scope keys, or Agent objects.

Reads do not create or resume an Agent, Session, or turn. Unknown Sessions and Sessions without a Workspace fail closed. `executeSession` requires that same Session's live Agent and posts one private plugin follow-up. The Agent loop opens a normal turn; the gateway consumes that message at `agent/pre-step`, forwards the exact cwd, Agent, and optimistic revision to the registry's indivisible trusted execution loop, and rejects the model step. This turn encloses the existing approval UI's durable audit pair without appending a model-visible user message or calling an LLM. The gateway owns only ephemeral cancellation controllers: view unmount does not abort work, the initiating Session can cancel after remount, and cancellation waits for the executor's durable terminal settlement before returning. A second execution for the same experiment fails closed.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="model-experience"></a>

## Model Experience

### Dashboard projection

#### What the model sees

No dashboard payload or private execution message reaches the model. `listSession`, `executeSession`, and `cancelSession` are browser UI Remotes and do not register a Tool, command, Skill, or system-prompt section.

#### Token effect

None. Reads append nothing. Execution appends inbox/turn lifecycle plus `approval/asked` and `approval/decided`, but the pre-step is rejected before `step/start`; there is no model-visible `user/message` or assembled model request.

#### KV Cache effect

None. The projection and blocked non-model turn do not alter the model prefix or request context.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Execution uses one long Remote and the existing approval surface; it is not a background Job and does not survive Host shutdown.
- There is no automatic polling or push invalidation. The UI refreshes after execute/cancel settlement and on explicit user request.
- The projection is bounded to 100 records and does not paginate.
- It requires an existing Session with a Workspace cwd; drafts and ungrouped pre-Session views are outside this package.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
