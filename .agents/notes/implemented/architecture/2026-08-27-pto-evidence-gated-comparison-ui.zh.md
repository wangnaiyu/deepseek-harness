# Agent Note：PTO evidence-gated comparison UI

状态：已实现

[English](2026-08-27-pto-evidence-gated-comparison-ui.md) | 中文

## 问题

通用 Tool 行与 details 面板可以保留 `pto_experiment_compare` JSON，但不能清晰表达其中的证据边界。业务包若直接占用 `conversation.details.tool`，就必须负责所有 Tool，因为该 slot 只有一个整面板 occupant。全局 overlay 还需要跨 call 的持久状态，而单个 Tool result 并不提供这种事实源。

展示不能把一次较低观测升级成成功实验；即使 Tool call 本身成功结束，格式异常或内部不一致的输出也必须被拒绝。

## 决策

`ui-tool` 继续作为 `conversation.details.tool` 的唯一 occupant，并新增 session-scoped keyed 子槽 `tool.result.detailview`。`ToolDetails` 按 wire Tool name 分派已选中的冻结 call block，并把现有结构化/raw renderer 作为 fallback。业务包因此可以只拥有某一个 Tool 的 details，不导入 conversation 面板，也不处理其他 Tool。

`@deepseek-ai/dsh-client-ui-pto-experiments` 同时注册 `pto_experiment_compare` 的两个位置：紧凑 transcript row 与完整 details body。它只读取持久 Tool result，不调用 Host、不检查 artifact，也不维护另一份 registry projection。

Client parser 只接受闭合 comparison shape。`inconclusive` 必须包含两个已采集的 `pypto-chip-swimlane-makespan-v1` 观测、七个 matched identity、已登记 baseline experiment，以及与两边 metric 一致的 absolute/relative/direction。`incomparable` 必须没有 delta。失败、运行中、格式异常或内部不一致的结果都会 fail closed，不暴露数值 delta。

UI 始终保留 `inconclusive` 与 `needs-user-confirmation`。方向可以显示为降低、升高或不变，但绝不改写成 supported、成功或已验收。全局 overlay 延后到真实的跨实验列表、刷新或主动 dashboard 需求成立之后；届时必须有 registry projection 与 controller。

## 测试

model 测试覆盖放行的 -20% comparison、被篡改百分比降级为依据不可用、无 delta 的 incomparable 结果，以及 Tool error 隔离。Client aggregate typecheck 覆盖新 keyed owner type 与两个组件。package、slot、bundle purity、生成目录、双语配对和 Web 装配门禁覆盖整体接线。

## 考虑过的替代方案

**让 PTO 包占用 `conversation.details.tool`。** 拒绝，因为 single occupant 必须渲染所有 Tool，并会复制通用 fallback 契约。

**只渲染专用 transcript row。** 拒绝，因为七个 identity 维度与并列证据需要已选 call 的阅读面。

**从行直接打开 shell overlay。** 延后，因为一条已记录 Tool result 不是持久 dashboard 状态源；跨实验聚合需要显式 projection。

**信任任何成功 JSON。** 拒绝，因为 transport 成功但格式异常或内部不一致的 payload 不能展示业务 delta。

## 后果

PTO comparison 现在拥有 replay-stable 的行到 details 路径，无需新增 Host seam 或全局 UI 状态。其他业务 Tool 也可以复用 keyed details 契约，未知 Tool 继续使用通用 renderer。当前界面保持 call-scoped，刻意不提供跨 call 的实验列表或监控。
