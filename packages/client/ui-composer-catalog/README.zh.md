# @deepseek-ai/dsh-client-ui-composer-catalog

[English](README.md) | 中文

纯浏览器 New Session 草稿组合器的统一能力 source。它调用 Host 拥有的 `composerCatalog.listDraft({ workspaceId?, agentPreset? })` seam，将 Commands 和用户可调用 Skills 投影到通用 [`ui-input-trigger`](../ui-input-trigger/README.zh.md) 菜单。该 source 只服务草稿 target；现有 Session 命令执行和 Skill 发现仍分别由 `ui-commands` 与 `ui-skill` 拥有。

输入框前置 `+` launcher 与键入 `/` 共用同一个草稿 controller 和 source。Commands 位于第一个无标题分区；Skills 随后位于 `Skills` 标题下。每行预留左侧图标位，并显示名称、受限制的单行描述与最右侧的可信产品来源。搜索同时匹配名称、描述和来源。完整描述与来源仍可通过 title 与 accessible-label 文本访问。

每个草稿 target revision 的 Host 请求只会 single-flight 一次。Workspace 和已暂存 Agent preset 的变化都会更新 target，但不会清空编辑器；对话接线层会关闭旧菜单，因此其已中止请求不能发布到新 target。传输失败会留下可重试的 source 行；Host 包含的分区错误则在成功行旁展示，重试前只会使该 source 失效，不会隐藏其他成功 source。选择只会向草稿拼接文本：Command 为 `/<command> `，Skill 为预留的 `/skill <name> ` 写法。本包不实现该显式 Skill 手势的 Host 解析或执行。

## 模型体验

无，因为本包只改变浏览器发现与草稿文本；它不加载 Skill 指令、不创建 Session、不发送 prompt，也不注册模型可见工具。

#### KV Cache 影响

在用户通过后续执行阶段提交草稿前没有影响。

## 已知限制与暂缓事项

- 显式 `/skill <name>` 提交与 Host pre-step 解析属于下一实施阶段。
- Session 目录仍使用现有 Command 和 Skill sources；Session 实体化后的 source/origin 统一仍暂缓。
