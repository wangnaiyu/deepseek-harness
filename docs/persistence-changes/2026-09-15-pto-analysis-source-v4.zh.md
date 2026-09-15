---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-09-15-pto-analysis-source-v4

[English](2026-09-15-pto-analysis-source-v4.md) | 中文

## 概述

为持久化消息、收件箱和标题请求联合类型中的 PTO 分析来源元数据分配 fork Session V4。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-09-15-pto-analysis-source-v4
baseline: false
changes:
  - root: "SessionHeader"
    previous: "2026-09-11-initial"
    after: "1a3440e3577382704d42a6263aa463504eb74c566734a55e9503a63efcd02445"
    decision: version-bump
  - root: "event:agent/inbox/spliced"
    previous: "2026-09-14-image-offload"
    after: "7cbf1468009ee27bbcabb00b5bbd6d6a0d6d01343a62756ef650191b64177c32"
    decision: version-bump
  - root: "event:session/title-llm-request"
    previous: "2026-09-14-image-offload"
    after: "ff5c3f75d54e811f9e1a2709ceeffa3fa12da3ee045356a86ebde5c955c930b8"
    decision: version-bump
  - root: "event:user/message"
    previous: "2026-09-14-image-offload"
    after: "b6bfe55eae935358c9d39358c4ea24b99c4bad2f8a1921f4f967fe56f2cc2811"
    decision: version-bump
```

<a id="compatibility"></a>
## 兼容性

基于上游 0.1.6 的 PTO fork 写入 V4，因为分析来源字段扩展改变了持久化用户消息、收件箱和标题请求的联合类型。V3→V4 边保留事件正文、序号引用、紧凑事件和继承边界，复用冻结的 V3 编解码器并校验 V4 头部。写入仅发布最终后继代并保留历史字节。此 fork 版本分配不是上游发布：未来整合上游 V4 前必须明确审查格式身份。

<a id="verification"></a>
## 验证

完整构建、503 项迁移/目录/JSONL 回归、构建产物发布 Worker 冒烟及无密钥 SDK text-turn 后继快照刷新均通过。测试覆盖严格接纳、不可变前驱、源文件变化、目标冲突、独立继承边界及重复恢复的确定性。

<a id="dev-note"></a>
## 开发备注

无。
