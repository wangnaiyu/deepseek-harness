---
description: "PTO V5 编解码器及两种历史 V4 来源的显式兼容。"
kind: "package-library"
---

# @deepseek-ai/dsh-session-format-v4-to-v5

[English](README.md) | 中文

## 概述

这个纯库将 PTO 写入格式与不兼容的历史 PTO、上游 V4 区分开来。官方 V4 升至 V5 时事件坐标不变。旧 PTO V4 使用 V3 事件体，必须先显式选择目录，再通过上游 V3 转换。[JSONL 持久化](../session-persistence-jsonl/README.zh.md)负责保留不可变原件与验证后发布后继文件。

## 目录

- [来源选择](#lineage-selection)
- [校验](#validation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="lineage-selection"></a>
## 来源选择

默认目录读取上游 V4。对于含升级前 PTO V4 的根目录，PTO 部署在 JSONL 持久化上设置 `legacyPtoV4: true`。这个根目录不得混入上游 V4。版本号和事件内容无法确立写入来源，部署必须提供这一事实。两种配置下的 V5 完全一致。

旧版读取器保留冻结的 PTO V4 编码。其 V4 到 V5 转换复用上游 V3 到 V4 转换器，处理工具结果、消息来源、引用、继承切点、中断轮次及子会话目录。旧 V4 delivery 标记先成为历史 V3 标记，再参与转换；当前 V5 delivery 标记校验自身归属。未知必需事件、无效子会话事实及不一致的父子身份会拒绝转换。独立记录回放可以明确绑定空子会话集合；持久化则收集全部可用直接子会话。

PTO 分析元数据原样保留。Skill 调用写入方记录精确 provider，旧上游记录可以缺少该字段。两条路径均不执行工具、不请求模型、不改写原始 generation，也不支持降级。

<a id="validation"></a>
## 校验

编解码器在 V5 header 下沿用上游 V4 物理编码和消息准入规则。当前格式和转换后恢复均校验关系，包括继承的上游 V4 与当前 V5 delivery 坐标。不发布运行时不变量 companion，因为本库不持有可变运行时状态，每次恢复都在发布前校验完整产物。

<a id="dev-note"></a>
## 开发备注

归档的[旧格式声明](../../../docs/persistence-changes/legacy-pto-v4/2026-09-15-pto-analysis-source-v4.zh.md)记录旧 fork 的版本分配。[当前格式权威](../../../docs/session-format-status.zh.md)定义写入与发布状态。

<a id="model-experience"></a>
## 模型体验

### 历史格式恢复

#### 模型看到的内容

不新增提示词或工具输出。历史转换保留已准入的 `user/message` 与工具消息内容，仅翻译存储表示。

#### Token 影响

恢复已接纳的历史消息；不新增提示词内容。

#### KV Cache 影响

当前 Session 无影响；回放重建历史转换后的消息序列，不发起请求。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 混合上游/PTO V4 的根目录必须先明确分离，不支持自动来源探测。
- 历史子会话元数据不一致需要独立调查。转换器拒绝编造发现事实或修改原日志。
