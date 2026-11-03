# 贡献指南

## 开始开发

建议使用 Node.js 24、Git 2.30 或以上版本。

```powershell
npm ci
npm test
npm run build
```

涉及 Obsidian 界面时，在本机准备 Obsidian 桌面安装包后运行：

```powershell
npm run test:obsidian
```

常用命令：

| 命令                    | 用途                   |
| ----------------------- | ---------------------- |
| `npm run dev`           | 监听源码并构建         |
| `npm test`              | 运行 Git 和单元测试    |
| `npm run build`         | 类型检查并构建插件     |
| `npm run test:obsidian` | 运行隔离 Obsidian 回归 |
| `npm run package`       | 生成发布 ZIP           |

## 界面翻译

界面文案集中在 `src/i18n/zh-CN.ts` 和 `src/i18n/en.ts`，使用语义键和参数插值；两份语言表的键及参数必须一致。新增文案应通过翻译函数使用，不要拼接句子或翻译笔记、提交消息等用户内容。语言只在插件加载时解析，保存语言选项时不要重建编辑器或刷新当前工作台。

`npm test` 包含语言解析、插值、文案完整性和原始 Git 输出保留检查；`npm run test:obsidian` 同时验证中文回归、英文界面和手动重载行为。

## 提交修改

提交前确认：

- 用户可见行为已在 README 或 CHANGELOG 中说明。
- Git 写入、冲突处理和错误提示没有回退。
- 测试和构建通过。
- 没有提交个人笔记库、凭据、日志、构建产物或本机配置。

请保持改动聚焦，并在提交消息中说明行为变化。提交消息推荐使用 Conventional Commits 风格，例如 `fix(ui): correct staged rename paths`。

## 本地安装

本地安装脚本只用于维护者验证，不是插件运行所需。复制 `git-workbench.local.example.json` 为 `git-workbench.local.json`，填写本机路径后运行：

```powershell
npm run install-local
npm run reload-local
```

本地配置已被 Git 忽略。不要把笔记库路径、凭据或其他本机信息写入源码、Issue 或提交记录。

## 发布

发布前同步 `manifest.json`、`package.json`、`package-lock.json` 和 `versions.json` 的版本号，在 CHANGELOG 中添加对应版本章节，然后运行：

```powershell
npm test
npm run package
```

发布使用不带 `v` 前缀的版本标签，例如 `0.5.1`。标签推送后，GitHub Actions 会校验元数据、运行测试、构建并生成 Release 附件。

## 许可证

贡献代码即表示同意项目使用 [MIT 许可证](LICENSE)。
