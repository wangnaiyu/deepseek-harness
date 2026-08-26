---
description: "Target-neutral 对话装配与浏览器 shell：事件和视图注册表、逐会话 binding、输入状态、slot 与临时 composer takeover。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-conversation

[English](README.md) | 中文

## 概述

`ui-conversation` 拥有与 target 无关的 Conversation 组装和共享浏览器 shell。它消费 Session Controller 的 `SessionEventLikeEntry` feed，通过 `ctx.uiConversation` 暴露不依赖 React 的 registry 与逐 Session binding，并通过 `ctx.uiSession` 提供 `useConversation`、`useInput` 和 `inputActions` 标准 props。它还拥有按会话的持久化图片 URL 缓存：`ctx.uiConversation.imageUrl(sessionId, attachment)` 为每个附件解析一个经会话授权的浏览器 URL，并随 Session binding 释放而撤销，因此所有 Conversation target 共享一次 `session.attachment` 读取。Chat 等具体 target 位于独立 package，由各自 package 注册 Definition、snapshot builder、View 和 renderer。

没有 Agent 身份的浏览器草稿不会提供会话作用域的命令发现和控件。手工输入的斜杠命令本身可以作为首次提交：实体化后，捕获的文本会交由真实 Session 命令目录重新判定。

压缩（compaction）在检查点自身的消息流位置渲染为一行折叠标记，不替换其上方的 transcript（文本记录）。自动压缩使用「上下文已压缩」标题。每个已加载对应 `compaction/summary` 事件的完成标记都会显示被替换条目数量和估算 token 数量，并可点击展开摘要。手动 `/compact` 开始时显示为运行中的 `compact` 行；成功结算后，其显式摘要事件引用会在保持同一 React key 的前提下把该命令折叠进检查点行。完成的检查点静止时保留上下文压缩（context compaction）图标，仅在悬停或键盘聚焦时将其替换为收起／展开指示图标。输入被拒绝、没有可压缩历史、取消和失败时仍使用通用命令行及处理器撰写的文本。配对绝不依赖相邻关系，因为压缩运行期间可能注入持久上下文。面向模型的带框检查点载荷绝不渲染；被引用的 `compaction/summary` 事件位于已加载窗口之外时，检查点仍然可见但不可展开。

常驻会话壳会跨无会话与会话状态切换而保留。普通无选择页面仍把虚线编辑器作为 Workspace picker 入口；点击 New Session 后则安装不含 Session id 的浏览器输入机和目标 cwd，可直接编辑文本与图片，且不会创建或持久化任何实体。选择 Workspace 只改变该草稿的目标。首次提交才创建 Host Session、应用已暂存的前置准备并发送捕获的 prompt；同一 textarea DOM 会跨越这一状态转换继续存在。Host-cwd 草稿与没有注册 Workspace 归属的真实会话都把输入框左上方的标签显示为 `default`；它的 title tooltip 仍暴露实际执行使用的精确 cwd。Hero 前方的标记是独立的根作用域 `conversation.hero.brand.mark` slot，未被占用时回退到鱼形标记。彼此独立的严格会话页头和主体 outlet 只在实体化之后填入。Host blank 会话与活跃会话渲染同一编辑器主体，但在 prompt 被接受前不进入导航。活跃阶段，会话标题栏作为普通列 chrome，显示当前会话 title、可选谱系控件和视图标签；普通 fork 谱系仍保留为会话数据，不投影到标题栏。其下滚动容器（`data-conversation-scroll`）承载流动排版的各视图与 sticky 编辑器栈（统计 dock＋输入区 dock＋输入栏）。该滚动容器无条件预留自己的滚动条槽，选用编辑器 overlay 的视图也仍把它保留为滚动容器，因此无论对话记录是否滚动、无论展示哪个视图标签，输入卡片都保持同一个横向位置（[决策](../../../.agents/notes/implemented/bug-fix/2026-08-04-composer-tab-gutter-reservation.zh.md)）。textarea 上的滚轮会链式处理：限高草稿先在本地滚动，到达边缘后再转交给该宿主。只有 Safari 会在原生编辑缩短草稿并留下陈旧软换行溢出时执行绘制前恢复；草稿增长、程序化更新与其他浏览器都不会为这项恢复读取布局（[决策](../../../.agents/notes/archived/bug-fix/2026-08-13-safari-textarea-soft-wrap-reflow.md)）。

