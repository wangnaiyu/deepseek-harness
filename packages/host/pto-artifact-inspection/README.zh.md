---
description: "Host 内受限的 PTO 记录 Profile、可撤销静态 viewer 与 qualified 官方依赖分析准入。"
kind: "package-reference"
---

# @deepseek-ai/dsh-host-pto-artifact-inspection

[English](README.md) | 中文

## 概述

Remote 只登记用户明确选定的目录，返回事实型 Profile 和动作就绪度，并通过不可猜的精确文件路由提供受支持 HTML。它不提供原始目录、不执行产物，也不从文件缺失推断运行失败。

当前 Profile 可打开自包含的依赖图、内存图与 IR 轨迹 HTML。该包也负责首次发送的 fail-closed 准入，并为精确匹配的官方 Skill 桥接固定版本的官方 dependency-redundancy 工具。

## 目录

- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="model-experience"></a>
## 模型体验

### PTO 产物分析

#### 模型看到的内容

组合后的 Tool catalog 包含 `pto_dependency_redundancy`，输入为 record id 和 record revision。已准入的首个用户 step 还会向模型提供一条结构化 PTO 分析上下文消息，以及精确绑定 provider 的官方 Skill 指令。工具调用成功时返回两种必需的简化模式、有界 stderr/cycle 事实、输出引用、不可变准入回执与明确限制。

#### Token 影响

该工具可用时，固定 Tool schema 会进入请求。只有用户明确生成并发送已准入的分析草稿后，才添加分析上下文与官方 Skill 正文；纯 viewer 请求不增加模型 token。

#### KV Cache 影响

同一部署中的固定 Tool schema 稳定不变。Record revision、artifact 引用、回执 identity 与 Skill 指令是请求特定的尾部内容，因此新建或更换已准入分析会改变该次请求上下文，但不修改部署拥有的 prefix。

## 已知限制与延期项

<a id="known-limitations-and-deferred-work"></a>

- Viewer 组合的首次发送路径可能在 Host 准入前丢失结构化分析身份；Controller 和 Host 单测不代表端到端成功。见[基线决定](../../../.agents/notes/implemented/feature/2026-09-09-pto-artifact-inspection-baseline.zh.md)。
- 未安装需现场生成或本地服务的泳道、关键路径和程序图 viewer。
- 静态 viewer 仅查看，不提供选区或深链回调。
- 依赖分析要求已配置的 Python 可执行文件、固定工具路径、live Session Agent 和精确 qualified Skill provider。
- 工具输出保留在已配置的 app-owned 目录；本包尚未提供清理或保留策略 UI。

不发布 invariant companion，因为 Record、Viewer 路由和 admission 是由生命周期持有的私有 map，没有独立的诊断投影。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
