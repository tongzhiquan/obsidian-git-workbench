# 验证说明

本文说明验证方法、结果范围及已知边界。每次结果按日期、版本和测试范围记录，不将专项通过等同于完整回归通过。详细记录见 [验证历史](docs/validation-history.md)。

## 验证方法

| 检查 | 命令或方式 | 范围 |
| --- | --- | --- |
| 类型与构建 | `npm run build` | TypeScript、打包和许可声明 |
| Git 集成及单元测试 | `npm test` | 临时仓库、本地 bare 远程和安装迁移 |
| 完整界面回归 | `npm run test:obsidian` | 独立 profile 中的 Obsidian 交互 |
| 源代码管理专项 | 设置 `GIT_WORKBENCH_QA_SOURCE_CONTROL_ONLY=1` 后运行界面测试 | 侧栏、过滤、批量操作和文件菜单 |
| 差异刷新专项 | 设置 `GIT_WORKBENCH_QA_DIFF_REFRESH_ONLY=1` 后运行界面测试 | 原地更新、滚动和编辑器状态 |
| 发布包 | `npm run package` | 版本一致性、附件和 ZIP 内容 |
| 实际环境安装 | 本地安装、重载及只读校验 | 运行文件、设置、HEAD、Git index 和启用列表 |

本机路径和操作步骤见 [开发指南](CONTRIBUTING.md)。Git 写操作在隔离仓库验证；实际笔记库仅用于安装和只读验收。测试不得还原或覆盖用户正在变化的暂存区、设置或笔记。

## 验证结果索引

环境：Windows / Obsidian 1.14.4。下表版本均含当时未发布的修改，具体覆盖内容见历史记录。

| 日期 | 版本 | 范围 | 结果 |
| --- | --- | --- | --- |
| 2026-10-21 | 0.3.0 | 笔记库过滤、文件菜单、最小安装 | 构建通过，57 项 Git 及单元测试、33 项源代码管理专项通过，运行时错误为 0；未重跑完整界面回归 |
| 2026-10-21 | 0.3.0 | 暂存区编辑权限、差异刷新与工作台入口 | 构建通过，54 项 Git 及单元测试、135 项完整界面检查通过，打包和本地重载通过 |

文件菜单验证期间的完整回归曾在悬浮卡片交互、统一差异滚动定位处失败；后续源代码管理专项不覆盖这两项，失败记录保留，需单独复核。系统资源管理器自动检查拦截系统调用；Windows 窗口置前效果由实际使用确认与 Obsidian 内置功能一致。

## 结果文件

机器结果保存在已忽略的 `.qa` 目录，不随插件发布；同名文件可能被后续运行覆盖，应结合其中的测试目录和历史记录判断批次。

| 文件 | 内容 |
| --- | --- |
| `obsidian-results.json` / `obsidian-failure.json` | 完整界面结果或失败上下文 |
| `source-control-results.json` | 源代码管理专项 |
| `diff-refresh-results.json` | 差异更新顺序、编辑器身份和滚动位置 |
| `minimal-install-verification.json` | 三个运行文件、旧随附文件归档及实际笔记库校验 |
| `dependency-audit.json` | 打包依赖和宿主模块边界 |
| `git-workbench-*.png` | 对应测试的界面截图 |

刷新专项人为延迟状态查询 350ms，用于核对更新顺序，不以机器相关的耗时阈值判定通过。历史文本复制在 CodeMirror 完成布局后设置原生选区。

## 未覆盖与边界

- macOS / Linux 桌面环境尚未实机验证。
- SSH / HTTPS 真实账户认证尚未实测；远程操作使用本地 bare 仓库验证。
- 子模块内部仓库、Git LFS 专用交互和交互式 rebase 不在功能范围。
- 大于 2 MiB 的文本及二进制文件仅显示元信息；冲突支持文件级选择。

功能行为见 [README](README.md)，设计约定见 [差异比较设计](docs/line-staging-and-revision-selection.md)。
