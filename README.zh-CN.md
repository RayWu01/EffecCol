# EffecCol

[English](./README.md) | [简体中文](./README.zh-CN.md)

> 把“收藏夹吃灰”变成“有效收藏”。

EffecCol 是一个 Chrome 扩展加 Obsidian 插件，帮助你把“这篇网页值得留下”变成一份以后还能想起、找到、继续使用的知识素材。

## 为什么做

大多数收藏工具解决的是“存下来”，不是“以后还能用起来”。

你会因为“这篇内容有价值”而把它存下，但过几天之后，往往已经想不起它为什么重要、讲了什么、应该放进哪条思考链路里。结果就是归档越来越多，真正会主动回看的越来越少，甚至会对这部分“存了但没用起来”的知识积累产生焦虑。

EffecCol 想要的是另一种结果：

1. 把完整原文存进知识库
2. 再生成一张更轻的摘要卡片，放进你自己的索引或工作流
3. 让保存过的内容更容易被重新唤起和继续使用

这也是 **EffecCol** 这个名字的来源：**Effective Collection**，也就是“有效收藏”。

## 用户是谁

EffecCol 适合这类用户：

- 已经习惯用 Obsidian 做长期归档
- 平时会收藏很多文章、网页和资料，但这些归档内容通常不会被主动回看
- 会对“知识存了很多，但没有真正用起来”这件事感到焦虑
- 自己维护索引、MOC、白板、大纲或仪表盘
- 希望一键收藏，但不想每次都填很多表单

如果你只想要一个简单的浏览器收藏夹，EffecCol 可能会比你需要的更重一些。

## 解决什么问题

EffecCol 解决的是“我已经保存了，但以后还是用不上”的问题。

一次点击会故意生成两种输出：

- 一份结构化的 Obsidian 笔记，用来归档和全文参考
- 一张更轻的剪贴板卡片，用来手动放进你自己的索引系统

这种分离是刻意设计的。归档和索引，本来就不应该是同一件事。

## 它是怎么工作的

当你点击扩展图标时，EffecCol 会：

1. 提取标题、链接、站点名、选中文本和正文
2. 生成 AI 摘要
3. 把结构化笔记保存到当前 Obsidian vault 的 `EffecCol/` 目录
4. 把一张更轻的知识卡片复制到剪贴板

主流程会尽量保持安静：

- 不弹表单
- 不跳转 Obsidian
- 不在每次保存时额外确认

## 你会得到什么

### Obsidian 笔记

保存到 Obsidian 的内容用于长期归档，通常包括：

- frontmatter / Properties
- 网页标题
- AI 摘要
- 清洗后的正文
- 原始链接
- 条件允许时本地保存的正文图片

### 剪贴板卡片

剪贴板卡片用于手动放进你自己的工作流。根据设置，它可以包含：

- 加粗标题
- AI 摘要
- Obsidian 笔记路径
- Obsidian 深链
- 原文链接

这张卡片可以粘贴到任何你拿来做索引的地方，不一定非要是 Obsidian。

## 当前状态

EffecCol 目前是一个开源的 **v1 原型**。

这意味着：

- 核心主流程已经可用
- 安装仍然偏手动
- 收藏时需要保持 Obsidian 桌面端打开
- 正文提取和图片处理还在持续优化
- GitHub Releases 已可用于手动安装试用
- 浏览器商店和 Obsidian 社区市场分发还没有完成

## 安装方式

第一次安装时，建议严格按照下面的顺序来。

### 开始前准备

- Chromium 内核浏览器
- Obsidian 桌面端
- 一个你准备让 EffecCol 写入的 Obsidian vault
- 已开启 Obsidian 社区插件能力
- 你所选 AI 服务的 API Key

### 1. 先在 Obsidian 中打开目标 vault

先打开 Obsidian 桌面端，并确认你要用来保存内容的 vault 已经处于打开状态。

EffecCol 会保存到当前打开的 vault，所以这一步应该先于扩展测试。

### 2. 安装 Obsidian 插件

把 `obsidian-plugin/effecol/` 复制到你的 vault 中：

```text
.obsidian/plugins/effecol/
```

如果 `.obsidian/plugins/` 还不存在，就先手动创建。

然后在 Obsidian 中启用 `EffecCol`：

1. 打开 `Settings`
2. 进入 `Community plugins`
3. 如果 Restricted mode 是开启状态，先关闭它
4. 找到 `EffecCol`
5. 打开开关

完成后，请保持 Obsidian 打开。

### 3. 加载 Chrome 扩展

1. 打开 `chrome://extensions`
2. 打开开发者模式
3. 点击“加载已解压的扩展程序”
4. 选择这个仓库里的 `extension/` 目录

不要选择仓库根目录。Chrome 应该加载那个直接包含 `manifest.json` 的目录。

### 4. 在扩展里配置 AI

打开扩展设置页后，填写：

- API 厂商
- API Key

可选项包括：

- 模型名
- endpoint
- 摘要长度
- 摘要偏好
- 剪贴板卡片预设

### 5. 做第一次保存测试

1. 保持 Obsidian 打开
2. 在 Chrome 中打开一个正常的 `http` 或 `https` 文章页
3. 点击 EffecCol 扩展图标

如果一切正常：

- 当前 vault 的 `EffecCol/` 目录里会出现新笔记
- 剪贴板里会得到一张可手动粘贴的卡片

如果第一次保存失败，最常见的原因是：

- Obsidian 没有打开
- `EffecCol` 这个 Obsidian 插件还没有启用
- Chrome 里加载错了目录
- AI 厂商或 API Key 还没有配置

## 隐私与数据流

- Obsidian 笔记通过本地 Obsidian 插件写入。
- API Key 保存在浏览器本地。
- 提取到的网页内容只会发送给你配置的 AI 服务，并且仅用于生成摘要。
- 剪贴板写入发生在本地浏览器中。

## 仓库结构

- `extension/`
  Chrome 扩展源码，包含 `manifest.json`、后台主流程、设置页、状态页、offscreen 剪贴板文档和图标
- `obsidian-plugin/effecol/`
  负责本地保存的 Obsidian 插件
- `docs/TEST_REPORT.md`
  本地手工测试记录
- `scripts/bridge-server.js`
  早期桥接原型，保留作参考
- `release-assets/`
  本地生成的 zip 发布包，便于手动发布测试

## 路线图

- 支持更多网站的更稳正文提取
- 更准确的低价值页面判断
- 更顺滑的首次安装与引导
- 面向浏览器商店与社区市场的打包与分发
- 更稳定的图片下载与渲染链路

## 贡献

欢迎提 Issue 和 Pull Request。

当前最有价值的贡献方向：

- 正文提取边界情况
- 不同网站的图片处理
- 安装与引导体验
- 发布工程化

项目相关文档：

- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
- [SECURITY.md](./SECURITY.md)
- [CHANGELOG.md](./CHANGELOG.md)
- [LICENSE](./LICENSE)

## 用一句话概括

EffecCol 不是为了让你收藏更多，而是为了让收藏真正变得可用。
