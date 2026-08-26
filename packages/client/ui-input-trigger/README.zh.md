# @deepseek-ai/dsh-client-ui-input-trigger

[English](README.md) | 中文

输入触发流水线插件：光标处的 `/` 与 `@` 检测（词边界 + guard tier 规则）、分组候选菜单，以及把 pick 路由到已注册 source。`ctx.inputTriggers` 拥有 source roster，除按 Session scope 解析 controller（`sessionOf`）外，还拥有一个显式绑定的浏览器草稿 controller（`bindDraft`／`draft`）。source 收到 `InputTriggerTarget`：Session 身份，或携可选 Workspace 与 Agent preset id 的草稿 revision。旧 source 默认仍只服务 Session，需要显式声明 `targets: ['draft']` 才进入草稿。对话接线层驱动 `track`／`arbitrate`／`onSpace`／`adjudicate`；`toggleSource` 打开一个 source，`toggleTrigger` 则为 `+` 等共享 chrome 打开该 trigger 的所有有效 source。Session pick 分派 scoped 输入事件；草稿绑定以同样的 span CAS 直接应用到驻留输入状态机，不创建 Session。首次发送实体化后，`admitMaterialized` 会按 roster 顺序让每个草稿 source 针对新 Session 执行可选的对比钩子，再决定是否提交 prompt；拒绝时 payload 保留在可见的真实 Session composer 中。流水线仍与命令无关：空格／回车按注册序裁决可选钩子，`SubmitEnvelope` 使命令可拒绝无法整体消费的图片附件。

分层：`src/core/` 是纯内核——`detectTrigger`、`menuReduce`／`seedGroups`／`MENU_CLOSED`、`exactMatch`，零 React／DOM／cordis；`src/client/service.ts` 是壳层，连接菜单快照 store、由 generation 把关且可被 `AbortSignal` 取代的候选拉取，以及 pick 路径。失败 source 保留为隔离的可重试行；成功 source 也可在不丢失候选的前提下返回已包含的分区问题。`ReferenceInsert.appearance` 可标识 `session`、`file` 或 `folder` 显示而不改变序列化 `ref`。`src/types.ts` 与两个 `contract.ts` 文件是冻结的跨包约定；变更需经主线程仲裁。

MenuView 把菜单 store 渲染进 `conversation.input.overlay` slot（列表类，`session-maybe`），关闭时渲染 null。键入式 trigger 会 seed 所有有效 source；程序化 launcher 可只 seed 一个 source，也可 seed 整个 trigger roster。分组按 `order` 排序；`showGroupTitle: false` 与候选 `section` 可表达无标题 Commands 块与随后的 Skills 标题。每行预留图标位，并可显示受限描述与右对齐 `origin`；title 文本与 accessible label 保留完整值。失败组和已包含的分区问题都提供「重试」，不隐藏成功组。列表高度受限于 composer 上方空间，外部指针输入会关闭菜单。combobox 焦点留在 textarea，行在 mousedown 时 pick，高亮由 `aria-activedescendant` 承载。

`/client` 导出接口是插件主体（`apply`／`inject`）、`InputTriggerService`、`MenuViewInjected` 与约定类型。MenuView 本身是内部实现——slot 注册以闭包持有它。

## 模型体验

无。触发流水线只是浏览器呈现——pick 产出 `CommandClaim`／`ReferenceInsert` 数据，其模型可见后果（宿主命令执行；插入的引用文本随普通提示词发送）由负责消费这些数据的宿主包与输入状态机包负责。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **只有全局 source 层**：会话 scope 的 source 注册（逐会话遮蔽、类 ScopedLayers 机制）已有设计但未启用；台账记录着触发条件（出现真实的逐会话 source 需求）。
- **`InputTriggerCandidate.icon` 以文本渲染**：MenuView 把该字符串原样放进图标位；与设计系统图标枚举（iconFile 五变体家族）的接入将在该枚举交付后完成。
- **overlay 的 SlotMap 合并归属与 slot 所有权分离**：唯一的 `conversation.input.overlay` 合并放在本包，而 ui-conversation 负责其锚点、children 声明和生命周期，因为依赖方向是 ui-conversation → ui-input-trigger。