## 目录

- [Conversation 组装](#conversation-assembly)
- [Shell 与标准 props](#shell-and-standard-props)
- [临时 composer entry](#temporary-composer-entries)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="conversation-assembly"></a>
## Conversation 组装

`UiConversation.events` 是 event Definition 的唯一 registry，`UiConversation.views` 是 target snapshot builder 的唯一 registry。两者都拒绝重复 key、保持注册顺序、返回幂等 disposer，并在 contribution roster 变化时重建现有 binding。`UiConversation.binding(bindingOrSessionId)` 为当前 Session Controller binding 返回 identity 稳定的 Conversation binding，不会另开 event source。

adapter 把每个 `SessionEventLikeEntry` 直接交给 assembler。外层 `type` 区分 scalar 与 packed record，内部 `event` 则统一公开 `type`、`seq`、`time` 与 `data`；Definition 接收这个内部 `SessionEventLike`。历史 replace 与 prepend 接受两种 entry，实时 append 只接受 `SessionLiveEventEntry`。两种 event 都使用 Definition 的同一组 `match` 与 `update` 方法，`start` 则只接收标准 event，assembler 会拒绝 packed start。不消费 Assistant delta 的 Definition 对 packed tag 返回 `null`。replace window 或 revision 断档从完整已加载窗口重建；连续 revision 的 append 和 prepend 使用增量组装，并且不展开 packed member。assembler 拥有 Context 匹配、Turn/Step location、target node 物化、target activity 和稳定 target source。`ConversationSnapshot` 只包含与 target 无关的 View 与 active-target 事实；Session lifecycle 状态仍属于 `SessionSnapshot`。

shell 选择解析出 target 或 target source 收到首个 subscriber 时，该 target 进入 active 状态。assembler 从当前 Context 对它执行一次 replace，并使它参与后续增量 flush；创建 source 不会激活 target，取消订阅也不会停用 target。

target package 通过 declaration merge 扩展 snapshot 与 Location data map，再调用 `ctx.uiConversation.events.register(...)` 和 `ctx.uiConversation.views.register(...)`。target 通过 `ctx.uiConversation.binding(binding).target(targetId)` 读取其 Session-owned source。注册属于 Cordis effect，返回的 disposer 从同一个 registry 移除 contribution。

<a id="shell-and-standard-props"></a>
## Shell 与标准 props

本包注册 optional-Session `conversation` shell、strict Session header/body、View list、composer chain 与 bar、输入区域、Hero 区域、queue dock、草稿持久化和 phase 计算。`ctx.uiSession.provide()` 从同一个 Session binding 物化 Conversation 与 input source，并将 `inputActions` 作为稳定标准 prop 提供。

View 选择规则固定：有效且已注册的持久化选择优先，其次是已注册的 `chat`，否则不渲染 View；绝不选择第一个已注册 View。Shell phase 只组合 Session lifecycle 与 active-target set，不读取任何 target-specific snapshot。

Session 首次绑定或缓存的 Session 成为 current 时，shell 会在渲染前读取持久化 View 偏好，激活已注册的偏好 View 或 Chat fallback，并在后续 tab 或 focus 选择写入 store 前先激活对应 target。blank Session 仍不渲染 `conversation.view` slot；未选中的 target 不会激活。

审批通过本包声明的链条接管编辑器：`ApprovalPanel` 注册为按选择器路由的 `'conversation.composer'` 配置项（ui-user-questions 模式），在审批等待未决期间取代 InputBar 占据编辑器（琥珀色条、理由标题、来自运行中调用参数的配对命令行、一次性的拒绝／允许）。`contract/slots.ts` 中的 `PendingApproval` 领域面在运行时 `PendingWait` 载体之上拥有 wire 编码——带审计关联的 `ApprovalResponsePayload` 值；广播的 `approval/resolved` 帧使等待落定并恢复编辑器。运行时 manager 会将所有审批或问题等待通过 `SessionSummary.pendingInteraction` 投影出来，未实例化的会话也不例外；`ui-workspace` 负责其侧边栏呈现。未决等待完全离开消息流：问题（ui-user-questions）与审批（ApprovalPanel）都经编辑器接管作答，不再保留只读占位卡。编辑器底行 Access 控件挂载 `PermissionSelect`：真实 Session 通过标准工具包 `useProjection` 读取 host 计算的 `permissions` 投影（key 缺席即隐藏 chip），New Session 草稿则读取权限插件经 `ctx.conversation` 注册的可选数据源。chip 打开 Menu 原语下拉，其中 kebab-case 预设名渲染为 Title Case 标签。普通安全预设在真实 Session 中立即提交 `/permission <preset>`，在草稿中则保留到首次发送的前置准备；`danger-full-access` 在两条路径中都显示为 `Full access`，选择后先打开页面内的 Modal 风险确认。用户勾选确认项前启用按钮始终不可用；取消、Escape、关闭按钮与点击遮罩都不会提交命令。

常驻 composer 在无 Session 与有 Session 之间保持挂载。无 Session 时，同一个编辑器表面保持 inert，Workspace picker 连接 blank Session。该表面是 shell 所有的 Lexical 编辑器：引用 chip 是携带 owner 序列化身份的原子 decorator 节点（提交时经 owner codec 展开），已认领的 slash command 保持为带样式的行首文本，文件夹文本引用以图标前缀携带文件夹图形，草稿的剪贴板投影镜像到逐 Session Conversation store。Queue 操作通过 scoped `ctx.conversation` service 寻址准确的 queue occurrence；queue 预览经 `ui-primitives` 的共享行内引用投影渲染已发送文本（wire 会话形式折叠为其标签），并把本地图片预览或持久化图片部分显示为缩略图，编辑态则展示字面发送文本。持久化缩略图通过会话图片 URL 缓存解析。繁忙时 Enter 行为保存在 Host-backed `ui-conversation` settings namespace。

默认发送采用乐观提交：Enter 在同一事务里清空草稿、occurrence 表和撤销历史，composer 保持 `plain`，发送作为 detached attempt 运行，发送期间可以继续输入和提交。`sendSession` 在序列化之前用投递模式注册 Session 提交回显（`session.beginSubmission`）；Session 根据该模式与当前运行状态推导位置，因此空闲发送进入 transcript，繁忙时 Queue 进入 QueueDock，繁忙时 Steer 进入 pending-steering 区域。随后让出一帧，图片经浏览器原生 `FileReader` data-URL 路径编码。多个并发发送失败时，在用户编辑还原内容之前按提交顺序合并还原；命令提交保持冻结的 `submitting` 阶段。Detached attempt 持有图片 id，直到 admission 完成或 Session scope 销毁。回显以 observed 退休时，durable 图片缓存立即公开预览 URL，同时读取 admitted 附件，随后用规范化 URL 替换预览，并在两个 URL 各自停止使用后撤销。直接 subagent continuation 不创建本地回显，因为其 transport 不保留浏览器 request id。

普通 composer 运行时，如果草稿为空或输入不可用，主指针操作保持为 Stop。可提交的文字或附件会把同一位置切换为 Queue Send；清空或成功提交草稿后恢复 Stop。繁忙态 Enter 设置继续选择 Queue 或 Steer 键盘操作。可继续 subagent 保留独立的 Send 与 Stop 操作（[决策](../../../.agents/notes/implemented/bug-fix/2026-08-20-running-draft-primary-send.zh.md)）。

<a id="temporary-composer-entries"></a>
## 临时 composer entry

`conversation.composer` 是通用 chain，其完整 owner currency 为：

```ts type-equiv
/** Owner values used to elect a composer takeover. */
interface ComposerChainProps {
  /** Current Session identity used by temporary business-owned entries. */
  sessionId: SessionId | undefined
  /** Current Session lifecycle state, absent without a selected Session. */
  session: SessionSnapshot | undefined
  /** Effective business-owned interaction awaiting the user in this Session. */
  pendingInteraction: SessionPendingInteraction | undefined
}
```

业务 package 可仅在一个 Remote waterfall request pending 期间安装 entry：

输入栏为 `'conversation.input.plan'`（位于 access 模式右侧）声明会话作用域的单实例 seat，为 `'conversation.input.model'`（渲染在 pending 指示器与发送／停止控件之前）声明 `session-maybe` seat，并为 overlay、dock、left 和 right 输入扩展声明列表 slot。各功能包拥有相应控件及其状态；ui-conversation 提供放置位置、`locked` owner prop 和标准 slot share。前置加号按钮是能力 launcher，而非附件入口。在纯浏览器 New Session 草稿中，`+` 和键入 `/` 通过同一个 `InputTriggerController` 打开所有支持草稿的 `/` source；Workspace 与已暂存 Agent preset 变化会重定向该 controller，但不清空文本，pick 也只会向驻留输入机拼接文本。在真实 Session 中，现有 Command launcher 与 Session 所有的 Command／Skill sources 保持不变。`MenuView` 是两种状态中唯一的浮层菜单与 pick 路径。两条路径都不引入 File 行、file input、上传协议或第二套菜单组件。当 `plan` 投影的有效目标为 plan mode 时，InputBar 将文本框 placeholder 切换为 plan 任务措辞，经本包注册的 `conversation` locale 命名空间（`placeholder.plan` / `hint.plan` 键）本地化，并与已认领 `/plan` 命令的提示逐字共用同一份文案（经标准套件 `useProjection` 读取的 host 折叠值；owner 提供的 placeholder 优先）。另一个会话视图活跃时，待处理的 composer 接管仍保持挂载，使被阻塞的 agent（智能体）仍能收到回答；没有待处理交互时，活跃会话的 composer 归 Chat 所有。composer bar slot 本身为 `session-maybe`：普通无选择页面仍让消息操作不可交互并打开 Workspace picker；New Session 草稿则提供可用的纯浏览器输入机、能力文本插入、服务接缝提供的权限与 Agent preset 暂存，以及草稿安全的模型选择。输入栏不会换入平行树，因此选择 Workspace 与首次发送实体化都不会销毁 textarea DOM；必须寻址 Session 的控件在 Session 存在前仍保持为空。

```tsx
import type { ComposerChainProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChainSelect, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

interface Request {
  readonly sessionId: SessionId
}

type RequestComposerProps =
  PropsRuntime<'conversation.composer'> & { matched: Request }

const select: ChainSelect<ComposerChainProps, Request> = owner =>
  owner.sessionId === request.sessionId ? request : null

const dispose = ctx.slots.register(
  { name: 'conversation.composer', select },
  RequestComposer,
)

try {
  return await request.result
} finally {
  dispose()
}
```

selector 必须是 owner currency 的纯函数。非 null 返回值作为 `matched` 传给组件；`PropsRuntime<'conversation.composer'>` 提供标准 Session 与 global props。Chain 顺序仍按 `priority` 升序，再按注册顺序；首个返回非 null 的 selector 获选。Shell 会在 takeover 下保持默认 composer 挂载。Request 状态、listener、response encoding 和任何 request-specific child slot 都属于业务 package，不进入 `SessionSnapshot`，也不由 core package 声明。

<a id="model-experience"></a>
## 模型体验

无，因为本包渲染浏览器状态，并通过 Session Controller API 发送用户确认提交的输入，而不构造模型请求。

#### KV Cache 影响

无；Conversation 组装和浏览器输入状态不会改变提供方侧的 prompt cache。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- **只有已注册 target 可以渲染**——除已注册的 `chat` 偏好外，shell 刻意不提供隐式 fallback target。


<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。Conversation Definition、target builder 与 View 已由其所属注册表和 Slot ledger 校验。
