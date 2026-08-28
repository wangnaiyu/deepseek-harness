---
description: "PTO Agent workbench brand occupants for the sidebar and conversation hero; for deployments and maintainers choosing or replacing browser brand presentation."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-brand-pto

English | [中文](README.zh.md)

## Summary

This package fills `sidebar.brand.mark`, `sidebar.brand.name`, and `conversation.hero.brand.mark` with the PTO Agent 工作台 brand: the whale mark keeps the workbench logo, and the name artwork renders "PTO Agent 工作台" with a DSH badge plate. It registers unconditionally: this fork always presents the PTO brand, while the upstream official plugin stays inert outside its `official` build profile.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Compose this plugin in the browser roster when the deployment should always present the PTO Agent workbench identity. A deployment with another identity composes a different package into the same slots instead; this package has no configuration surface.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The three occupants install as one declaration-aware registration set through nested `slots.inject()` calls. The name occupant receives its wordmark and badge through the typed `ptoBrand` locale namespace. The package therefore works whether its row activates before or after the sidebar and conversation declarers, withdraws all occupants when either declaration collapses, and leaves no partial brand mix during HMR. It retains no runtime state. The node half is an empty Loader seat, and the browser title remains a build-environment concern outside this package.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-sidebar](../ui-sidebar/README.md) — declares and renders the sidebar brand slots.
- [ui-conversation](../ui-conversation/README.md) — declares the conversation hero brand slot.

-----

<a id="model-experience"></a>

## Model Experience

None, as the package contributes browser presentation only; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The package supplies one occupant set** — alternative presentation belongs in another Cordis package occupying the same slots.
- **The browser title is independent** — `DSH_CLIENT_TITLE` selects title text at build time rather than through a UI slot.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
