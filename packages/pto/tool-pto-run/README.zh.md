---
description: "只读 PyPTO run 发现、marker 识别与有界产物能力检查；供无需读取产物内容即可定位证据的用户与维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-pto-run

[English](README.md) | 中文

## 概述

面向当前 Session workspace 的只读 PTO run 发现与产物能力检查。

## 目录

- [工具](#tools)
- [Host API](#host-api)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="tools"></a>
## 工具

- `pto_run_discover` 执行有界、按需扫描。它通过顶层 `kernel_config.py` 识别 PyPTO 3.0 L2 run，通过 `orchestration/host_orch.py` 识别 L3 run；名称和时间戳从不作为识别证据。
- `pto_run_inspect` 接受 workspace 内的 run 路径，报告归一化证据、compile 侧健康状态、可选 DFX 的准确补采 literal、诊断产物路径与复跑能力，不读取产物内容，也不推断诊断结论。

发现时会剪枝 `.git`、`node_modules`、`__pycache__` 和 `3rdparty`，识别出 run 后停止下探，并且不会把 `next_levels` 子构建暴露为独立 run。检查时会把这些子构建放在 L3 父 run 下报告。

<a id="host-api"></a>
## Host API

`recognizePtoRun(fs, target, signal?)` 暴露与发现工具相同的 marker 检查，但不建立产物清单。Host 侧 PTO 消费方用它准入一个已知目录，无需维护第二套 recognizer。目录没有受支持的 marker 时返回 `undefined`；文件系统或取消失败会原样传播。

<a id="model-experience"></a>
## 模型体验

### 工具 schema

#### 模型看到的内容

插件可见时，模型会看到生成的 [`pto_run_discover` 与 `pto_run_inspect` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-pto-run)。发现工具没有参数；检查工具接收发现结果返回的 `run_path`，或 Session workspace 内的其他路径。

#### Token 影响

两个 schema 和一段简短 prompt section 构成固定请求前缀。结果大小随识别出的 run、产物和 L3 子构建数量变化，并受部署边界约束。

#### KV Cache 影响

只要插件配置和 scope 可见性不变，定义前缀就保持稳定。每次结果都追加在可复用前缀之后。

### 工具调用历史与结果

#### 模型看到的内容

结果采用结构化 JSON。能力状态为 `available`、`not-observed` 或 `unknown`；`not-observed` 只表示有界产物清单没有找到支持证据。可选 DFX 能力携带准确的 `RunConfig` 与 pytest 补采 literal。只有完整 L2 清单在 `passes_dump/`、`ptoas/` 和 `kernels/` 下均未观察到文件时，`runHealth.compileStatus` 才是 `incomplete-or-failed`；清单截断与 L3 父 run 保持 `unknown`。run identity 保持 `unverified`，因为目录名不能建立源码或构建身份。

#### Token 影响

发现结果较紧凑。检查结果包含固定能力列表及观察到的相对路径；分布式 run 可能更大。

#### KV Cache 影响

工具参数和结果只追加，不会使更早的定义前缀失效。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- recognizer 和归一化能力名面向 PyPTO 3.0 产物契约，不分类 PyPTO 2.x 或 Pro run。
- 扫描是有限的；当目录数、深度或结果数达到配置边界，且无法给出完整答案时会报告 `truncated=true`。
- 产物存在只证明观察到证据，不能证明 freshness、完整性、源码身份、因果诊断或 raw 数据可安全分享。
- 可选 DFX 缺失与 compile 侧不完整分别报告。DFX 产物缺失也可能来自执行中断，因此补采 literal 是恢复辅助，不是原因证明。
- L3 父 run 的 compile 健康状态保持 `unknown`；作出 compile 侧健康判断前应检查相关 `next_levels` 子构建。
- `fullRecompile` 保持 `unknown`，因为它依赖兼容的源码 workspace、依赖和工具链，而非 run 目录单体。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
