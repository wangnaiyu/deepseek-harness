---
description: "PTO 包组：面向选择或查找优化能力的读者，提供持久实验编排与只读 PyPTO run 证据。"
kind: "package-group"
---

# pto/ — 实验与 run 证据能力

[English](README.md) | 中文

## 概述

PTO 包组让 Agent 在一个 Workspace 内发现已有 PyPTO run，并管理持久、证据门控的优化实验。`tool-pto-run` 负责只读 run 识别和有界产物检查。`pto-experiments` 负责规划、可信执行、指标采集与比较。两个包都把路径限制在当前 Session Workspace 内。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

这些包把已有证据的观察与受管实验的创建和比较分开。

| 包 | 作用 |
|---|---|
| [`pto-experiments`](pto-experiments/README.zh.md) | 规划、执行、记录、度量并比较持久 PTO 实验。 |
| [`tool-pto-run`](tool-pto-run/README.zh.md) | 发现受支持的 PyPTO run，并在不读取产物内容的情况下报告有界产物能力。 |

<a id="related-documentation"></a>
## 相关文档

- [PTO 实验子系统](../../docs/subsystems/pto-experiments.zh.md)——类型、生命周期规则、可信执行与比较语义。
- [工具目录](../../docs/tool-catalog.zh.md)——面向模型的 PTO 工具生成 schema。

<a id="dev-note"></a>
## 开发备注

无。
