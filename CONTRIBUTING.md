# 开发指南

## 构建与测试

建议使用 Node.js 24，系统 Git 需为 2.30 或以上。

```powershell
npm ci
npm test
npm run build
npm run test:obsidian
```

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 监听源码并构建 |
| `npm run typecheck` | TypeScript 检查 |
| `npm run build` | 检查并构建至 `dist` |
| `npm test` | 临时仓库中的 Git 集成及单元测试 |
| `npm run test:obsidian` | 构建并运行隔离 Obsidian 界面检查 |
| `npm run package` | 构建，生成 `release` 附件及 ZIP |
| `npm run check-vault` | 只读检查目标笔记库的仓库状态和提交图 |

隔离测试使用独立 profile、临时仓库和本地 bare 远程，不访问真实笔记库。Obsidian 界面测试需要本机应用包；GitHub 托管 runner 只运行 Git、单元和发布配置测试。验证结果及未覆盖环境见 [验证记录](https://github.com/tongzhiquan/obsidian-git-workbench/blob/main/VALIDATION.md)。

## 本地配置与安装

复制 `git-workbench.local.example.json` 为 `git-workbench.local.json`，填写本机路径。后者已被 Git 忽略；Windows 路径推荐使用 `/`。

| 字段 | 用途 | 环境变量 |
| --- | --- | --- |
| `vaultPath` | 安装、重载和只读检查的目标笔记库 | `GIT_WORKBENCH_VAULT` |
| `obsidianAsar` | 隔离测试使用的 Obsidian 应用包 | `OBSIDIAN_ASAR` |
| `obsidianLauncherAsar` | 隔离测试使用的启动器应用包 | `OBSIDIAN_LAUNCHER_ASAR` |
| `obsidianCli` | CLI 路径，默认从 PATH 查找 `obsidian` | `OBSIDIAN_CLI` |

笔记库路径依次取命令参数、环境变量、本地配置；相对路径基于项目根目录。兼容旧的 `git-plus.local.json` 和 `GIT_PLUS_VAULT`，新名称优先。

```powershell
npm run build
npm run install-local
npm run reload-local
```

也可用 `npm run install-local -- "/path/to/vault"` 指定目标。安装复制最近一次构建和随附文档，保留设置；首次升级可迁移旧插件 ID、设置、快捷键和工作区引用，并在插件目录备份变更前的配置。重载前 CLI 会核对笔记库真实路径。CLI 不可用时，在 Obsidian 中停用再启用插件。

个人笔记库仅用于安装与只读验收。安装前后核对 HEAD、Git index、插件设置及启用列表；Git 写操作测试使用隔离仓库。`dist`、`release`、`.qa` 和个人配置不提交到源码仓库。

## 依赖边界

Obsidian 提供的 `obsidian`、`electron`、CodeMirror commands/state/view/language 和 Lezer 模块保持 external；`@codemirror/commands` 为开发依赖。merge、diff 及实际引用的 style-mod 随插件打包，并保留许可声明。

调整打包边界后，应在 Obsidian 中验证编辑、撤销/重做和 Ctrl/Cmd+S。比较交互及写入约束见 [差异比较设计](https://github.com/tongzhiquan/obsidian-git-workbench/blob/main/docs/line-staging-and-revision-selection.md)。

## 更新与发布

用户可见变化记入 `CHANGELOG.md` 的“未发布”部分，按新增、改进、修复、移除、弃用、安全分类，不保留空分类。描述最终行为，不记录个人路径、笔记内容或临时测试数据。

发布步骤：

1. 同步 `manifest.json`、`package.json`、锁文件两处版本，以及 `versions.json` 的版本与最低 Obsidian 版本映射。
2. 将更新日志归入 `## [X.Y.Z] - YYYY-MM-DD`，发布说明只提取该节。
3. 运行 `npm test`、`npm run package` 和隔离 Obsidian 测试。
4. 提交并推送源码，再创建并推送与 manifest 完全一致的附注标签。

例如准备好 0.2.1 后：

```powershell
git tag -a 0.2.1 -m "0.2.1"
git push origin 0.2.1
```

新标签不加 `v`，Release 标题使用相同版本号；历史标签及链接保留。`.npmrc` 已清空 npm 的默认标签前缀，但 `npm version` 不会同步 manifest 和 versions 映射，仍需核对全部版本文件。

[Release 工作流](https://github.com/tongzhiquan/obsidian-git-workbench/blob/main/.github/workflows/release.yml) 在标签推送时自动校验、测试、构建和发布，也可输入已有标签手动运行。附件为 `main.js`、`manifest.json`、`styles.css` 和 ZIP；许可文件保留在仓库、代码及 ZIP 中，不单独上传。

发布使用内置 `GITHUB_TOKEN`，发布任务单独申请 `contents: write`。全部附件上传成功后才公开 Release；失败草稿可重跑，已公开版本不覆盖，修正需发布新版本。
