# Agent Note: 应用自有的 PTO 指标比较

Status: implemented

[English](2026-08-27-pto-experiment-metric-comparison.md) | 中文

## 问题

PTO candidate 和 baseline 可能都包含看似性能数据的文件，但仍不可比。模型提供的 path 不能证明谁生成了 run、使用了哪个 metric definition、task 与 hardware identity 是否一致，也不能证明两次 observation 之间是哪个已提交 source change。直接将两个数字相减，会把不完整证据变成产品结论。反过来，如果 metric 缺失就让已识别 workload 失败，则会混淆 experiment execution 与可选 DFX availability。

PyPTO 拥有把 device cycle 和 task record 转换为 dispatch/finish timing 的逻辑。工作台必须消费这一权威实现，而不能把公式复制到一个会独立漂移的 parser 中；同时 artifact read 必须有界，L2/L3 数据仍留在现有 execution trust boundary 内。

## 决策

`PtoExperimentStore` 拥有固定的 `pypto-chip-swimlane-makespan-v1` 适配器。一次已识别的 L2 candidate 完成后，它只从精确的已占用 run 中读取 `dfx_outputs/chip_swimlane_records.json` 和 `compiled_meta.json`。路径必须保持 containment，文件大小受限。固定 Python probe 从已绑定 PyPTO environment 中导入 `simpler_setup.tools.swimlane_converter.read_perf_data()`，要求 chip-swimlane level 不小于 2，并将最晚 finish 减去最早 dispatch 作为单个 `device-dispatch-makespan` 值。

持久 observation 包含应用自有的 metric-definition identity、由 compiled contract 与已 join task topology 形成的 task identity、由 compiled platform/backend 与 swimlane clock/core fact 形成的 hardware identity、artifact digest，以及 source/environment/command lineage。run recognition 之后的 collection 使用 fail-soft：当前 artifact 缺失时为 `not-observed`；证据格式错误、越界、超限或不受支持时为 `invalid`；两种状态都保留已完成 experiment。该适配器刻意不猜测 L3 dispatch tree 或 legacy `l2_swimlane_records.json`。

`compare()` 和面向模型的 `pto_experiment_compare` 工具接受 expected revision 上的已完成记录。baseline 必须是同一 Workspace 内另一已完成 experiment 的已注册 actual output。只有 metric、task、hardware、environment、execution-command、source-root 和精确的已提交 Git-diff identity 全部可用且匹配时，服务才会输出 combined delta。任何 dimension 缺失或不相等时，都返回 `incomparable` 和 `delta: null`。

放行的 delta 会报告绝对与相对变化，以及更低 makespan 属于 improved、regressed 还是 unchanged。结果始终是 `inconclusive`，significance 为 `needs-user-confirmation`，因为 registry 尚不拥有 user-approved threshold、repetition count、variance model 或 significance rule。comparison 从 durable observation 按需派生；它不是另一个 mutable lifecycle transition。

## 测试

测试覆盖 collected metric 持久化、从 public view 移除 filesystem target key、完成 run 携带 `not-observed` metric、拒绝 unowned baseline、在非空 committed Git change 上放行更低 makespan delta，以及 task identity 变化时不可比。package type check、contract lint、generated catalog、双语配对和 Host build 覆盖 public 与 composed surface。

## 考虑过的替代方案

**比较任意 run directory。** 拒绝，因为 path recognition 只能证明 artifact shape，不能证明 app ownership、lineage、metric definition 或 baseline immutability。

**在 TypeScript 中重新实现 PyPTO cycle conversion。** 拒绝，因为 PyPTO converter 是权威的 join 和 timing implementation。第二个 parser 会与上游语义漂移。

**DFX 缺失时使已完成 experiment 失败。** 拒绝，因为已审批 workload 和已识别 output 可以有效，而可选 metric evidence 仍可能不可用。unavailable metric 应阻止 comparison，而不是改写 execution outcome。

**用一个更低值宣告 improvement。** 拒绝，因为 direction 是算术结果，而支持 hypothesis 需要本切片尚不具备的 user-owned threshold 和 repetition/significance policy。

**持久 comparison record。** 当前拒绝，因为结果是由 immutable observation 和固定 Git diff 纯派生的。持久它会增加 revision 和 invalidation 语义，却不会增加证据。

## 后果

工作台现在只会对自己生成且已识别的 run 展示有界、可解释的比较。证据缺失或不匹配会在 comparison boundary fail closed，同时 successful workload record 仍保持真实。服务不会静默接受 legacy 或 L3 layout，也尚不能做统计或业务 acceptance decision。增加这些 capability 需要新的版本化适配器或 policy layer，而不是通过猜测扩大本适配器。
