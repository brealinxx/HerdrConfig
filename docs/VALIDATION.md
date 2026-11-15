# Validation record / 验证记录

Date: **2026-11-15**. This records observed checks, not a claim of full multi-agent or cross-platform acceptance.

## English

| Area | Actual result |
|---|---|
| Workflow | `tests/Test-Workflow.ps1`: 32 assertions passed using temporary real Git repositories and an in-memory hc substitute. Includes empty repositories, Unicode/space paths, review rejection, untracked bytes, staged changes, stale approval, missing executable, role overrides, initial prompt content, state-root propagation, and failed first-message delivery. No real agents launched by this suite. |
| Installer | `tests/Test-Install.ps1`: 19 assertions passed. A deliberately invalid mod triggers a real native validation failure in an isolated app directory; original layout/manifest and user files remain intact, created files roll back, and local edits/read-only files are rejected. Edit/create races before backup, absent files and empty files are covered. Actual removal and fresh reinstallation also passed. |
| Git data/controller | 12 regression groups passed with 78 read-only Git queries. Real fixtures cover paging, root/merge commits, worktrees, comparisons, invalid refs, staged/unstaged/untracked content, binary content and unchanged index bytes/mtime. Simulated tests cover context races, remote routing, output bounds, and newline/tab paths. |
| Native mod checks | Team mod and Git mod passed. Git panel also passed populated history/worktree/compare fixtures. The installer waits for actual checker exit codes. |
| Live Codex launch | Direct `hc run` launched interactive Codex with `--no-daemon`, the expected cwd, role/task labels, and a single initial prompt argument. In an isolated fixture it read `fixture.txt` and returned `HERDRCONFIG_SMOKE_OK HerdrConfig smoke fixture.` No coding or publication task was assigned. Test-owned terminals were closed afterward. |
| Live Herdr UI | Installed and activated `hcconfig`. Viewed history/commit selection with a Unicode filename patch, staged worktree diff, endpoint comparison and merge-base mode via Herdr commands/screenshots. Checked 320/480 logical-pixel Git panels and light/dark appearance. `herdr-app status` returned no errors. Team controls were given explicit input borders and vertical scrolling after screenshot inspection. |
| Scope preservation | Source repository is separate from the user's existing application repository. No reset/cleanup/branch changes were performed in that application repository. Test spaces were closed; the prior appearance was restored. |

Local screenshots and the Codex smoke transcript are under ignored `TestResults/`. They contain machine-specific paths and are intentionally not published. Native `check` may generate ignored type/editor files alongside mods.

Not verified:

- A complete autonomous PM → Planner → Executor → Reviewer → Version Controller development task, including real commits by the final role.
- Claude Code or another vendor's actual launch/login, model availability, or mixed-vendor handoffs. Claude is not installed on the validation machine.
- Real mouse/keyboard interaction, native folder selection, typing filters, and scrolling. Herdr's own commands exercised the corresponding controller paths; that is not equivalent to physical input testing.
- WSL/Linux/macOS launch behavior, remote machines, all DPI/window sizes, exhaustive accessibility, or real skillshare installation/sync.
- A CI run: the workflow is supplied for Windows/Linux workflow/data checks; its presence is not a successful run.

The Git panel is a paged history list rooted at the loaded HEAD, not a full all-branch graph. Renames appear as deletion/addition. Merges use first-parent diffs. It intentionally has no write actions and no filesystem polling; use Refresh for changes within the same project.

## 简体中文

- **工作流**：32 项检查通过，使用隔离真实 Git 仓库和内存 hc 替身；覆盖空仓库、中文/空格路径、退回修复、未跟踪内容、暂存变化、审查过期、缺少工具、配置继承、首条请求、状态根传递和首消息失败。该套测试不启动真实 agent。
- **安装器**：19 项检查通过；在独立配置目录中故意加载无效 mod，验证真实检查失败后原文件/清单恢复、新文件回滚、用户文件保留，以及本地编辑/只读文件保护；补充备份前编辑/新建竞争、缺失文件和空文件验证。实际移除与全新重装也通过。
- **Git 数据与控制器**：12 组、78 次只读 Git 查询通过；真实仓库覆盖翻页、根提交/合并、worktree、版本比较、无效引用、暂存/未暂存/未跟踪、二进制及索引不变。异步竞争、远端路由、输出上限与换行/tab 路径使用模拟。
- **原生检查**：团队与 Git mod 通过；Git 的三种有数据状态也通过。安装器等待真实进程退出并检查退出码。
- **真实 Codex 启动**：已验证交互启动、`--no-daemon`、工作目录、标签和独立首条参数；临时仓库中读取文件并返回预期 `HERDRCONFIG_SMOKE_OK`。没有分派真实开发或发布任务，测试会话已关闭。
- **实际窗口**：已安装并启用 `hcconfig`，通过 Herdr 命令和截图查看历史选择/中文 patch、暂存 diff、endpoint 比较和 merge-base 模式；检查 320/480 逻辑像素宽度和浅深主题，状态无错误。查看截图后补充团队输入框边框与垂直滚动。
- **范围保护**：独立配置仓库没有重置、清理或切换原应用仓库。测试 space 已关闭，原外观设置已恢复。

截图和冒烟文本保存在忽略的 `TestResults/`，含本机路径，不上传。原生检查生成的类型/编辑器文件也被忽略。

**未验证**：完整五角色自主开发闭环及最终角色的真实 Git 交付；Claude/其他供应商真实启动、登录和混合交接；真实键鼠、目录选择器、过滤输入及滚动；WSL/Linux/macOS、远端机器、全部 DPI/尺寸、完整辅助功能；skillshare 安装同步；远程 CI 是否运行通过。

Git 历史是从当前加载 HEAD 出发的分页列表，不是完整多分支图。重命名显示为删除/新增，合并按第一父提交比较。面板没有写操作和文件轮询，同项目发生变化时需 Refresh。
