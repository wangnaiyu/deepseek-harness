# Agent Note: 对 fork 友好的资源型拉取请求 CI

Status: implemented

[English](2026-08-25-fork-friendly-resource-shaped-ci.md) | 中文

## Problem

七个拉取请求 job 使用规范仓库拥有的具名 16 核 Linux 和 Windows runner。GitHub fork 不会继承这些 runner、仓库变量或自托管资源池。因此，在 fork 中原样运行工作流会让 checks 永久排队且始终没有 runner，掩盖真正执行过的检查，并阻止汇总结论完成。

这些 job 的资源预算和并发设置属于规范 CI 拓扑。直接把穷尽式套件转移到较小的公共 runner 会改变该契约，并可能产生超时或不可直接比较的覆盖信号。

## Decision

[拉取请求 CI](../../../../.github/workflows/ci.yml) 在所有仓库中保留现有 check 名称。在 `deepseek-ai/deepseek-harness` 中，三个 Linux job 和四个拆分后的原生 Windows job 保留具名大规格 runner 与自托管故障切换选择器，所有设置和 gate 步骤也仍然只在规范仓库执行。

在 fork 中，每个相关 job 选择 `ubuntu-latest`，只运行一个明确的成功步骤，说明 fork 不继承规范仓库的大规格 runner，并由上游 CI 负责穷尽式 gate。fork 不会在这七个 job 中 checkout 代码、安装依赖、恢复缓存、准备沙箱或执行资源型套件。三个阻塞型 Linux no-op 与必需的 Windows no-op 仍然作为 `all checks passed` 的依赖，使汇总结论能够完成，同时保持稳定的 check 名称。

标准托管的兼容性、SDK、发布形态运行时和 Wine job 在 fork 中继续运行。穷尽式静态、覆盖率、快照/制品和原生 Windows 信号由本地验证及之后的规范仓库 CI 负责。

## Verification

[工作流测试](../../../../scripts/ci-workflow.spec.ts) 固定 fork 使用的公共 runner、明确的 no-op、不得在 job 级按仓库跳过，以及每个资源型步骤上的规范仓库 gate。测试也继续固定规范 Linux/Windows 故障切换选择器和汇总依赖关系。

## Alternatives considered

**让 job 保持排队。** fork 无法获得规范 runner 标签，因此等待不会增加验证，只会让 PR 永久处于未完成状态。

**在 fork 的标准公共 runner 上执行穷尽式套件。** 这看似更完整，但这些套件和并发预算是为 16 核 runner 设计的；静默改变硬件会使信号更慢、更难比较，并可能超过托管限制。

**从 fork 工作流中删除七个 job。** 这样能避免排队，但会改变 check 可见性和汇总依赖图。明确的 no-op 能保留稳定名称，并在日志中展示仓库边界。

**为每个 fork 注册匹配的自托管 runner。** 这会以显著的运维和安全成本复制规范拓扑，不应成为贡献者的前置条件。

## Consequences

fork 拉取请求不再无限等待不可用的基础设施，并且日志会准确说明哪些穷尽式检查没有执行。fork 的绿色结果并不声称七个资源型套件已经运行；上游 CI 或已披露的本地验证仍须提供相应证据。

规范仓库的 runner 选择、故障切换控制和测试清单保持不变。工作流需要在相关步骤上重复仓库 guard，虽然更冗长，但可以机械测试，并能防止未来新增的设置或 gate 步骤意外在 fork 中运行。
