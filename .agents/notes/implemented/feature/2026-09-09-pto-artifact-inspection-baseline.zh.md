# Agent Note: PTO 产物查看基线

Status: implemented

[English](2026-09-09-pto-artifact-inspection-baseline.md) | 中文

## 问题

PTO 用户需要查看现有产物目录，而不创建 Session 或执行工作负载。仅凭文件名无法确定 Viewer 支持情况或官方分析 Skill 的身份。

## 决定

[Host 查看包](../../../../packages/host/pto-artifact-inspection/README.zh.md) 对用户明确选择的目录生成 Profile，返回动作就绪状态，并通过可撤销的精确文件路由提供受支持的静态 HTML。Workspace overlay 消费这些路由。Run recognizer 拥有产物事实；Host 拥有注册、revision 检查、路由和分析准入。

Qualified Skill 查找绑定 provider 和 revision。Dependency 工具要求 admission receipt，并使用配置中固定的上游工具。外层工作台提供官方 Skill 资源闭包、工具原文、来源和部署 patch；这些资源独立版本管理。

## 考虑过的替代方案

**提供整个选定目录。** 拒绝，因为 Viewer 只需要一个批准文件，而不需要访问相邻文件或任意路径遍历。

**只按显示名称选择 Skill。** 拒绝，因为其他 provider 可以发布同名 Skill，却不具备固定工具与 revision 的对应关系。

**把上游分析逻辑复制到 Client。** 拒绝，因为官方工具仍是算法所有者，Client 只呈现 Profile 和视图。

## 后果

静态查看不创建 Session。路由 dispose（资源释放）会撤销访问，不支持的 adapter 返回 unavailable。Record 和 admission map 仍只在进程内保存；尚无选区回调和持久分析视图。

Viewer 到输入区的首次发送路径存在已知回归：浏览器组合可能丢失结构化分析身份，在未进入 Host 准入时发送普通文本。Host 和 Controller 单测通过不代表端到端分析成功。新 launch 与重试行为、自定义实验视图宽度仍属于独立修复工作；本基线不修复这些问题。

## 测试

基线收口时，Host、Skill、run profile、Workspace、Conversation 和布局的九个聚焦测试文件通过 223 个用例。这些测试使用受控插件组合；仍缺少覆盖完整首次发送事务的 recorded-session 场景和真实浏览器测试。后续分析启动修复负责补齐该缺口。
