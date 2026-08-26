---
description: "Target-neutral 对话装配与浏览器 shell：事件和视图注册表、逐会话 binding、输入状态、slot 与临时 composer takeover。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-conversation

[English](README.md) | 中文

## 概述

`ui-conversation` 拥有与 target 无关的 Conversation 组装和共享浏览器 shell。它消费 Session Controller 的 `SessionEventLikeEntry` feed，通过 `ctx.uiConversation` 暴露不依赖 React 的注册表与逐 Session binding，并通过 `ctx.uiSession` 提供 `useConversation`、`useInput` 和 `inputActions` 标准 props。它还拥有按会话的持久化图片 URL 缓存：`ctx.uiConversation.imageUrl(sessionId, attachment)` 为每个附件解析一个经会话授权的浏览器 URL，并随 Session binding 释放而撤销，因此所有 Conversation target 共享一次 `session.attachment` 读取。Chat 等具体 target 位于独立包，由各自包注册 Definition、快照 builder、View 和 renderer。

没有 Agent 身份的浏览器草稿不会提供会话作用域的命令发现和控件。手工输入的斜杠命令或规范 Skill 手势本身可以作为首次提交：实体化后，捕获的文本会与真实 Session 能力目录对比。能力消失、来源／策略改变或新出现的命令／Skill 冲突会在 prompt 提交前拒绝；payload 保留在当前可见的真实 Session composer 中，可修正后重试。

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

`UiConversation.events` 是 event Definition 的唯一 registry，`UiConversation.views` 是 target snapshot builder 的唯一 registry。两者都拒绝重复 key、保持注册顺序、返回幂等 disposer，并在 contribution roster 变化时重建现有 binding。`UiConversation.binding(bindingOrSessionId)` 为当前 Session Controller binding 返回 identity 稳定的 Conversation binding，不会另开事件源。 View Definition 可以声明 `toolCallFocus`，将工具调用 id 转换为自身的焦点标识。仅当此目标拥有可见的 View 条目时，Conversation 才提供 Inspect 回调；Chat 直接使用回调，不选择目标。

适配器把每个 `SessionEventLikeEntry` 直接交给 assembler。外层 `type` 区分持久事件与 Client-only transient event，内部 `event` 则统一公开 `type`、`seq`、`time` 与 `data`；Definition 接收这个内部 `SessionEventLike`。replacement window 可以包含两种 entry，历史 prepend 携带持久 entry，实时 append 则可以携带任一种。持久与瞬态事件使用同一组 match/start/update 接口。当前最早的 start 初始化 State；后续所有 Match，包括同一身份的其他 start，都用于更新。不消费 Assistant delta 的 Definition 对 `assistant/live-chunk` 返回 `null`。replace window 或 revision 断档从完整已加载窗口重建；连续 revision 的 append、prepend 与 Assistant settlement 使用增量组装。settlement 只删除具名 attempt 的 transient match，应用可选持久 entry，并从剩余最早的 start 重算受影响的 Context，刷新前序索引及 dependent，不替换无关 target node。没有剩余 start 的 Context 不保留 State，但其 key 和已发布节点仍保留，供后续证据复用，直到完整窗口重建；所属 Definition 可以隐藏这些节点。assembler 拥有 Context 匹配、Turn/Step location、target node 物化、target activity 和稳定 target source。`ConversationSnapshot` 只包含与 target 无关的 View 与 active-target 事实；Session lifecycle 状态仍属于 `SessionSnapshot`。

shell 选择解析出 target 或 target source 收到首个 subscriber 时，该 target 进入 active 状态。assembler 从当前 Context 对它执行一次 replace，并使它参与后续增量 flush；创建 source 不会激活 target，取消订阅也不会停用 target。

