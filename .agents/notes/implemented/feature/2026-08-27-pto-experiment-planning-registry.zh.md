# Agent Note: 持久 PTO experiment 规划记录

Status: implemented

[English](2026-08-27-pto-experiment-planning-registry.md) | 中文

## Problem

PTO 分析、调试、优化、比较与复盘可以描述 candidate experiment，但普通模型回答、Skill 文档、shell transcript 或 output directory 名称无法建立 app-owned experiment identity。真实执行需要一条持久记录，绑定 immutable baseline、可恢复的 source Workspace、environment、declared change、candidate output、停止与回滚控制、authorization 和 actual run。在应用能够证明用户授权并独占 candidate directory 前创建 execution transition，会把路径观察和通用 approval outcome 夸大成它们并不提供的保证。

## Decision

`@deepseek-ai/dsh-pto-experiments` 拥有 `ctx.ptoExperiments` 与带版本的 `pto_experiments` storage domain。它向模型暴露 `pto_experiment_plan`、`pto_experiment_get` 和 `pto_experiment_list`。规划通过 `ctx.fs` 解析全部路径，将它们限制在调用 Session Workspace 内，通过 [`recognizePtoRun()`](../../../../packages/pto/tool-pto-run/README.zh.md#host-api) 准入 baseline，要求 candidate 在 source 内不存在并与 baseline 不相交，并把重复 candidate 所有权检查和持久写入串行化。

每条 proposal 获得 Host 生成的 id、revision `0` 和从 `planned` 开始的连续仅追加 event ledger。规划时，source 与 environment identity 保持 `unverified`，authorization 与 actual run 保持 `null`，candidate precondition 为 `absent-observed`。模型工具仍只写 `planned@revision=0`；后续可信 Host API 按[执行准入 Agent Note](../architecture/2026-08-27-pto-experiment-execution-admission.zh.md) 拥有其余 lifecycle transition。

Workspace 所有权使用文件系统 provider 的 opaque target identity，而非 caller 提供的路径字符串。读取和有界的最新优先列表只为当前 Workspace 返回分离 public view；只用于 storage 的 Workspace 与 filesystem target key 不会进入模型结果。JSON domain storage 在 Host 重启后恢复相同记录。

### Authorization 与 reservation 边界

在该 planning 切片中，通用 approval service 返回 `allowed-once`，但不返回由 service 签发的审计 request id。后续 execution 切片新增 `requestDecision()`，使一条可信路径可绑定 experiment id、expected revision、actor、Session id 和 approval audit id。

在该 planning 切片中，文件系统服务能观察目录不存在，但没有通用的独占目录创建操作。规划仍不能只为占住 proposal 而创建可能被遗弃的 candidate directory。execution 切片新增原子 `reserveDirectory()`；executor 只在 reservation 成功后提交 `running`。PyPTO 宽松的 `exist_ok=True` output 创建仍不适合作为 reservation 机制。

## Testing

单元和真实 Loader/YAML composition 测试覆盖 L2/L3 marker 复用、持久 JSON 重启、跨 Workspace 拒绝、并发重复 candidate proposal、baseline/candidate disjointness、不创建 candidate、模型可见工具注册，以及 prompt 的非授权声明。package zod schema 会在重新打开时校验持久记录与 ledger。

## Alternatives considered

**持久化 Skill 或 shell transcript。** 拒绝，因为 presentation history 不提供原子 record revision、Workspace 所有权、candidate 唯一性或 executor-only transition。

**向模型暴露 authorization 与 lifecycle 工具。** 拒绝，因为模型调用无法证明用户决定或 executor outcome。proposal 与 query 面向模型；权威 transition 属于可信 Host 消费方。

**把规划时的 absence 当作 output reservation。** 拒绝，因为观察后其他进程仍可创建该路径，并且 PyPTO 接受已存在的显式 output directory。

**在规划时创建 candidate directory。** 拒绝，因为 proposal 不是已授权执行，废弃计划会留下语义不明的目录，并且当前文件系统抽象不拥有独占目录创建操作。

**复制 PyPTO run marker 逻辑。** 拒绝，因为两套 recognizer 会漂移。`tool-pto-run` 导出由发现与 experiment planning 共用的唯一 marker-backed Host API。

## Consequences

PTO Skills 与后续 UI 可以引用一条持久、归属 Workspace 的 proposal，而不暗示它已经运行。Host 重启会保留 proposal，并发 plan 不能在同一 service instance 内认领同一 candidate，模型可见文本会如实区分 observed absence、authorization 与 reservation。

虽然现在由独立可信 Host API 闭合操作回路，规划边界仍不变：模型调用不能 authorize 或 settle experiment，`absent-observed` 仍不是锁。在归档策略和消费方证明删除操作有必要前，planned 与 terminal record 会持续累积。
