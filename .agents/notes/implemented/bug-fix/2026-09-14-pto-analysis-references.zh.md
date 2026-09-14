# Agent Note：PTO 分析引用

Status: implemented

[English](2026-09-14-pto-analysis-references.md) | 中文

## Problem

普通问题没有展示所选 Skill 或 Record。cwd-relative 文件 mention 无法标识外部 PTO Record。加入规范 Skill 手势还会在 PTO admission 之外触发普通 Skill injector，造成重复指令。

## Decision

Conversation 将文本与 reference occurrences 保存为浏览器交互状态。恢复时重建手动选择使用的相同编辑器节点，并向提交 owner 提供捕获的投影。引用通过普通 input controller 分发可选的 source-owned 激活动作。Workspace 拥有 Record/revision resolver、可见意图校验与完整 record-plus-handle Viewer 生命周期。成功暂存后关闭 overlay。规范 Skill 手势保持普通选择语义，qualified identity 仍由 Host admission 强制校验。

PTO pre-step listener 通过 Cordis prepend，使两种注册顺序下的结果处理均位于普通 Skill listener 之后。它验证同名指令的 provider 与正文，并生成一次 qualified 注入。定义冲突时拒绝。不需要修改 tool-skill 实现、receipt 字段或 Session 格式。

## Alternatives considered

**普通 @deps.json。** 它丢失原子 identity，并错误暗示这是 Session cwd 文件。

**DOM 点击拦截。** 它绕过 source ownership 与键盘生命周期。

**删除所有同名 Skill 消息。** 它掩盖 provider 冲突，而非拒绝冲突。

## Consequences

新 launch 在 admission 前要求保留选定 Skill 和 Record 引用。用户可编辑问题、删除 token 后重选，或清除草稿再关联。已准入问题重试保留 P2 identity 规则。旧 P2 纯文本绑定仍可读取。Host 重启或 Record revision 变化可能要求重新关联；浏览器存储不是持久 Session 历史。聚焦组合测试覆盖手动选择、恢复、token 拒绝、handle 替换和 Skill 冲突。真实工作台证据属于 repair task。
