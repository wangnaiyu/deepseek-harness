# Agent Note：PTO 实验正文宽度

状态：已实现

[English](2026-09-14-pto-experiment-layout.md) | 中文

## 问题

实验面板独立的固定宽度忽略用户设置的 Conversation 正文宽度。资源侧栏收窄视图时，长网格内容和底部操作横向溢出。独立嵌套滚动区会使输入区留位的 owner 不清晰。

## 决定

实验插件消费现有 Conversation 正文宽度和实测输入区高度变量。列表使用受约束的网格轨道，并通过 inline-size 容器查询调整事实列数。标题区和底部操作在可用宽度内换行，长字段保留完整工具提示。面板留在 Conversation 的滚动文档流中，由其为吸附输入区留位；卡片 scroll margin 消费输入区实测高度。

## 考虑的替代方案

**按视口设断点。** 无法检测资源侧栏或用户正文宽度手柄导致的收窄。

**修改 ConversationRoot。** Shell 已提供所需测量值，插件拥有卡片布局，Conversation 拥有滚动视口和输入区留位。

## 影响

实验卡片与 Chat 遵循同一宽度偏好。面板使用自身容器，不在 Conversation Shell 上增加 containment。Host 执行、持久记录、模型上下文和比较结果呈现保持不变。
