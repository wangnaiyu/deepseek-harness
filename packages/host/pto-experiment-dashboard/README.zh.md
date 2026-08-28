---
description: "按 Session 寻址、用于列出、执行和取消持久 PTO 实验的 Host Remote；供运行浏览器面板边界的部署方与维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-host-pto-experiment-dashboard

[English](README.md) | 中文

## 概述

PTO 实验面板的 Host Remote 边。请求只提供已有 `sessionId`，绝不提供路径。gateway 从权威 Session 元数据解析 Workspace cwd，读取 `@deepseek-ai/dsh-pto-experiments`，并返回有界、从新到旧的展示投影；其中不包含存储键、文件系统 target identity、scope key 或 Agent 对象。

读取不会创建或恢复 Agent、Session 或 turn。未知 Session 和没有 Workspace 的 Session 都会失败关闭。`executeSession` 要求同一 Session 的 live Agent，并投递一条私有 plugin follow-up。Agent loop 打开正常 turn 后，gateway 在 `agent/pre-step` 消费该消息，把精确 cwd、Agent 与 optimistic revision 交给 registry 不可拆分的可信执行闭环，并拒绝模型 step。这个 turn 封闭现有审批 UI 的持久 audit pair，但不会追加模型可见 user message 或调用 LLM。gateway 只拥有临时 cancellation controller：视图卸载不终止工作，原发起 Session 重新挂载后仍可取消，且取消会等待 executor 的持久终态结算后返回。同一实验的第二次执行会失败关闭。

## 目录

- [模型体验](#model-experience)
- [已知限制与延期项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="model-experience"></a>

## 模型体验

### Dashboard 投影

#### 模型看到的内容

Dashboard payload 与私有执行消息都不会到达模型。`listSession`、`executeSession` 与 `cancelSession` 都是浏览器 UI Remote，不注册 Tool、command、Skill 或 system-prompt section。

#### Token 影响

无。读取不追加任何事件。执行会追加 inbox/turn lifecycle 与 `approval/asked`、`approval/decided`，但 pre-step 会在 `step/start` 前被拒绝；不存在模型可见 `user/message` 或组装后的模型请求。

#### KV Cache 影响

无。投影与 blocked non-model turn 都不改变模型 prefix 或请求上下文。

## 已知限制与延期项

<a id="known-limitations-and-deferred-work"></a>

- 执行使用一个长 Remote 与现有审批界面；它不是后台 Job，也不能跨 Host 停止继续存活。
- 没有自动轮询或 push invalidation；UI 只在 execute/cancel 结算后和用户显式请求时刷新。
- 投影最多返回 100 条记录，当前不分页。
- 它要求已有 Session 且存在 Workspace cwd；草稿与 Session 前的未分组视图不属于本包。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
