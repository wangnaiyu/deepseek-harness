---
description: "Read-only Host catalogs for draft and formal Session Commands and Skills; for deployments and maintainers configuring trusted origins or debugging contained discovery failures."
kind: "package-reference"
---

# @deepseek-ai/dsh-host-composer-catalog

English | [中文](README.zh.md)

## Summary

Read-only Host projection for draft and formal Session composers. `ComposerCatalogGateway` publishes `composerCatalog/listDraft` and `composerCatalog/listSession`. Draft requests carry only an optional `workspaceId` and Agent preset id, never a client path; Session requests carry only `sessionId`. The Host resolves canonical cwd, Workspace label, effective Agent/standing scope, and the isolated Skill registry, then returns effective Commands and user-invocable Skills in separate arrays. Session reads never start a turn, and cold attached Session reads do not resume an Agent.

An ungrouped request lists only global Commands and calls the Host Skill registry with `cwd: undefined`; project Skill sources are also filtered from the result. A Workspace request includes scoped command winners and queries the preset's isolated Skill registry when one is mounted, otherwise the Host registry. An unknown Workspace rejects. A broken preset leaves global Commands and Host-registry Skills available while returning contained `commands` and `skills` errors attributed to `Agent`.

Command definitions may carry an opaque `provider` id. The command registry retains that id and the winning `global`/`scoped` layer beside the handler-free descriptor. This package maps trusted provider declarations to product origins; an unowned global registration is `DSH`, an unowned scoped registration is `Agent`, and an unknown explicit provider is `Plugin`. Skills resolve project and user source buckets first, then the most specific configured provider/source declaration, a provider-wide declaration, and safe defaults: custom roots are `User`, unmapped bundled roots are `DSH`, and other unmapped providers are `Plugin`. Configured product kinds use fixed `DSH`, `PTO`, and `User` labels; only plugin origins accept a friendly label, with `Plugin` as the fallback.

Both methods strip handlers, scope keys, provider ids, paths, resource bases, and Skill bodies. Descriptions are capped at 1,000 characters. User Skills sort before PTO, Workspace, DSH, and plugin Skills, with label and name providing stable order inside the last bucket. A SHA-256-derived response revision changes whenever the returned entries or contained errors change. Provider rejection is contained by the Skill registry: successful entries remain in the response and `skill-catalog-incomplete` marks the Skills area.

The service is Remote-only and deliberately declares no same-process Cordis `Context` merge. Client packages consume its generated `./remote` contribution and `./types` payload vocabulary through [`api-remotes`](../../api/remotes/README.md).

## Table of Contents

- [Configuration](#configuration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="configuration"></a>
## Configuration

`providerOrigins` is an ordered list of trusted declarations. Each item requires `provider` and `kind` (`dsh`, `pto`, `plugin`, or `user`), may add a Skill `source` discriminator, and may add a friendly `label` for `plugin`. Duplicate provider/source pairs fail during activation. A source-specific declaration wins over its provider-wide declaration.

<a id="model-experience"></a>
## Model Experience

None, as this Host-only draft catalog projection registers no prompt, tool, message, or provider request.

#### KV Cache effect

None; this package never assembles model input.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Area-level incomplete Skill diagnostics** — the Skill registry exposes completion state but not the rejected provider identity, so `skill-catalog-incomplete` cannot yet identify one product origin.
- **No push invalidation** — `revision` makes refetch results comparable, but this package does not yet publish a merged catalog-change Remote event.
- **No icon registry** — wire items reserve optional `iconId`, but this package emits none until a trusted local icon registry exists.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
