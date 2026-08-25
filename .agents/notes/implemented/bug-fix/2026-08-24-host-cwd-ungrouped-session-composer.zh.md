# Agent Note: Host-cwd 未分组会话保持输入框可用

Status: implemented

[English](2026-08-24-host-cwd-ungrouped-session-composer.md) | 中文

## 问题

未分组 `+` 原先会立即调用 `session.create({})`。这不仅使 Host-cwd composer 短暂缺少已解析路径，还意味着只点一下就会分配 SessionId，即使用户永远不发送消息也可能留下持久化文件。

这会让未分组组行的显式创建动作导航到一个真实会话，却仍要求操作者先选择 Workspace 才能输入，与 Host-cwd 创建约定矛盾。

## 决策

两个“新会话”入口现在都只创建 `WorkspaceListState.sessionDraft`：浏览器本地文本／图片、本地 revision 与目标 Workspace/cwd，不含 SessionId，也不调用 Host。未分组入口使用连接握手已公布的 Host cwd；标题栏入口继承明确／当前／最近 Workspace，最后回退到 Host cwd。选择 Workspace 只会重新定向同一份草稿。

常驻无会话 composer 经标准 provide channel 获得不依赖会话身份的草稿输入机。首次提交是唯一实体化边界：调用 `session.create`、open 新会话、等待 Agent Preset 等前置准备，再发送捕获的 prompt。创建失败保留浏览器草稿。导航隐藏所有 Host `blank` 行，因此 create 到 prompt 的短暂区间也不会新增侧边栏入口。

Session 前草稿没有可寻址的 Agent 身份，因此不能查询 Agent 绑定的命令目录。其前置 Command 按钮会在当前 selection 插入 `/`，而不是打开该目录；手工输入的斜杠命令仍可作为首次提交，因为系统会先实体化，再把捕获的文本交给新 Session 输入机，并按其真实目录判定。

来源不依赖 Agent 身份的控件可以保持可用，而不削弱生命周期边界。模型 seat 通过 Host 作用域的 `llm.models` 加载目录，并把完整选择暂存在浏览器内存。Access seat 从 Host Settings 描述符推导动态预设列表，同样只暂存被选中的 key。首次发送按顺序先组合 Agent Preset，再把暂存模型与权限选择应用到所得 Session，最后才放行捕获的 prompt。打开任一菜单或选择任一值都不会分配 SessionId，也不会写入 Session 持久化；Full access 必须经过显式风险确认才能暂存。

`session.create` 成功响应仍返回最终解析的 `cwd`，用于首次发送后的真实会话即时投影。

空白会话 Hero 在会话有注册 Workspace 归属时使用 Workspace 标题，否则显示与 Host-cwd 持久化桶共用的稳定 `default` 标签。Workspace 按钮通过 title tooltip 暴露精确 cwd。已选中且 cwd 非空的空白会话保持文本框可编辑；Workspace 选择器仍作为可选的重新定向入口。只有完全没有会话，或临时会话的 cwd 尚不可用时，输入框才采用仅选择 Workspace 的姿态。

Workspace 注册被删除后，会话仍保持这一行为：Workspace 成员关系控制分组和注册表操作，会话 cwd 控制 agent 的工作作用域。

首条被接受的 prompt 会把摘要 `blank` 翻为 false；只有此时才在 Workspace 或未分组中显示并置顶会话行。

## 备选方案

**立即创建、仅隐藏 blank 行。** 这只修复呈现，却违反生命周期边界：被放弃的点击仍会分配身份并可能留下存储。

**等待 `session.list` 或 `host/session-added`。** 两者最终都会携带 cwd，但让输入可用性依赖额外回声，会在创建 RPC 已经提交会话后重新引入可见延迟与顺序敏感性。

**自动把 Host cwd 注册为 Workspace。** 注册会改变持久分组和账户成员关系。显式创建未分组会话不得修改 Workspace 注册表。

**要求所有浏览器 prompt 都必须使用 Workspace。** Host 支持独立于 Workspace 注册表的 cwd 作用域会话。保留 UI 限制会让一个有效后端能力无法从其显式浏览器入口使用。

## 后果

- `session.create` 成功值新增必填 `cwd` 字段。本仓库仍处于预发布阶段，因此测试 carrier 与 fixture 统一迁移到完整响应，不增加可选兼容字段。
- 点击任一新会话入口都不调用 `session.create`、不分配 SessionId、不写入会话持久化文件。
- 首次发送实体化后，创建响应与 `session.list` 呈现同一 cwd。
- 未分组会话即使 cwd 与已注册 Workspace 路径相同，也仍不加入其成员关系与排序。
- 展开的空未分组桶拥有自身局部空态，即使其他 Workspace 分组已有会话也显示提示。空白会话不会压掉该提示或渲染临时行。
- Runtime 与对话组件覆盖会固定点击时不创建、首次发送才实体化、prompt 前按序完成前置准备、cwd 可见、草稿输入可编辑、Workspace 选择器继续可用、草稿模型暂存与草稿 Command 插入。
