# @deepseek-ai/dsh-client-ui-pto-experiments

[English](README.md) | 中文

该纯浏览器包负责展示持久 PTO 实验。它注册由 `ptoExperimentDashboard` Remote 支撑、Session 作用域的 **实验** conversation view，并为 `pto_experiment_compare` 注册按工具名分派的会话行与 details 内容。details 子槽由 `ui-tool` 委托；没有专用注册的工具仍使用通用渲染器。

dashboard 通过已有 Session id 读取权威、Workspace 受限的 registry；浏览器不能提供路径。已规划行可以携带可见 optimistic revision 启动可信长执行 Remote。审批或执行活动期间，只有原发起 Session 的行会提供显式取消动作。卸载绝不发送取消；重新挂载会读取 Host 活动。execute/cancel 结算后触发权威刷新，loading、empty、action error 与 Remote error 状态都隔离在视图内部。

UI 受证据门控：它只接受闭合的对比 schema，并校验 `inconclusive` 差值确实来自两个 app-owned 度量以及七个一致的身份维度；UI 不重新计算或升级业务结论。失败、运行中或格式异常的输出只显示失败、等待或“依据不可用”，不会展示差值。

## 模型体验

### 对比结果展示

#### 模型看到的内容

没有新增内容。本包不增加 prompt 文本或 Tool definition。comparison 展示只渲染 Session log 中已经存在的冻结结果；dashboard 读取属于浏览器到 Host 的 UI 查询，不进入模型上下文。

#### Token 影响

无。本包不改变组装后的模型请求，也不会在 `pto_experiment_compare` 自身产生的结果之外增加 Tool result。

#### KV Cache 影响

无。展示只发生在浏览器本地，不改变可复用 prompt prefix 或任何按 Turn 提供给模型的上下文。

## 已知限制与延期项

- 当前仅支持单个 L2 run 的 chip-swimlane makespan schema。
- 自动轮询/push invalidation、全局 overlay、L3 依据、多样本统计与用户自定义阈值继续延期。
