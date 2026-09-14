# Agent Note: 受保护的分析 launch

Status: implemented

[English](2026-09-14-guarded-analysis-launches.md) | 中文

## Problem

浏览器分析 launch 必须在 preset 发现改变草稿目标时保留 Record 和 qualified Skill。仅在物化时调用的 trigger 可能因此跳过准入，仅保存在内存的意图也无法跨浏览器刷新恢复。

## Decision

Conversation 持有通用 owner/id/payload 绑定，在默认 Session prompt 发送前校验。Workspace 解释 PTO payload 并调用现有 Host 准入操作。带版本的浏览器交互存储保留 pending/admitted identity 和未物化草稿文本。转移到 Session 时先保存接收方 identity，再移除浏览器副本。每次重试仍向 Host 校验，admitted 标记本身不授权发送。未知 owner 和无效状态拒绝发送。新 launch 前必须清空未发送草稿；编辑保留绑定。每次有意 launch 物化新 Session，重试则保留 request 和 Session id。

## Alternatives considered

**仅在物化时准入。** 捕获的草稿 revision 可在发送前改变，Session 重试也会绕过该 hook。

**前缀匹配。** 普通分析问题不调用 slash trigger，展示文字不能建立准入 identity。

**修改 receipt 或 Session 格式。** Host 准入已经生成所需 receipt 和 Skill source。浏览器交互恢复不需要另一份 Session 历史，也不需要改变 receipt schema。

## Consequences

浏览器刷新在同一 origin 保留 identity，清除站点数据会删除交互恢复状态。Host 重启可能使已注册 Record 失效；UI 保留问题并引导用户从 Viewer 重新关联。本决定不实现跨设备持久 launch 恢复或可见 Skill/file token。四插件组合测试覆盖 preset/workspace 变化、独立 Viewer 选择、单次物化、拒绝、同 Session 重试和有意重新 launch；存储测试覆盖刷新、取消、owner 丢失及写入失败。真实 Host/tool 证据归工作台 repair 任务所有。
