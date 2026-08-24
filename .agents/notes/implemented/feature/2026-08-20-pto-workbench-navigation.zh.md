# Agent Note: PTO workbench navigation and blank-session layout

Status: implemented

[English](2026-08-20-pto-workbench-navigation.md) | 中文

## Problem

展开侧边栏把大号 New Session 作为 shell 级操作重复展示，而其余会话导航都由 workspace browser 持有，也没有可持续承载运行记录的位置。在空白会话界面中，欢迎标题和常驻 composer 共用一个居中堆栈，因此输入框会随装饰内容移动，无法保持可预期的底部位置。PTO 字标虽然只是普通界面文本和徽标，却也被编码成 SVG。

## Decision

展开状态的 `sidebar.workspaces` 区域持有包含 Sessions 与 Run Records 的双标签导航界面。Sessions 保留 workspace/session 树及其搜索、分组、排序、添加 workspace 和 New Session 控件。Run Records 使用独立 tab panel 和搜索展示，不挂载会话树操作。收起后的窄栏继续保留直接 New Session 快捷入口，因为标签界面无法容纳在窄栏中。

空白会话的 composer seat 保持常驻并填满对话列。独立欢迎区域占用剩余空间并居中标题，workspace 选择器和输入框则留在底部。hero 不再在标题旁渲染品牌鱼标。对话滚动容器在所有阶段都保持纵向滚动能力。

PTO 品牌名称改用 CSS module 样式化的语义 HTML 渲染：产品名与 DSH 徽标仍构成一个视觉字标，但不再把界面文本编码进 SVG 几何。PTO 品牌包发布 client bundle 及其 source map，确保带 CSS import 的入口进入打包产物。

## Alternatives considered

**在侧边栏 shell 中保留展开态 New Session 胶囊。** 否决，因为它重复了应与所选 Sessions 视图放在一起的操作，也会让 Run Records 视图处于无关的会话 chrome 下。

**把欢迎文案、workspace 选择器与 composer 作为一个堆栈整体居中。** 否决，因为常驻输入框应保持稳定且可达的位置，装饰性欢迎内容只应持有剩余空间。

**保留 SVG 字标。** 否决，因为普通文本与徽标布局使用 HTML 和 CSS 更容易对齐、适配主题、测试和打包。

## Consequences

展开侧边栏提供可用键盘导航的标签和一个活动 tab panel。切换视图会清空当前搜索并关闭仅属于会话视图的 workspace 选择流程。Run Records panel 自身的模型与行项目由后续的 [Run Records sidebar information architecture](2026-08-24-run-records-sidebar.zh.md) 落地。Sessions panel 中原有会话行为不变，收起模式仍能一键新建会话。

空白会话欢迎区与 composer 在视觉上相互独立，同时不会在会话启动期间替换 textarea 子树。窄视口或放大内容仍可纵向滚动。品牌字标采用浏览器文本渲染，client 包现在也包含 CSS 支持的入口产物。

## Testing

包级 GUI 测试覆盖 PTO 品牌、空白会话 skeleton、侧边栏 shell、workspace 标签、键盘导航和会话控件。构建后的 Web 回放覆盖组装品牌渲染、启动树稳定性、对话列单轴滚动、侧边栏生命周期 chrome 与导航 pane。
