# EffecCol 测试报告

更新时间：2026-06-04

## 测试目标

这次测试主要回答四个问题：

1. 设置页左上角是否已换成正式 icon
2. 没装 Obsidian、没启用 EffecCol Obsidian 插件时，是否有提醒或引导
3. 特殊网页抓取失败时，是否有明确提醒
4. 当前版本距离“可上架产品”还有哪些关键缺口

## 测试环境

- 项目目录：本地开发工作区中的 `obsidian-post-capture-extension`
- Chrome 扩展源码目录：`extension/`
- Obsidian 插件源码目录：`obsidian-plugin/effecol/`
- 浏览器：Google Chrome，开发者模式加载本地扩展
- Obsidian：桌面端已安装并运行
- 当前 Vault：本地测试用 Obsidian vault
- Obsidian 插件健康地址：`http://127.0.0.1:27124/health`
- 测试方式：代码检查 + 本机接口检查 + Chrome/Obsidian 手工烟测

## 结论摘要

- 主链路可用：在“普通网页 + Obsidian 已打开 + EffecCol 插件已启用”的前提下，静默保存已经可用，笔记能落到 `EffecCol/` 下。
- 品牌问题已修：设置页和状态页左上角已接入正式 icon，但需要在 Chrome 扩展页重新加载本地扩展后，浏览器运行态才会看到。
- 提醒能力增强：当前已经能提示“本地保存接口不可用”，也能引导用户检查 Obsidian 和插件；设置页与主流程现在复用同一套诊断结果。
- 特殊网页拦截已补代码：非 `http/https` 页面现在会被明确拦截并提示不支持，但本次未在重载后的运行态完成最终 UI 验证。
- P0 的两项核心安全/质量补丁已落地：
  - 本地保存接口已增加配对 token，未授权写入会被拒绝
  - 低价值页面会先提醒，再允许用户二次确认强制保存
- 距离公开上架仍有 2 个主要 blocker：
  - 新用户安装和启用 Obsidian 插件的 onboarding 还不够强
  - “普通网页但不适合收藏”的内容质量判断还需要继续打磨阈值

## 用例与结果

> 注：这份文档主要是开发过程中的本地测试记录。仓库结构已整理为 `extension/` 与 `obsidian-plugin/effecol/`，因此下面的本地文件引用也已同步到新路径。

### TC-01 设置页品牌 icon 接入

- 目标：设置页左上角使用正式 icon，而不是占位字母
- 方法：检查 [options.html](/Users/wurui/Documents/有效收藏/obsidian-post-capture-extension/extension/options.html) 与 [styles.css](/Users/wurui/Documents/有效收藏/obsidian-post-capture-extension/extension/styles.css)
- 结果：通过
- 证据：
  - `options.html` 已改为 `<img src="icons/effective-collection-48.png" ...>`
  - `styles.css` 已把 `.brand-mark` 改成图片容器
- 备注：Chrome 中需要重新加载扩展后才会看到最新运行态

### TC-02 状态页品牌 icon 接入

- 目标：失败补救页也使用正式 icon
- 方法：检查 [popup.html](/Users/wurui/Documents/有效收藏/obsidian-post-capture-extension/extension/popup.html)
- 结果：通过
- 备注：与 TC-01 一样，浏览器运行态需要重载扩展

### TC-03 设置页大屏可读性

- 目标：设置页在大屏下不要拉得过宽
- 方法：检查 [styles.css](/Users/wurui/Documents/有效收藏/obsidian-post-capture-extension/extension/styles.css)
- 结果：通过
- 证据：`.shell { max-width: 1120px; margin: 0 auto; }`

### TC-04 Obsidian 本地保存服务健康检查

- 目标：确认 Obsidian 插件本地服务已在线
- 方法：请求 `http://127.0.0.1:27124/health`
- 结果：通过
- 证据：
  - 返回 `ok: true`
  - 返回 `vaultName: "Obsidian Vault"`
  - 返回 `folder: "EffecCol"`

### TC-05 Happy Path 静默保存

- 目标：在普通网页点击扩展后，能静默保存到 Obsidian
- 方法：Chrome 手工烟测，在 `linux.do` 普通网页中点击 EffecCol
- 结果：通过
- 证据：
  - 页面出现提示：`正在保存至 Obsidian...`
  - Obsidian 插件状态文件记录了本次保存
  - 生成笔记文件：
    - [社区邀请码LDC集散帖 - 积分乐园 - LINUX DO.md](/Users/wurui/Obsidian%20Vault/EffecCol/%E7%A4%BE%E5%8C%BA%E9%82%80%E8%AF%B7%E7%A0%81LDC%E9%9B%86%E6%95%A3%E5%B8%96%20-%20%E7%A7%AF%E5%88%86%E4%B9%90%E5%9B%AD%20-%20LINUX%20DO.md)

### TC-06 笔记是否真正写入 EffecCol 目录

- 目标：确认不是只发起请求，而是真的落库
- 方法：读取 Vault 目录与生成的笔记文件
- 结果：通过
- 证据：
  - `EffecCol/` 目录存在
  - 新笔记已写入目录
  - 文件含有 frontmatter、AI 摘要、网页原文、原始链接

### TC-07 未装 Obsidian / 未启用插件提醒

- 目标：用户未完成 Obsidian 环境准备时，扩展是否会给提醒
- 方法：检查 [background.js](/Users/wurui/Documents/有效收藏/obsidian-post-capture-extension/extension/background.js) 与 [options.js](/Users/wurui/Documents/有效收藏/obsidian-post-capture-extension/extension/options.js)
- 结果：部分通过
- 当前行为：
  - 当本地接口不可达时，扩展会阻止静默保存
  - 设置页会提示用户安装或打开 Obsidian，并启用 EffecCol 插件
  - 状态页会显示失败原因与补救建议
