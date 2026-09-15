---
description: "保留 V3 Session 事件，并将 PTO 分析来源元数据推进到 V4。"
kind: "package-library"
---

# @deepseek-ai/dsh-session-format-v3-to-v4

[English](README.md) | 中文

## 概述

本库将 V3 Session 恢复为 V4，保持事件正文、身份与位置不变。构建期静态 Session 格式目录选择此相邻迁移。V4 为 PTO 分析来源变体提供独立 writer 版本，同时保留 V3 物理编码与验证。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

[格式目录](../session-format-catalog/README.zh.md)直接导入本库；它不是 profile 插件。Header 迁移只改变版本，正文迁移保留已有数据。无效 header 和未知必需事件仍然报错。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部机制 — 点击展开</summary>

此迁移通过私有 header 副本，将物理编码和关系验证委托给冻结的 V3 实现，并返回原始 V4 产物。每个 stage 拥有独立继承边界状态；紧凑 Assistant run 原样传递。较早的事件数量变更迁移可以通过传递的 end-seed 标记提供继承边界。持久化 provider 拥有后继代发布，并保留前代文件。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Session 格式库](../session-format/README.zh.md) — 迁移 stage 契约。
- [PTO 兼容性决定](../../../.agents/notes/implemented/architecture/2026-09-10-pto-upstream-compatibility.zh.md) — fork 集成范围。

-----

<a id="model-experience"></a>

本包不发布运行时 invariant companion，因为此库不拥有 Cordis 生命周期或可变运行时状态。

## 模型体验

无；本库保留存储事件，不注册面向模型的能力。

#### KV Cache effect

此恒等迁移不增加提示词，也不修改保留的消息正文。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- V4 是 PTO fork 格式。本迁移不提供降级，也不保证兼容未来使用相同整数的上游格式。
- 本迁移保留 V3 的验证限制，不重建缺失的 receipt 元数据。

<a id="dev-note"></a>
### 开发备注

无。
