# 开发与发布约定

- 每次用户可见的功能调整都应在同一次改动中更新 `CHANGELOG.md` 的“未发布”部分，按“新增、改进、修复、移除、弃用、安全”分类；不必保留空分类。
- 更新日志描述用户能感受到的行为变化，不记录个人路径、笔记内容或临时测试数据。
- 发布时将“未发布”条目归入新版本，填写发布日期；同步 `manifest.json`、`package.json`、锁文件及 `versions.json`。标签支持 `X.Y.Z` 和 `vX.Y.Z`；面向 Obsidian 社区目录时使用不带 `v` 的标签，与 manifest 版本完全一致。
- 提交前运行适合改动的类型检查、Git 集成测试与隔离 Obsidian 测试。在 `VALIDATION.md` 如实记录验证结果和未覆盖的环境。
- 使用 `npm run package` 生成安装包。构建产物通过 GitHub Release 分发，不提交 `dist`、`release` 或个人本地配置。
- Git 写操作验证使用临时仓库和本地 bare 远程；个人笔记库只用于安装与只读验收。

## GitHub Actions 自动发布

`.github/workflows/release.yml` 在推送版本标签时运行，也可在 GitHub Actions 的 Release 页面通过 Run workflow 输入已有标签手动运行。

发布前：

1. 更新 `manifest.json`、`package.json`、`package-lock.json` 顶层及根包的版本号，并在 `versions.json` 添加版本与最低 Obsidian 版本的映射。
2. 将本次更新整理到 `CHANGELOG.md` 的 `## [X.Y.Z] - YYYY-MM-DD` 部分；发布说明只提取该部分。
3. 本地运行 `npm test`、`npm run package` 和 `npm run test:obsidian`。隔离 Obsidian 测试需要本机应用包，不在 GitHub 托管 runner 上运行。
4. 提交并推送准备发布的源码、版本文件和工作流，再创建并推送版本标签。例如准备好 0.1.4 后执行：

```powershell
git tag 0.1.4
git push origin 0.1.4
```

工作流使用 Node.js 24，依次校验版本、安装依赖、运行 Git 集成及发布迁移测试、构建与打包。通过后上传独立的 `main.js`、`manifest.json`、`styles.css`、`LICENSE`、`THIRD-PARTY-LICENSES.txt` 和 `git-workbench-X.Y.Z.zip`。

发布任务使用内置 `GITHUB_TOKEN`，无需添加额外 Secret。构建任务只读，发布任务单独申请 `contents: write`。附件全部上传成功后才公开 Release；失败留下的草稿可通过重跑恢复，已公开的 Release 不会被覆盖。需要替换已公开版本时应发布新版本。
