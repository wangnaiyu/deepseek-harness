# Agent Note：可信 PTO 实验执行准入

Status: implemented

[English](2026-08-27-pto-experiment-execution-admission.md) | 中文

## 问题

一条持久 PTO proposal 并不是运行任意 command 的授权。workload 执行前，Host 必须证明用户看到的是哪个不可变 source revision 与 PyPTO environment，把 one-shot decision 绑定到精确 experiment revision，独占新 output directory，并让 `running` 持久。独立 model tool 或 observed-absent path 会允许重排、过期或伪造的 transition。

PyPTO 3.0 不提供 reservation primitive：它的 compile path 使用 `exist_ok=True` 接受显式 output directory，而 build-dir 环境变量只是生成 child 的 base。因此 application 需要一份位于 PyPTO 之外的精确 candidate-path contract。

## 决策

`ApprovalService.requestDecision()` 只在两个 approval event 都 commit 后，把 service 签发的 audit id 与 closed outcome 一起返回。`FileSystem.reserveDirectory()` 原子创建一个空的最终 directory，要求 parent 已存在，以 `FS_ALREADY_EXISTS` 拒绝任何现有 final entry，并绝不把已 commit 的 creation 变成模糊 abort。local、sandboxed-local 和 E2B provider 实现同一 contract。

`PtoExperimentStore.execute()` 是唯一 execution transition API，不是 model tool。它接受 Agent Session、Workspace、experiment id 和 expected planned revision。它验证 Workspace ownership；重新解析已记录 target identity、containment、baseline disjointness/recognition 与 candidate absence；再用固定 subprocess argv 绑定干净 Git `HEAD` 和已配置 Python/PyPTO environment。用户会看到该精确 revision、两个 identity hash、candidate、已存储 command 和 timeout、declared change、stop condition、rollback 以及 `danger-full-access` mode。

只有 `allowed-once` 会继续。executor 在审批后重复 identity 和可变 target 检查，占用 candidate，并执行一次 whole-record put：追加 `identities-bound`、`authorized` 与 `execution-started`，并在 work 开始前让 `running` 持久。它从 source 运行已存储 command，并提供 Host 拥有的 `DSH_PTO_EXPERIMENT_ID` 与精确 `DSH_PTO_EXPERIMENT_OUTPUT_DIR`。它不持久 stdout/stderr 内容。只有精确 directory 通过共享 PTO run recognizer 识别时，exit zero 才完成；其他 outcome 都是 terminal failed/cancelled。初始化会把遗留的前台 `running` record 恢复为 failed。

Dashboard execution 通过发起 live Agent 上的私有 plugin follow-up 进入同一 API。dashboard gateway 在 `agent/pre-step` 消费该 message，拥有 blocked turn 并返回 `reject`，因而 approval event 保留必需的 open-turn audit boundary，但不产生模型可见 `user/message`、model step 或 LLM request。Host 拥有的 controller 取消 workload，terminal registry settlement 则有意移除已 abort 的 workload signal，使 durable `cancelled` 不会被抑制。如果取消移除了尚在队列中的 follow-up，gateway 从当前 durable record 结算长执行调用；读取失败会拒绝两个调用，而不会遗留孤儿调用。

## 测试

测试覆盖 approval audit-id 绑定、local exclusive directory creation 与并发 one-winner 行为、sandbox containment、完整 allowed route、拒绝且不 reservation、dirty-source 在 approval 前失败、zero-exit output 缺少 PTO marker、durable `running` 之后取消，以及 pre-step 之前取消。真实 PTO profile 的浏览器 QA 覆盖 approval-to-completion，以及 running/unmount/remount/cancel-to-durable-cancelled。package type check 与完整 Host build 验证 planning-only composition 仍可加载，而 execution dependency 由 Host route 动态要求。

## 考虑过的替代方案

**暴露 bind/authorize/begin/complete tool。** 拒绝，因为 model call 不能证明 user decision、filesystem reservation、process result 或这些事实的顺序。

**让 workload 创建 candidate。** 拒绝，因为 PyPTO 的 `exist_ok=True` 行为无法区分 exclusive ownership、reuse 或 check-create race。

**规划时 reservation。** 拒绝，因为 proposal 不是 authorized execution，abandoned proposal 会消耗 path。

**使用 caller-supplied identity string 或 probe command。** 拒绝，因为 caller 可以伪造 trust fact。Host 拥有固定 Git 与 Python/PyPTO probe；已审批 workload command 仍是独立 declared execution input。

**为诊断持久化 command output。** 本切片拒绝，因为 output 可能包含 L2/L3 数据。terminal record 保留 process 和 recognition fact，而非 captured content。

## 后果

在绑定 revision 的 user receipt、重复 trusted identity verification、exclusive output ownership 和 durable `running` state 之前，没有 workload 会开始。模型保留 proposal/query capability，但没有 state-mutation escape hatch。干净已提交 Git 是有意设置的 recoverability 要求；untracked source change 会使准入失败。

如果 directory reservation commit，而后续 durable put 失败，可能留下 empty orphan directory。这是 fail-closed：workload 绝不开始，path 也不能被静默复用。Host restart 无法重新附着前台 child，因此 recovery 记录 failure，而不声称 completion。应用自有的 metric collection/comparison 与 Session-scoped experiment UI 现在都是同一 registry 的下游 consumer；driver/device/compiler identity 与 retry/archive policy 仍是后续工作。
