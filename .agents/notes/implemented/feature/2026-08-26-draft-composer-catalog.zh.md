# Agent Note: 草稿 composer 能力目录

Status: implemented

[English](2026-08-26-draft-composer-catalog.md) | 中文

## 问题

Web 新会话草稿没有 Session 或 Agent，但 composer 必须发现最终会话能够使用的 Commands 与用户可调用 Skills。现有 Remote method（远程方法）都以会话为作用域；命令描述符不会保留同名 winner（胜出项）来自哪个注册 layer；Skill summary（摘要）暴露的是技术 source/provider 事实，而不是产品归属。若为了发现而创建临时 Session，就会违反产品生命周期并留下空的持久记录。

该投影还必须区分未分组草稿与 Workspace 草稿。未分组草稿不能用 Host 进程目录替代缺失 Workspace；Workspace 草稿则需要所选 preset 的 standing composition（常驻组合），包括隔离的 Skill registry，同时不能恢复 Agent。

## 决策

`@deepseek-ai/dsh-host-composer-catalog` 是由 Web bundle 挂载的只读 Host Remote projection（宿主远程投影）。`composerCatalog/listDraft` 接受可选的 Host 签发 `WorkspaceId` 与 Agent preset id。它绝不接受路径，也不注入或调用 Session/Agent 服务。Workspace id 通过 `ctx.workspaceRegistry` 解析；未知 id 会拒绝。未分组请求以 `cwd: undefined` 调用 Skills，并过滤项目来源。

gateway 分别返回 `commands` 与 `skills` 数组、确定性的内容 revision，以及已隔离的区域错误。wire entry（协议条目）只包含可调用名称、有界描述、命令输入元数据或 Skill 模型调用策略、可选受控 `iconId` 与产品来源。它会移除处理器、scope key、provider id、绝对路径、resource base、Skill locator、frontmatter 与正文。

### 命令 provenance

`CommandDefinition.provider` 是可选的不透明技术身份。`CommandRuntime.listDiscoveryForScope()` 在合并注册项时保留最终胜出的 `global` 或 `scoped` layer，以及 winner 的 provider identity。普通 `CommandDescriptor` 保持不变。由此可以在不比较描述符的情况下区分完全相同的全局与 scoped 描述符，同时不影响分发、优先级或模型输入。

没有显式归属的全局 winner 投影为 `DSH`；没有显式归属的 scoped winner 投影为 `Agent`。显式归属的 winner 通过可信 gateway 配置解析，未知 provider 会降级为 `Plugin`，而不会暴露其 id。

### Skill 来源与排序

Skill registry 选出 winner 后才解析 Skill 产品来源。项目来源使用 Host Workspace 显示名称，用户来源使用 `User`，配置的 provider/source 归属可以声明 `DSH`、`PTO`、`User` 或友好插件名；custom root 默认为 `User`，bundled root 默认为 `DSH`，其他所有未映射 provider 降级为 `Plugin`。source 级声明优先于 provider 级声明，因此同一个文件系统 provider 可以同时拥有用户、项目、custom 和 bundled root，而无需把同一个产品标签应用到所有来源。

只有用户可调用 winner 会跨过 wire。Skills 按 `User`、`PTO`、Workspace、`DSH`、plugin 排序，再在产品分桶内按标签／名称稳定排序。存在 preset standing 隔离 Skill registry 时使用它；缺失时使用 Host registry，与会话组合一致。

### 失败与 revision 行为

Skill provider rejection 仍由 `SkillRegistry` 隔离：成功 winner 会连同一个 `skill-catalog-incomplete` 区域错误返回。registry 级失败只清空 Skills，Commands 保持不变。preset 解析失败时，全局 Commands 与 Host-registry Skills 保持可用，并为两个区域返回归属于 Agent 的错误。响应 revision 对投影条目与错误计算 hash，因此客户端无须接收 provider generation 也能拒绝过期的重新查询结果。

## 考虑过的替代方案

- **创建临时 Session 并使用会话作用域 Remote** —— 未采用，因为发现操作只读，不能分配、恢复、持久化或发布 Session。
- **在浏览器合并命令与 Skill 目录** —— 未采用，因为浏览器没有可信 Workspace 路径、preset standing scope、provider 归属与最终 winner 事实。
- **根据描述符差异推断命令覆盖 provenance** —— 未采用，因为 scoped command 可以有意发布与全局 fallback 完全相同的名称、描述和输入元数据。
- **把所有 bundled Skill 都视为 PTO** —— 未采用，因为 bundled 是 DSH、PTO 与第三方发行共同使用的技术来源。
- **把产品 origin kind 放进命令 registry** —— 未采用，因为通用 registry 负责技术注册事实；部署相关产品标签属于 Host 投影。

## 后果

- 新会话目录读取会保持首次发送的持久化边界，并可在没有 Agent 的前提下寻址 preset composition。
- 命令 provenance 增加一个可选注册字段与一个读取投影；现有描述符与执行保持稳定。
- 产品标签保留在可信 Host 配置中，绝不依赖名称、路径或客户端硬编码。
- Skill registry 当前暴露不完整状态，但不暴露逐 provider 失败 identity；在出现有消费方依据的 registry 诊断需求前，Skill 局部错误只到区域级。
- 响应 revision 支持拉取式 freshness（新鲜度）；合并后的推送失效事件与可信图标 registry 留给独立的客户端阶段工作。
