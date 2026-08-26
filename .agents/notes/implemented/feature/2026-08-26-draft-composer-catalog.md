# Agent Note: Draft composer capability catalog

Status: implemented

English | [中文](2026-08-26-draft-composer-catalog.zh.md)

## Problem

A new-session Web draft has no Session or Agent, but its composer must discover the Commands and user-invocable Skills that the eventual session can use. Existing Remote methods are session-scoped, command descriptors do not retain the registration layer that supplied a same-name winner, and Skill summaries expose technical source/provider facts rather than product ownership. Creating a temporary Session for discovery would violate the product lifecycle and leave empty durable records.

The projection must also distinguish ungrouped drafts from Workspace drafts. An ungrouped draft cannot substitute the Host process directory for a missing Workspace, while a Workspace draft needs the selected preset's standing composition, including an isolated Skill registry, without resuming an Agent.

## Decision

`@deepseek-ai/dsh-host-composer-catalog` is a read-only Host Remote projection mounted by the Web bundle. `composerCatalog/listDraft` accepts an optional Host-issued `WorkspaceId` and Agent preset id. It never accepts a path and never injects or calls Session/Agent services. A Workspace id resolves through `ctx.workspaceRegistry`; an unknown id rejects. An ungrouped request calls Skills with `cwd: undefined` and filters project sources.

The gateway returns separate `commands` and `skills` arrays, a deterministic content revision, and contained area errors. Wire entries contain only callable name, bounded description, command input metadata or Skill model-invocation policy, optional controlled `iconId`, and product origin. They omit handlers, scope keys, provider ids, absolute paths, resource bases, Skill locators, frontmatter, and bodies.

### Command provenance

`CommandDefinition.provider` is an optional opaque technical identity. `CommandRuntime.listDiscoveryForScope()` merges registrations while retaining the winning `global` or `scoped` layer and the winner's provider identity. The ordinary `CommandDescriptor` remains unchanged. This makes identical global and scoped descriptors distinguishable without descriptor comparison and does not affect dispatch, precedence, or model input.

An unowned global winner projects as `DSH`; an unowned scoped winner projects as `Agent`. An explicitly owned winner resolves through trusted gateway configuration, and an unknown provider degrades to `Plugin` rather than exposing its id.

### Skill origin and ordering

Skill product origin is derived after the Skill registry selects its winner. Project sources use the Host Workspace display title, user sources use `User`, configured provider/source ownership may declare `DSH`, `PTO`, `User`, or a friendly plugin, custom roots default to `User`, bundled roots default to `DSH`, and every other unmapped provider degrades to `Plugin`. Source-specific declarations beat provider-wide declarations, so one filesystem provider can own user, project, custom, and bundled roots without assigning one product label to all of them.

Only user-invocable winners cross the wire. Skills sort by `User`, `PTO`, Workspace, `DSH`, then plugin, with stable label/name ordering inside a product bucket. The preset's standing isolated Skill registry wins when present; absence uses the Host registry, matching session composition.

### Failure and revision behavior

Skill provider rejection remains contained by `SkillRegistry`: successful winners are returned with a `skill-catalog-incomplete` area error. A registry-level failure clears only Skills and leaves Commands intact. Preset resolution failure leaves global Commands and Host-registry Skills available and reports Agent-attributed errors for both areas. The response revision hashes the projected entries and errors, so clients can reject stale refetches without receiving provider generations.

## Alternatives considered

- **Create a temporary Session and use session-scoped Remotes** — rejected because discovery is read-only and must not allocate, resume, persist, or publish a session.
- **Merge command and Skill catalogs in the browser** — rejected because the browser lacks trusted Workspace paths, preset standing scopes, provider ownership, and final winner facts.
- **Infer command override provenance from descriptor differences** — rejected because a scoped command may intentionally publish the same name, description, and input metadata as its global fallback.
- **Treat every bundled Skill as PTO** — rejected because bundled is a technical source shared by DSH, PTO, and third-party distributions.
- **Put product origin kinds in the command registry** — rejected because the general registry owns technical registration facts; deployment-specific product labels belong in the Host projection.

## Consequences

- New-session catalog reads preserve the first-send persistence boundary and can address preset composition without an Agent.
- Command provenance gains one optional registration field and one read projection; existing descriptors and execution remain stable.
- Product labels stay trusted Host configuration and never depend on names, paths, or client hardcoding.
- The Skill registry currently exposes incomplete state but not per-provider failure identity, so partial Skill errors are area-level until that registry has a consumer-backed diagnostic need.
- The response revision supports pull-based freshness; a merged push invalidation event and trusted icon registry remain separate client-phase work.