`UiConversation.groups` 为每个已注册目标注册一个可选的业务 Group Definition。它在节点物化后消费投影后的节点变化、变化轮次及已索引的目标位置，覆盖首次激活，并拥有全部分段规则与组数据。按索引读取 Turn 时保留相邻 Node 造成的分隔，使业务更新可以限制在受影响轮次和组内。assembler 先校验并安装根引用和按键索引的组快照，再发布 Node、Group 和 Location 数据来源。未分组目标保持原有路径。[分组](../../../docs/subsystems/conversation.zh.md#group-definitions)定义输入有效期、类型化注册、原子更新及渲染器职责。

Group 注册时缺少 View 目标会报错。已注册的 View Definition 被移除后，其分组计算暂停并清空已发布结果，但保留 Group Definition；重新注册该 View 后，沿现有替换流程从当前已加载时间线重建。切换 View 页签不会移除 View Definition。

target package 通过 declaration merge 扩展 snapshot 与 Location data map，再调用 `ctx.uiConversation.events.register(...)` 和 `ctx.uiConversation.views.register(...)`。target 通过 `ctx.uiConversation.binding(binding).target(targetId)` 读取其 Session-owned source。注册属于 Cordis effect，返回的 disposer 从同一个 registry 移除 contribution。共享的请求检查服务于每个 target：`ctx.uiConversation.inspectSystemPrompt(previous, event)` 将系统消息与位置替换解释为不可变的已加载 surface 状态。它按 surface 顺序选择最后一个非空的存活系统节点，为连续重写只保留存活的替换位置；遇到未建立索引的更早端点后，提示词保持不可用，直到向前补页回放提供其顺序。target 自有的 Definition 独立保留历史卡片。`ctx.uiConversation.inspectRequestPrompt(previous, header, system)` 根据该有效提示词分类请求变更；普通消息与流式分片无需处理系统状态。

<a id="shell-and-standard-props"></a>
## Shell 与标准 props

共享图片插槽属性将展示选择与持久化引用分开：`thumbnail` 请求完整缩放的附件列表缩略图，`compact` 请求裁剪的图片方块。每张图片可通过可选的 `label` 提供无障碍展示名称；加载和缓存标识仍使用原始附件引用。[ui-attachment](../ui-attachment/README.zh.md) 负责渲染与灯箱。

控件组的尺寸、内容、可见性或字体加载状态变化后，composer 测量展开状态下的控件组。若无法排在同一行，控制栏为模型位设置 `--dsh-composer-model-text-display: none` 和 `--dsh-composer-model-icon-display: block`；两者默认值分别为 `block` 和 `none`。若连图标也放不下，仍允许换行。

上下文占用按钮在输入卡片下方、会话统计右侧显示圆环和百分比。点击按钮可在视口内的面板查看 token 构成，没有统计项时面板也不会越界；上下文用量和容量尚不可用时，按钮保持隐藏。

关闭开发者工具时，外壳仅隐藏 Trajectory；其他插件贡献的 View 仍然可用。可用 View 少于两个时隐藏 View 标签栏。在 Trajectory 激活时关闭开发者工具会返回 Chat；已保存的 View 偏好和 Session 记录保持不变。开启后，Trajectory 恢复可用。View 所有者接收可用列表，使导航操作跟随相同的可见性。

输入框注册「文件」命令动作，负责其标题、可用性和原生文件选择器回调。菜单可用性与实际调用都读取已挂载输入框当前的附件接收策略。输入框卸载或锁定后该动作不可用，插件 dispose（资源释放）时移除注册。回调绑定留在输入模块内部。

`SessionInputShell` 通过私有 [DraftEditorRuntime](src/client/input/editor/runtime.ts) 为每个 Session 持有一个 Lexical editor，同时保留提交、附件选择和恢复决策。[DraftEditor](src/client/input/editor/DraftEditor.tsx) 呈现借用的 editor；InputBar 保留钩子与 refs，并通过 [view-binding](src/client/input/editor/view-binding.ts) 安装 DOM 行为。编辑器类型位于 [draft-editor.ts](src/client/contract/draft-editor.ts)，共享输入和提交类型位于 [input.ts](src/client/contract/input.ts)。这一拆分不支持同一 Session 同时挂载多个可编辑 root；[两阶段隔离提案](../../../.agents/notes/proposed/architecture/2026-09-14-composer-model-and-draft-editor.zh.md) 定义剩余工作。

已认领的命令在仅删除参数和末尾分隔空格时保留身份与高亮，改动命令名才会释放认领。所有命令和语言使用相同规则，包括 `/goal`、`/目标`、`/plan` 和 `/计划`。输入法组合输入期间，命令提示和普通占位文字持续隐藏，直到编辑器提交最终文字且对应输入为空时才重新显示。

工作区选择使用 `uiWorkspace.openWorkspace` 准备目标并提交导航。草稿文字和附件仅在该请求仍为当前请求时，通过它的同步准备回调搬移；后续导航或所有者释放会保留原草稿。

本包占据 root 作用域 `main` 中的 `conversation` key。其 `main.conversation` 外壳将常驻的 `conversation.header` 放在可选 Session 的 `conversation.content` Component Factory 外。未选中 Session 时，头部仍承载根作用域导航；标题、操作和 View 标签保留在严格 Session 子组件中。Factory 拥有共享正文与 Composer，通过其标准 Hook 读取当前 Session，并公开 strict-Session `views` 与 root-scoped `widthControls` 两个局部位置。默认 adapter 渲染现有 `conversation.session` entry，主 occurrence 选择宽度拖拽条；嵌入式 occurrence 可以替换 `views`、省略拖拽条，且不渲染主 Header。共享正文与 Composer 注册 queue dock 和 Todo dock。Todo dock 在 composer 上方使用共享面板 elevation；其中的行分别以共享 idle、ongoing 与 done 标记表示待处理、进行中与已完成。`ctx.uiSession.provide()` 从同一个 Session binding 物化 Conversation 与 input source，并将 `inputActions` 作为稳定标准 prop 提供。

blank Session 保留 header 的 leading 与 corner 控件，包括右侧栏展开入口，同时隐藏标题、actions、utilities 和 View tabs。选择 Workspace 会创建这些控件所需的 Session，无需先发送消息。没有选中 Session 时，strict header 不挂载；常驻容器在 macOS 桌面保留 40px 拖拽区域，在 Web、Windows 或 Linux 上不预留空白高度。侧栏各入口仍遵循自身的数据与执行环境要求。 已开始的 Session 在可用 View 少于两个时使用单行标题栏，仅在渲染标签行时保留其高度。

View 选择规则固定：有效且已注册的持久化选择优先，其次是已注册的 `chat`，否则不渲染 View；绝不选择第一个已注册 View。Shell phase 只组合 Session lifecycle 与 active-target set，不读取任何 target-specific 快照。

Session 首次绑定或缓存的 Session 成为 current 时，shell 会在渲染前读取持久化 View 偏好，激活已注册的偏好 View 或 Chat fallback，并在后续 tab 或 focus 选择写入 store 前先激活对应 target。blank Session 仍不渲染 `conversation.view` slot；未选中的 target 不会激活。

主 occurrence 的活跃 transcript 只在未被内容覆盖的两侧沟槽中提供正文宽度拖拽条；嵌入式 occurrence 省略这些拖拽条。View 如果绘制进沟槽，只将具体的可见元素提到拖拽条上方；透明的全宽包装层保持在下方，不会占用空白沟槽。该规则要求此元素与 Conversation body 之间不能引入中间堆叠上下文；浏览器场景固定了交付 Chromium 的行为。Chat 将该规则用于表格元素，其限定在阅读列内的工具卡片无需提高层级。指针位于拖拽条上时，滚轮仍会滚动 transcript，Ctrl+滚轮则保留为浏览器缩放手势。粘滞 composer 刻意拥有完整的底部区带，该区域不是宽度调整目标；已捕获的拖拽会将指示线提高到松开为止（[拖动手柄样式](src/client/skeleton/ConversationRoot.module.css)）。

宽度拖拽条的指示线只在已捕获指针的拖拽期间跟随指针，普通悬停不改变其位置。

常驻 composer 在无 Session 与有 Session 之间保持挂载。输入空白字符会隐藏占位提示；没有附件的纯空白草稿无法发送。无 Session 时，同一个编辑器表面保持 inert，Workspace picker 连接 blank Session。该表面是 shell 所有的 Lexical 编辑器：引用 chip 是携带 owner 序列化身份的原子 decorator 节点（提交时经 owner codec 展开），已认领的 slash command 保持为带样式的行首文本，文件夹文本引用以图标前缀携带文件夹图形，草稿的剪贴板投影镜像到逐 Session Conversation store。QueueDock 从 Session 的 `inbox` 投影读取 `next-turn`，包含从冷状态恢复的消息，仅排除仍由本地 transcript 提交承接的 requestId。其他排队行保留正常展示和操作。Queue 操作通过 scoped `ctx.conversation` service 寻址准确的 queue occurrence；queue 预览经 `ui-primitives` 的共享行内引用投影渲染已发送文本（wire 会话形式折叠为其标签），并按原始附件顺序展示本地或持久化的图片和文件。图片使用缩略图，文件使用紧凑的名称与大小卡片。编辑态在可随内容增高的 textarea 中展示字面发送文本，因此重新编辑不会丢失换行；Enter 保存，Shift+Enter 换行，Escape 取消。持久化缩略图通过会话图片 URL 缓存解析。繁忙时 Enter 行为保存在 Host-backed `ui-conversation` settings namespace。 composer 键盘映射经斜杠流水线裁决触发菜单的按键——Tab 确认高亮补全项（可下钻项则下钻），Escape 与 Shift+Tab 离开菜单且不选定——其余按键交给编辑器自身。 接管键盘的浮层通过 `SessionInput.focus()` 把键盘还回来，该路径走 Lexical 自己的 focus，因此光标回到草稿原来的位置而不是开头。

默认发送采用乐观提交：Enter 在同一事务里清空草稿、occurrence 表和撤销历史，composer 保持 `plain`，发送作为 detached attempt 运行，发送期间可以继续输入和提交。`sendSession` 在序列化之前用投递模式注册 Session 提交回显（`session.beginSubmission`），并在 `pendingSubmissions` 中保留图片与文件的选择顺序；Session 根据该模式与当前运行状态推导位置，因此空闲发送进入 transcript（文本记录），繁忙时 Queue 进入 QueueDock，繁忙时 Steer 进入 pending-steering 区域。随后让出一帧，图片经浏览器原生 `FileReader` data-URL 路径编码，文件则引用已暂存凭证。命令提交也用同一凭证表示通用文件，因此发送 `/goal` 或 `/plan` 时不会再次读取这些浏览器文件。提示词复用提交 `requestId`；Session 按同一 `rpcId` 关联展示接管，并仅退休回显一次。多个并发发送失败时，在用户编辑还原内容之前按提交顺序合并还原；命令提交保持冻结的 `submitting` 阶段。Detached attempt 持有附件 id，直到 admission 完成或 Session scope 销毁。回显以 observed 退休时，durable 图片缓存立即公开每个预览 URL，读取 admitted 附件后用规范化 URL 替换预览，并在各 URL 停止使用后撤销，同时释放文件卡。选中的通用文件进入同一个先进先出的后台上传队列；`maxConcurrentFileUploads` 默认允许两个 Worker transport 同时运行，Conversation 服务在切换 Session 时继续持有排队和运行中的传输操作及字节进度，移除草稿会跳过排队中的传输或中止正在运行的传输。浏览器 shell 暴露 `__DSH_HOST_PATHS__` 时（桌面应用），拖入或粘贴的文件夹以及拖入、选择或粘贴的带真实路径的非图片文件会成为 `@路径` chip；图片仍然上传。拖放和粘贴通过浏览器 entry API 识别目录；该 API 不可用或没有返回 entry 时，粘贴项沿用普通文件处理。文件选择器不能选择目录。引用需要启用 `ui-reference` 插件，原路径也必须仍可由模型的文件工具读取。工作区内的路径使用相对形式，其他路径保留绝对形式。整批文件先校验再插入，保留来源顺序和已选中的文字，引用之间有空白分隔，含空格的路径使用闭合引号。没有该桥的浏览器会拒绝拖入或粘贴的文件夹，桌面端无法获取文件夹路径时单独报错。continuable 子代理禁用附件入口，也不创建本地回显，因为其 transport 不保留浏览器 request id。

排队提交的本地回显在禁用的编辑、删除、插话按钮旁显示“发送中…”；折叠后的队列在标题栏保留发送状态。匹配的 Host 队列行替换回显后，各操作按原有的纯文本内容和运行状态要求启用。仅收到提示词确认不会启用队列操作。提交失败会移除回显并显示错误；输入框为空或仍保留上一次自动恢复的内容时，composer 恢复失败草稿，保留用户随后输入的文字。

Send 和 Stop 按钮禁用时不显示提示气泡，轮次结束后由 Stop 切换成禁用 Send 的按钮也遵循此规则。普通 composer 运行时，如果草稿为空或输入不可用，主指针操作保持为 Stop。可提交的文字或附件会把同一位置切换为 Send；清空或成功提交草稿后恢复 Stop。繁忙态 Enter 设置为普通 Session 与可继续 child 选择 Queue 或 Steer 投递，运行中的 Send 按钮按 plain Enter 解析出的同一模式投递；当它在普通消息草稿上可用（没有待上传文件）时，其标签以该模式命名（排队发送或插话发送），因此该设置同时约束 Enter 与按钮，而 Cmd/Ctrl+Enter 仍使用另一模式；空闲会话、空草稿与 `/` 命令行保留普通的 Send 标签（[决策](../../../.agents/notes/implemented/bug-fix/2026-09-04-busy-send-button-follows-enter-setting.zh.md)）。它们的 QueueDock 行共享 Edit、Remove 与 Steer，空草稿也共享 steer-all 组合键。One-shot child 继续只读。Plan Mode 与 active goal 不改变附件入口。可继续 child 保留独立的 Send 与 Stop 操作，但不提供「文件」菜单项、粘贴或拖放入口；parent 离线时，Send 与 composer 手势锁定，但在线 inbox 的 QueueDock 控制仍可使用（[决策](../../../.agents/notes/archived/bug-fix/2026-08-20-running-draft-primary-send.md)、[inbox 控制](../../../.agents/notes/implemented/feature/2026-08-27-continuable-subagent-human-inbox-control.zh.md)）。

文件标签和可编辑的 skill 引用共用覆盖整个引用的悬停背景，并跟随输入框的行高与文字基线。首次点击立即由已注册的引用来源负责打开预览，包括双击序列的第一次点击。后续点击保留原生文本选择行为；已有非折叠选区时，指针点击不打开预览。预览不改变草稿、剪贴板文本或提交内容。

当会话被其他写句柄占用时，发送失败的 toast 提示用户退出其他正在运行的 DSH 后重试。

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

业务包仅可在一个 Remote waterfall request pending 期间安装 entry：

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

selector 必须是 owner currency 的纯函数。非 null 返回值作为 `matched` 传给组件；`PropsRuntime<'conversation.composer'>` 提供标准 Session 与 global props。Chain 顺序仍按 `priority` 升序，再按注册顺序；首个返回非 null 的 selector 获选。Shell 会在 takeover 下保持默认 composer 挂载。Request 状态、listener、response encoding 和任何 request-specific child slot 都属于业务 package，不进入 `SessionSnapshot`，也不由 core 包声明。

`InputActions.captureInsertion()` 捕获草稿选区与版本；`insertText(text, span)` 仅在版本未变且编辑器允许编辑时，插入一次可撤销的纯文本编辑。异步消费者在插入被拒绝后负责保留结果，等待用户操作。

`conversation.input.activity` 在模型选择器与发送按钮之间承载一个控件。其 `onActiveChange` 回调将控件展开至整条工具栏并隐藏普通辅助控件和上下文用量按钮，同时保留编辑器与提交按钮。关闭活动后恢复这些控件，上下文详情保持关闭。首页输入框下方没有内容时，该区域保持收起。占用者在卸载时释放展开状态，并拥有活动专属反馈。

<a id="model-experience"></a>
## 模型体验

无，因为本包渲染浏览器状态，并通过 Session Controller API 发送用户确认提交的输入，而不构造模型请求。

#### KV Cache 影响

无；Conversation 组装和浏览器输入状态不会改变提供方侧的 prompt cache。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- **只有已注册 target 可以渲染**——除已注册的 `chat` 偏好外，shell 刻意不提供隐式 fallback target。
- **Factory occurrence 继承渲染位置的 Session**——`conversation.content` 不接受独立寻址的 Session；该能力需要单独的 Session provider。


<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。Conversation Definition、target builder 与 View 已由其所属注册表和 Slot ledger 校验。
