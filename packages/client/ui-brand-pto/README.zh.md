---
description: "面向侧栏与会话首屏的 PTO Agent 工作台品牌填充；供选择或替换浏览器品牌呈现的部署方与维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-brand-pto

[English](README.md) | 中文

## 概述

本包用 PTO Agent 工作台品牌填充 `sidebar.brand.mark`、`sidebar.brand.name` 和 `conversation.hero.brand.mark`：mark 沿用鲸鱼标识作为工作台 logo，name 图形渲染 "PTO Agent 工作台" 并带 DSH 徽章盘。本包无条件注册：本 fork 始终呈现 PTO 品牌，而上游官方插件在其 `official` 构建 profile 之外保持惰性。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当部署应始终呈现 PTO Agent 工作台身份时，在浏览器名单中组合本插件。采用其他身份的部署应改为在相同槽位组合另一个包；本包没有配置面。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

三个占位者通过嵌套的 `slots.inject()` 作为一组声明感知注册安装。名称占位者通过有类型的 `ptoBrand` locale namespace 获取 wordmark 与徽章文案。因此无论该包的条目先于还是后于侧边栏和会话声明方激活，它都能工作；任一声明折叠时会撤回全部占位者，HMR 期间不会留下混合品牌。它不保留运行时状态。node 半边是空的 Loader seat；浏览器标题仍属于本包之外的构建环境事项。

本包不发布运行时 invariant companion，因为它不保留可变状态，且其 slot 占位者共享同一个事务性 effect 生命周期。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [ui-sidebar](../ui-sidebar/README.zh.md)——声明并渲染侧栏品牌槽位。
- [ui-conversation](../ui-conversation/README.zh.md)——声明会话首屏品牌槽位。

-----

<a id="model-experience"></a>

## 模型体验

无，因为本包只贡献浏览器呈现；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；本包既不组装也不发送 provider 请求。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- **本包只提供一组 occupant** —— 其他呈现应由占用相同 slot 的另一个 Cordis 包提供。
- **浏览器标题相互独立** —— `DSH_CLIENT_TITLE` 在构建期选择标题文字，而不经过 UI slot。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
