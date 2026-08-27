# @deepseek-ai/dsh-pto-experiments

[English](README.md) | 中文

持久、限定于 Workspace 的 PTO 实验规划、查询、可信 Host 执行、指标采集与比较服务。它拥有 `ctx.ptoExperiments`、`pto_experiments` storage domain、四个模型工具和一个非工具的 `execute()` 准入 API。

## 服务契约

`plan(scope, input)` 通过 `ctx.fs` 解析 Session Workspace、source、baseline 与 candidate。source 和 baseline 必须是 Workspace 内已有目录；candidate 必须不存在、位于 source 内、与 baseline 不相交，并且未被该 Workspace 的其他 experiment 占用。baseline 准入复用 `@deepseek-ai/dsh-tool-pto-run` 的 `recognizePtoRun()`。

服务把 candidate 所有权检查与每次持久 put 串行化。planned 记录使用 Host 生成的 id、整记录 revision `0` 和仅追加的 `planned` 事件；source/environment identity 未验证，`authorization: null`，`candidateOutput.precondition: absent-observed`，并记录未来执行的精确 command 与 timeout。规划不会创建 candidate 路径、修改 source、请求审批或执行工作。

`get(scope, id)` 与 `list(scope, limit?)` 会比较当前已解析 Workspace target identity 和持久 owner。其他 Workspace 无法获得记录。列表按最新优先排序，默认上限为 20，最大为 100，并通过 `total` 与 `truncated` 报告省略行。返回的 view 都是分离副本，并省略只用于 storage 的 Workspace 与 filesystem target key。

`execute(scope, { experimentId, expectedRevision })` 是可信 Host API，刻意不注册为模型工具。它只接受 expected revision 上的 `planned`，并完整执行准入回路：确认审批 Agent Session 拥有同一 Workspace；重新解析 containment、disjointness、baseline recognition 与 candidate absence；绑定干净 Git `HEAD` identity 与固定 Python/PyPTO environment probe；请用户审批该精确 revision、identity pair、output path、command、timeout、declared change、stop condition 与 rollback plan；随后再次检查 identity 和 path，最后原子占用 candidate directory。

只有 `allowed-once` 会继续。一次持久 put 绑定 service 签发的 approval id，记录两个可信 identity 和 reservation version，并在 workload 开始前追加 `identities-bound`、`authorized` 与 `execution-started`。存储的 command 从 source 开始，在 `danger-full-access` 下运行，环境中提供 `DSH_PTO_EXPERIMENT_ID` 与 `DSH_PTO_EXPERIMENT_OUTPUT_DIR`；workload 必须把精确 recognized run 直接写入该受管 output directory。只有在 `recognizePtoRun()` 识别该目录后，exit zero 才会完成。其他 exit、signal、timeout、sandbox 失败、infrastructure 失败、cancellation 或 PTO marker 缺失都会落为 terminal `failed`/`cancelled` 事件。一旦 `running` 已持久化，terminal settlement 会明确移除 workload cancellation signal，避免终止命令时连同审计写入一起中止。不持久化 stdout/stderr 内容。

zod 持久 schema 验证 `planned → authorized → running → completed|failed|cancelled` 以及连续 event ledger，且最后 revision/state 与物化记录一致。service 初始化时，持久 `running` 记录会恢复为 `failed`，因为它的前台进程无法跨越 Host restart 存活。不存在细粒度 authorize/begin/complete method 或模型工具。

一次已识别的 L2 run 完成后，应用自有的 `pypto-chip-swimlane-makespan-v1` 适配器会从该精确 run 中读取有界的当前 `dfx_outputs/chip_swimlane_records.json` 和 `compiled_meta.json` 产物。固定 Python probe 调用 PyPTO 官方 `read_perf_data()` 转换，记录单个 `device-dispatch-makespan` 观测值，以及 metric、task、hardware、source、environment、command 和 artifact identity。缺失、格式错误、legacy、不受支持或 L3 证据会记录 `not-observed`/`invalid`，而不会使已完成 run 失败。