- 不足：
  - 还不能自动判断“没安装 Obsidian”“没打开 Obsidian”“没启用插件”三者的具体差异
  - 还没有安装向导式 onboarding

### TC-07A 统一环境诊断链路

- 目标：设置页检查和主流程保存前检查是否使用同一套诊断逻辑
- 方法：检查 [background.js](/Users/wurui/Documents/有效收藏/obsidian-post-capture-extension/extension/background.js) 与 [options.js](/Users/wurui/Documents/有效收藏/obsidian-post-capture-extension/extension/options.js)
- 结果：通过
- 证据：
  - 设置页改为调用 `effecol:diagnose-environment`
  - 主流程点击扩展图标前也调用 `diagnoseEnvironment(...)`
  - 诊断项已统一覆盖 AI 配置、API 权限、Bridge 权限、Bridge 在线状态、配对状态

### TC-08 特殊网页失败提醒

- 目标：在 `chrome://`、扩展页、新标签页等特殊页面点击扩展时，是否明确提示不支持
- 方法：检查 [background.js](/Users/wurui/Documents/有效收藏/obsidian-post-capture-extension/extension/background.js)
- 结果：代码通过，运行态待重载复测
- 当前实现：
  - 新增 `isCapturableUrl()` 判断
  - 非 `http/https` 页面会直接提示“这个页面暂时不能收藏”
  - 说明文案会明确指出 Chrome 内置页、扩展页、设置页等不支持
- 备注：本次已写入代码，但未在重载后的 Chrome 运行态完成最终 UI 复测

### TC-09 剪贴板通道实现稳定性

- 目标：收藏成功后，卡片能走 offscreen 通道写入剪贴板
- 方法：检查 [offscreen.js](/Users/wurui/Documents/有效收藏/obsidian-post-capture-extension/extension/offscreen.js) 与 [background.js](/Users/wurui/Documents/有效收藏/obsidian-post-capture-extension/extension/background.js)
- 结果：通过代码检查
- 说明：
  - 当前使用 offscreen document + `document.execCommand("copy")`
  - 这是对之前“Document is not focused”问题的已知修复路径
- 备注：本轮没有再做外部粘贴目标的观感复测，因此只记为代码级通过

### TC-10 语法健康检查

- 目标：确认本轮改动未引入基础语法错误
- 方法：执行 `node --check`
- 结果：通过
- 覆盖文件：
  - `shared.js`
  - `background.js`
  - `options.js`
  - `popup.js`
  - `offscreen.js`
  - `obsidian-plugin/effecol/main.js`

### TC-11 本地接口鉴权

- 目标：确认 Obsidian 本地保存接口不再接受未授权写入
- 方法：代码检查 [main.js](/Users/wurui/Documents/有效收藏/obsidian-post-capture-extension/obsidian-plugin/effecol/main.js) 与 [background.js](/Users/wurui/Documents/有效收藏/obsidian-post-capture-extension/extension/background.js)
- 结果：通过代码检查，运行态待用户重启插件后复测
- 当前实现：
  - 新增 `POST /pair`，浏览器扩展会自动获取配对 token
  - `POST /save` 现在要求 `Authorization: Bearer <token>`
  - 扩展若遇到 `401` 会自动触发重新配对并重试一次
- 备注：本机当前需要你在 Obsidian 中关闭再启用一次 EffecCol 插件，才能让运行态加载这版新协议

### TC-12 内容质量风险测试

- 目标：观察“普通网页但不适合收藏”的页面是否会被误当成高价值文章保存
- 方法：复查本次 `linux.do` 论坛串保存结果
- 结果：未通过
- 发现：
  - 该页面虽然是普通 `https` 网页，但更像论坛串/动态流
  - 保存后的“网页原文”仍包含不少低价值结构化内容，例如：
    - `您已选择 0 个帖子`
    - `取消选择`
    - 大量“由某某于某日发布”的时间线信息
- 结论：当前缺少“这页值不值得按知识文章保存”的质量判断
- 发布影响：已从“完全缺失”下降为“阈值待调优”

### TC-13 低价值页面拦截

- 目标：论坛串、目录页、索引页是否会先提示，而不是直接静默写入
- 方法：检查 [background.js](/Users/wurui/Documents/有效收藏/obsidian-post-capture-extension/extension/background.js)
- 结果：通过代码检查，运行态待用户复测
- 当前实现：
  - 新增 `assessCaptureQuality(...)`
  - 当评分过低且没有明显用户选区时，会先打开状态页提示“这页不太像适合沉淀的文章”
  - 用户仍可通过“仍然保存这页”继续执行

## 当前产品判断

### 已经满足的部分

- 一键保存主流程已经跑通
- Obsidian 静默保存已经可用
- 知识卡与归档笔记已经分离
- 设置页已经具备较完整的 AI 与卡片配置能力

### 还不适合直接公开上架的部分

- 新用户安装 Obsidian 插件的引导还不够强
- 对论坛流、列表页、索引页的识别阈值仍需继续调优
- 仍缺少系统化回归测试，尤其是：
  - 常见粘贴目标的真实粘贴观感
  - 多网站正文抽取稳定性
  - 特殊网页拦截的运行态复测

## 建议的下一步

1. 先在 Chrome 扩展页重新加载 EffecCol，并在 Obsidian 中关闭再启用一次 EffecCol 插件，让新的配对鉴权逻辑进入运行态。
2. 做一轮“新用户零配置路径”专项测试，重点覆盖：
   - 未安装 Obsidian
   - 已安装但未打开
   - 已打开但未启用 EffecCol 插件
3. 用真实论坛串、目录页、长文页各测一次，继续微调低价值页面判断阈值。
4. 在公开发布前，再补更强的来源校验与 onboarding。
