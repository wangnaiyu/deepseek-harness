# @deepseek-ai/dsh-client-ui-brand-pto

English | [中文](README.zh.md)

This package fills `sidebar.brand.mark`, `sidebar.brand.name`, and `conversation.hero.brand.mark` with the PTO Agent 工作台 brand: the whale mark keeps the workbench logo, and the name artwork renders "PTO Agent 工作台" with a DSH badge plate. It registers unconditionally: this fork always presents the PTO brand, while the upstream official plugin stays inert outside its `official` build profile.

The three occupants install as one declaration-aware registration set through nested `slots.inject()` calls. The package therefore works whether its row activates before or after the sidebar and conversation declarers, withdraws all occupants when either declaration collapses, and leaves no partial brand mix during HMR. It retains no runtime state. The node half is an empty Loader seat, and the browser title remains a build-environment concern outside this package.

## Model Experience

None, as the package contributes browser presentation only; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **The package supplies one occupant set** — alternative presentation belongs in another Cordis package occupying the same slots.
- **The browser title is independent** — `DSH_CLIENT_TITLE` selects title text at build time rather than through a UI slot.