`compare(scope, { experimentId, expectedRevision })` 同时以 `pto_experiment_compare` 形式提供。它只接受 expected revision 上的已完成记录，而且只会与同一 Workspace 内由应用拥有的另一已完成实验 output 作为 baseline 比较。metric、task、hardware、environment、command、source-root 和精确的已提交 Git diff identity 必须全部匹配，才会计算 delta。在存在用户拥有的 threshold 与 repetition/significance rule 之前，放行的单次观测 delta 仍是 `inconclusive`；任何缺失或不匹配证据都返回没有 delta 的 `incomparable`。

## 失败与边界

必填文本字段最多接受 4,096 个字符。一条 proposal 最多接受 64 个 evidence reference，每个最多 1,024 个字符。execution timeout 默认一小时，不能超过部署的 `maxExecutionTimeoutMs`（默认 24 小时）。chip-swimlane input 默认受 64 MiB 的 `maxMetricArtifactBytes` 上限约束；`compiled_meta.json` 固定上限为 1 MiB。路径无效、baseline marker 不受支持、违反 containment 或 disjointness、candidate 已存在、candidate 所有权重复、limit/revision 无效、记录不存在、跨 Workspace 访问、source 脏或非 Git，以及 PyPTO 不可用都会 fail closed。

source 必须是干净、已提交的 Git worktree，包括没有 untracked file。candidate 的 parent directory 必须已存在，因为 reservation 刻意不递归。如果 reservation 成功但后续持久 put 失败，可能留下空的 orphan candidate directory；没有 workload 会开始，而且不可复用的 path 会让该失败保持可见并 fail closed。

## 模型体验

### 工具 schema

#### 模型看到的内容

PTO profile 启用本包时，模型会看到生成的 [`pto_experiment_plan`、`pto_experiment_get`、`pto_experiment_list` 与 `pto_experiment_compare` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-pto-experiments)。prompt 明确说明规划只记录不存在观察，不会授权工作、占用 output、修改 source 或执行 workload，同时说明比较要求两侧都来自应用自有采集。

#### Token 影响

四个 schema 和一段简短 prompt section 构成固定请求前缀。plan/get 返回一条完整记录；list 最多返回请求的有界数量；compare 返回两个 metric observation、七个 identity dimension 和最多一个 delta。

#### KV Cache 影响

只要插件 scope 不变，定义前缀就保持稳定。工具参数和结果追加在可复用前缀之后。

### 工具调用历史与结果

#### 模型看到的内容

结果采用结构化 JSON。planned 记录保留 baseline/source/environment/change/control/execution 事实，并显式暴露未验证 identity、仅观察到 output 不存在以及缺少授权。Host execution 不能由模型调用；之后的 get/list 结果可以暴露持久的可信 identity、approval receipt、lifecycle ledger、actual-run recognition、metric observation 或有界 failure reason。证据缺失或不匹配时，compare 返回没有 delta 的 `incomparable`；否则返回一个 `inconclusive` 的方向性 delta。list 结果携带 `experiments`、`total` 与 `truncated`。

#### Token 影响

单条记录大小随声明的 control 与 evidence reference 变化。list 输出随有界记录数变化，并可通过 `limit` 缩小。

#### KV Cache 影响

持久工具结果仍是普通的仅追加历史，不会使更早的定义前缀失效。

## 已知限制与暂缓事项

- domain 没有删除、归档或 retry 操作。list 有界，但 storage 会随 experiment 增长；terminal record 不能返回 `planned`。
- crash recovery 把中断的前台 run 记录为 failed；它无法重新附着或终止前一个 Host lifetime 的进程。
- environment adapter 识别已配置 Python 和可导入 PyPTO package，但尚未绑定 driver、device、compiler binary 或 workload-specific dependency。
- 指标采集仅支持当前 L2 `chip_swimlane_records.json` 加 `compiled_meta.json` 形状。legacy `l2_swimlane_records.json`、L3 dispatch tree、自动 rerun、多次观测、threshold/significance policy 和 experiment UI 仍延后。
