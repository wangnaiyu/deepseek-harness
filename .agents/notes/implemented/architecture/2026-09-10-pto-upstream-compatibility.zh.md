# Agent Note: PTO 对版本化 Session 和资源侧栏的兼容

状态：已实现

[English](2026-09-10-pto-upstream-compatibility.md) | 中文

## 问题

PTO 浏览器草稿延迟创建 Session，而通用文件上传需要真实 Session。项目目录别名也必须保留已发布的 Session generation。资源侧栏不提供[对比展示决策](2026-08-27-pto-evidence-gated-comparison-ui.zh.md)所依赖的 Tool details slot。

## 决策

实体化前，草稿拥有浏览器附件。首次提交将待上传的通用文件绑定到新 Session，并等待上传结算后再发送 prompt。正式能力准入保持现有拒绝行为。仅当输入壳接受附件移除时，才释放对应浏览器资源。

项目别名为新 Session 选择目录。已发现的传统目录或别名目录保持其身份；写入目标为该目录中的当前 generation。相邻迁移保留已提交的前代 generation，并使用 upstream 文件租约。

按工具名分派的 PTO 对比会话行拥有原生折叠区域，其中包含完整冻结证据。此决策仅替代先前决策中的 details-slot 机制。证据校验、七个身份维度、无定论标签和禁止推断业务成功的要求保持不变。资源侧栏 slot 继续由 upstream 包拥有。

## 测试

Session 持久化测试覆盖传统和别名路由以及不可变 generation 迁移。编辑器测试覆盖允许和拒绝的附件移除。对比展示测试要求折叠区域包含全部七个身份行及显著性证据。构建后的工作台验证覆盖组合包及资源依赖闭包。

## 考虑过的替代方案

恢复已移除的 Tool details 面板会重新引入过时的全局 owner，并与资源侧栏冲突。删除证据正文会丢失解释对比所需的依据。为每个草稿附件创建 Session 会违反延迟实体化要求。向前代 generation 写入会违反已发布 Session 的保留要求。

## 后果

PTO 通过 upstream API 保留原有证据和草稿能力。此适配不重新设计 Viewer launch identity、admission receipt、new-launch/retry 策略或实验面板宽度。这些实际表现仍需独立修复任务分类。
