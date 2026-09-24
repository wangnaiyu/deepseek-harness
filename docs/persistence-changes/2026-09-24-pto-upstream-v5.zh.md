---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-09-24-pto-upstream-v5

[English](2026-09-24-pto-upstream-v5.md) | 中文

## 概述

分配 PTO 写入版本 V5，以区分不兼容的旧 PTO 与上游 V4 来源，保留 PTO 分析归因和可选的精确 Skill provider 元数据。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-09-24-pto-upstream-v5
baseline: false
changes:
  - root: "SessionHeader"
    previous: "2026-09-16-session-format-v4"
    after: "22c6899a78214dd841c266348ae997027ef391174ddb21127f1b71dc1b362824"
    decision: version-bump
  - root: "event:agent/inbox/spliced"
    previous: "2026-09-16-session-format-v4"
    after: "29475abc4bce8ae12d933fd40f7779b22af8858eb56b3946e38e65f99b5ca32f"
    decision: version-bump
  - root: "event:developer/message"
    previous: "2026-09-16-session-format-v4"
    after: "dd7545cc51730a0c9385a97a2856a59a608dfe17053844b13387df372ac7f885"
    decision: version-bump
  - root: "event:session/title-llm-request"
    previous: "2026-09-16-session-format-v4"
    after: "1198e7c348d28f03480e50f2ab9b6dbbc254c4a69dec2cc0103416ae640a37e5"
    decision: version-bump
  - root: "event:user/message"
    previous: "2026-09-16-session-format-v4"
    after: "3b3d2a6ec2119fc69908f6a8233201e2f95bc0921484f2931af4335bf4b89b3e"
    decision: version-bump
```

<a id="compatibility"></a>
## 兼容性

官方 V4 在 V5 中保留事件坐标。显式 legacyPtoV4 目录选择将冻结的 PTO V4 事件体按 V3 解码，结合全部可用子会话证据应用上游转换。原文件保持不可变，只发布验证过的 V5 后继文件。未知必需事件和不一致子会话事实会拒绝转换。历史上游 Skill 调用来源允许缺少 provider。此前 fork 声明原样归档在官方线性历史之外。

<a id="verification"></a>
## 验证

兼容验证中的 386 项格式 owning 测试通过。四项真实 JSONL 来源测试覆盖两种物理编码、只读准备、验证后写入发布、当前格式重开、原字节不变及缺少显式来源选择时拒绝。SDK owner refresh 的 22 项无密钥场景通过；更广泛的升级验证由维护任务记录。

<a id="dev-note"></a>
## 开发备注

无。
