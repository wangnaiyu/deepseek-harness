---
description: "面向草稿与正式 Session Command 和 Skill 的只读 Host 目录；供配置可信来源或排查局部发现失败的部署方与维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-host-composer-catalog

[English](README.md) | 中文

## 概述

面向草稿与正式 Session 输入框的只读 Host 投影。`ComposerCatalogGateway` 发布 `composerCatalog/listDraft` 与 `composerCatalog/listSession`。草稿请求只携带可选 `workspaceId` 和 Agent preset id，绝不接受客户端路径；Session 请求只携带 `sessionId`。Host 解析规范 cwd、Workspace 标签、最终 Agent／standing scope 和隔离 Skill registry，再分别返回最终有效的 Commands 与用户可调用 Skills。Session 读取不会启动 turn，读取冷的已挂载 Session 也不会恢复 Agent。

未分组请求只列出全局 Commands，并以 `cwd: undefined` 调用 Host Skill registry；结果还会过滤项目 Skill 来源。Workspace 请求包含 scoped command winner，并在 preset 挂载了隔离 Skill registry 时查询该 registry，否则查询 Host registry。未知 Workspace 会拒绝。preset 损坏时，全局 Commands 与 Host registry Skills 仍可用，同时返回归属于 `Agent` 的 `commands` 和 `skills` 局部错误。

命令定义可以携带不透明 `provider` id。命令 registry 会在无处理器描述符旁保留这个 id 与最终胜出的 `global`／`scoped` layer。本包把可信 provider 声明映射为产品来源：没有显式归属的全局注册项属于 `DSH`，没有显式归属的 scoped 注册项属于 `Agent`，未知的显式 provider 属于 `Plugin`。Skills 先解析项目和用户 source bucket（来源分桶），再依次使用最精确的 provider/source 声明、provider 级声明和安全默认值：custom root 属于 `User`，未映射的 bundled root 属于 `DSH`，其他未映射 provider 属于 `Plugin`。配置中的产品类型使用固定的 `DSH`、`PTO` 与 `User` 标签；只有 plugin 来源接受友好名称，缺失时回退到 `Plugin`。

两个方法都会移除处理器、scope key、provider id、路径、resource base 与 Skill 正文。描述上限为 1,000 个字符。User Skills 排在 PTO、Workspace、DSH 与 plugin Skills 之前，最后一个分桶内再按标签与名称稳定排序。响应 revision 由 SHA-256 派生，只要返回条目或局部错误变化就会变化。Skill registry 会隔离 provider rejection：成功条目继续保留，Skills 区域以 `skill-catalog-incomplete` 标记不完整。

该服务仅供 Remote 使用，刻意不声明同进程 Cordis `Context` merge。Client 包通过 [`api-remotes`](../../api/remotes/README.zh.md) 消费生成的 `./remote` contribution（贡献）与 `./types` payload vocabulary（载荷词汇），不直接导入 Host 实现。

## 目录

- [配置](#configuration)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="configuration"></a>
## 配置

`providerOrigins` 是可信声明的有序列表。每项必须提供 `provider` 与 `kind`（`dsh`、`pto`、`plugin` 或 `user`），可以增加 Skill `source` 区分项，也可以为 `plugin` 增加友好 `label`。重复的 provider/source 组合会在激活时失败。source 级声明优先于 provider 级声明。

<a id="model-experience"></a>
## 模型体验

无，因为这个仅限 Host 的草稿目录投影不注册提示词、工具、消息或提供方请求。

#### KV Cache 影响

无；本包从不组装模型输入。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- **Skill 不完整诊断只到区域级** —— Skill registry 会暴露完成状态，但不暴露被拒绝的 provider identity（提供方身份），因此 `skill-catalog-incomplete` 暂时无法指出具体产品来源。
- **没有推送失效通知** —— `revision` 可用于比较两次查询结果，但本包尚未发布合并后的目录变化 Remote event（远程事件）。
- **没有图标 registry** —— wire item（协议条目）预留了可选 `iconId`，但在可信本地图标 registry 出现前本包不会输出它。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
