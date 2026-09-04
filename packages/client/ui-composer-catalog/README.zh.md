---
description: "面向 Command 与用户可调用 Skill 的 New Session 输入框发现；供排查草稿能力选择和正式 Session 准入的用户与维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-composer-catalog

[English](README.md) | 中文

## 概述

纯浏览器 New Session 草稿组合器的统一能力 source。它调用 Host 拥有的 `composerCatalog.listDraft({ workspaceId?, agentPreset? })` seam，将 Commands 和用户可调用 Skills 投影到通用 [`ui-input-trigger`](../ui-input-trigger/README.zh.md) 菜单。该 source 只服务草稿 target；现有 Session 命令执行和 Skill 发现仍分别由 `ui-commands` 与 `ui-skill` 拥有。

输入框前置 `+` launcher 与键入 `/` 共用同一个草稿 controller 和 source。Commands 位于第一个无标题分区；Skills 随后位于 `Skills` 标题下。每行预留左侧图标位，并显示名称、受限制的单行描述与最右侧的可信产品来源。搜索同时匹配名称、描述和来源。完整描述与来源仍可通过 title 与 accessible-label 文本访问。

每个草稿 target revision 的 Host 请求只会 single-flight 一次。Workspace 和已暂存 Agent preset 的变化都会更新 target，但不会清空编辑器；对话接线层会关闭旧菜单，因此其已中止请求不能发布到新 target。传输失败会留下可重试的 source 行；Host 包含的分区错误则在成功行旁展示，重试前只会使该 source 失效，不会隐藏其他成功 source。选择只会向草稿拼接文本：Command 为 `/<command> `，Skill 为规范 `/skill <name> `。已结算目录会同时发布规范与旧兼容词形，用于输入装饰的纯派生显示。Host 解析和确定性 Skill 注入仍由 `dsh-tool-skill` 在 `agent/pre-step` 拥有。

首次发送时，会话层先实体化一个 Session，再由本 source 在转交文本前比较缓存的草稿目录与新鲜的正式 `listSession` 结果。已选择能力若消失、可信来源或调用策略改变，或跨越 Command／Skill 冲突边界，提交会被拒绝且浏览器草稿保持不变。Host `session.prompt` 还会在持久化前独立复核规范 Skill 的可用性，覆盖手输文本和非 Web Client。

本包不发布运行时 invariant companion，因为它不拥有独立的生命周期事件流或可变运行时状态。

## 目录

- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="model-experience"></a>

## 模型体验

无，因为本包只改变浏览器发现与草稿文本；它不加载 Skill 指令、不创建 Session、不发送 prompt，也不注册模型可见工具。

#### KV Cache 影响

在用户通过后续执行阶段提交草稿前没有影响。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- 纯手输文本没有历史菜单选择身份；它按当前正式 Session 目录校验。只有草稿目录快照中包含被寻址能力时，才比较来源是否变化。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
