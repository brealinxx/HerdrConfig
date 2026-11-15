# HerdrConfig

[English](README.md) | [简体中文](README.zh-CN.md)

个人可版本管理的 [Herdr](https://herdr.dev/) 工作区：**Project Manager → Planner → Executor → Reviewer → Version Controller**，支持按角色混用 coding agent，并提供只读 Git 历史与 diff 面板。

本仓库独立创建，不是 Herdr 或 skillshare 的 fork。默认文档和界面为英文，agent 跟随你的交流语言。项目自身的开发指引、分支策略、运行环境与发布授权仍然适用。

## 提供的功能

- 五种角色职责，按需启动交互会话，各角色可选择不同工具和模型。
- 项目外保存任务请求、初始 Git 基线、交接报告与阶段状态。
- 审查后 HEAD、暂存区、工作区或未跟踪文件内容变化时，使交付检查失效。
- 个人 Herdr 布局：团队启动、角色会话、提交历史、当前改动与版本比较。
- 安装预览、受管理文件哈希检查、mod 检查和失败回滚；不覆盖未知文件或本地编辑。
- 可选的 skillshare 跨工具资源分发说明。

角色规则是行为约定，不等于操作系统权限隔离；记录报告也不能证明报告内容真实。运行时权限和独立审查仍需执行。

## 环境要求

- Git、PowerShell **7.2+**（`pwsh`）、`hc`；安装界面和启动团队时需要正在运行的 `herdr-app`。
- 至少一种已安装并登录的交互式 agent。内置适配为 Codex、Claude Code，所有角色初始使用 Codex。
- Codex 带 `--no-daemon` 启动；未在 profile 中覆盖的模型和权限沿用工具已有配置。

开发环境为 Windows、Herdr **0.1.15**、hc **0.1.21**。WSL/Linux/macOS 运行和 Claude Code 需要单独验证。在拥有项目的环境内运行启动器，不要用 Windows 启动器绕过项目要求的 WSL 开发流程。

## 安装

仓库可放在任意目录，`F:\HerdrConfig` 只是当前机器的位置：

```powershell
git clone git@github.com:brealinxx/HerdrConfig.git F:\HerdrConfig
cd F:\HerdrConfig
git switch dev
pwsh -NoProfile -File scripts/Herdr.ps1 Doctor
pwsh -NoProfile -File scripts/Install.ps1 -Preview
pwsh -NoProfile -File scripts/Install.ps1 -Activate
```

安装器仅添加 `layouts/hcconfig.json`、布局预览和 `mods/hcconfig-*`，不替换内置布局、官方 `AGENTS.md`、快捷键、设置、凭据和其他 mod。文件哈希清单存于 Herdr 配置目录。更新仓库后重新安装；移动仓库后也需重新安装以更新启动器路径。

mod 会执行 Git；只有点击 **Start team** 后，团队面板才调用本机启动器和所选 agent。mod 自身不访问网络，agent 可使用其配置的服务。不自动安装外部 agent 或 skillshare。

使用 Herdr 布局选择器切换。卸载受管理文件并恢复之前布局：

```powershell
pwsh -NoProfile -File scripts/Install.ps1 -Remove -Preview
pwsh -NoProfile -File scripts/Install.ps1 -Remove
```

如果受管理文件被本地修改，安装/移除会停止并保留修改；请先保存或协调这些改动。任务记录不会随卸载删除。

## 在项目中开工

在个人布局中输入任务，按需选择本机项目目录和 team JSON，点击 **Start team**。PM 在新的项目 space 中启动，其他角色按需分派；点击角色会话即可查看终端。

命令行使用 UTF-8 请求文件，避免多行文字和引号歧义：

```powershell
pwsh -NoProfile -File F:\HerdrConfig\scripts\Herdr.ps1 Start `
  -Project F:\Projects\Example -Request F:\Tasks\request.md -Preview

pwsh -NoProfile -File F:\HerdrConfig\scripts\Herdr.ps1 Start `
  -Project F:\Projects\Example -Request F:\Tasks\request.md
```

`-Preview` 不写入或启动会话；`-NoLaunch` 只创建任务记录。保存输出的任务 ID，后续操作使用它。

启动器检查 Git 项目，但不会自动切分支、stash、提交或推送。PM 和 Version Controller 在检查基线后执行项目规则。单纯 `cd` 进入目录不会启动团队。

## 混用 agent 与模型

复制 [projects/mixed.example.json](projects/mixed.example.json) 为本地配置，修改命令参数数组和角色映射：

```json
{
  "schemaVersion": 1,
  "profiles": {
    "claude-planner": { "command": ["claude", "--model", "sonnet"] },
    "codex-review": { "command": ["codex", "--no-daemon", "--sandbox", "read-only"] }
  },
  "roles": {
    "planner": "claude-planner",
    "reviewer": "codex-review"
  }
}
```

`Start` 传入 `-Config <文件>`。未指定的角色继承 [config/team.json](config/team.json)，有效配置按任务冻结。`*.local.json` 不提交 Git。缺少可执行程序时明确失败，不会默默更换工具。

命令使用原生参数数组。角色和任务提示作为**单独一个位置参数**追加，这是内置 Codex/Claude 适配的方式。其他 CLI 需要兼容适配，不能假设直接支持任意工具；不要把 shell 管道写进 `command`。Profile 属于可信可执行配置。

本机 hc 0.1.21 的命令模板会尝试启动不存在的 `sh`，因此启动器采用原生交互式 argv，不使用 shell 模板。启动成功只说明进程收到了参数，不代表目录信任、登录或任务完成。使用 `hc get/read/wait` 检查，不要对可能已经启动的任务盲目重试。

## 职责与交接

| 角色 | 负责 | 边界 |
|---|---|---|
| Project Manager | 范围、验收、分派、阻塞、汇报 | 不默默接管实现 |
| Planner | 调研、方案、依赖、验证计划 | 不修改业务代码和 Git |
| Executor | 实现、测试、修复审查问题 | 不暂存、提交、集成或发布 |
| Reviewer | 独立检查实现和证据 | 不修改业务代码；结论绑定快照 |
| Version Controller | 基线/worktree、暂存范围、授权交付 | 不集成未审查修改；不默认获得发布权限 |

完整约定见 [workflows/contract.md](workflows/contract.md)，交接格式见 [报告模板](workflows/report-template.md)。PM 阅读证据后记录阶段：

```powershell
$taskId = '<输出的任务ID>'
pwsh -NoProfile -File scripts/Herdr.ps1 RunRole -Task $taskId -Role planner
pwsh -NoProfile -File scripts/Herdr.ps1 Record -Task $taskId -Role planner -Report C:\Tasks\plan.md
pwsh -NoProfile -File scripts/Herdr.ps1 RunRole -Task $taskId -Role executor
pwsh -NoProfile -File scripts/Herdr.ps1 Record -Task $taskId -Role executor -Report C:\Tasks\implementation.md
pwsh -NoProfile -File scripts/Herdr.ps1 RunRole -Task $taskId -Role reviewer
pwsh -NoProfile -File scripts/Herdr.ps1 Record -Task $taskId -Role reviewer -Report C:\Tasks\review.md -Decision passed
pwsh -NoProfile -File scripts/Herdr.ps1 Gate -Task $taskId
pwsh -NoProfile -File scripts/Herdr.ps1 RunRole -Task $taskId -Role version-controller
pwsh -NoProfile -File scripts/Herdr.ps1 Record -Task $taskId -Role version-controller -Report C:\Tasks\delivery.md
```

`-Decision changes-requested` 退回 Executor。已审批内容发生变化后，重新记录 Executor 报告并再次审查。PM 可在 `planning` 阶段启动 Version Controller 检查基线，这不等于批准最终交付。`Status -Task $taskId` 查看保存状态。同一任务的并发 CLI 操作会被拒绝，避免覆盖记录。

Windows 任务记录默认位于 `%LOCALAPPDATA%\HerdrConfig\runs`；其他系统为 `$XDG_STATE_HOME/herdrconfig/runs` 或 `~/.local/state/herdrconfig/runs`。可通过绝对路径环境变量 `HERDRCONFIG_STATE_HOME` 覆盖。记录可能包含项目路径和请求，不提交或同步。只读 agent 无法写报告目录时，将报告内容返回 PM 保存。

## Git 历史与 diff

面板跟随当前项目/worktree，显示仓库路径和分支。History 查看提交及变更文件；Working tree 区分暂存、未暂存和未跟踪内容；Compare 比较两个版本。过滤、翻页和明确的输出限制用于控制大仓库显示。

Git 调用使用参数数组、字面路径、禁用外部 diff/textconv，并在异步结果应用前核对项目与请求。面板不暂存、丢弃、提交、推送或切换分支。Reviewer 和 Version Controller 可使用同一视图，但最终验收仍需证据和 Gate。

## skillshare

见[集成说明](integrations/skillshare/README.zh-CN.md)。skillshare 用于资源分发，HerdrConfig 负责流程与界面。可选的 skillshare Source 面板管理资源仓库，本仓库的 Git 面板查看选中的业务项目。安装和同步独立、按需执行。

## 验证与限制

```powershell
pwsh -NoProfile -File tests/Test-Workflow.ps1
pwsh -NoProfile -File tests/Test-Install.ps1
pwsh -NoProfile -File tests/git-panel/Test-GitPanel.ps1
herdr-app check herdr/mods/hcconfig-team
herdr-app check herdr/mods/hcconfig-git
git diff --check
```

实际结果与未验证范围见 [docs/VALIDATION.md](docs/VALIDATION.md)。CI 配置存在不代表 CI 已运行。`herdr-app check` 不覆盖延迟渲染和真实交互。

Git 数据测试需要 Node.js 22+，仅测试使用，已安装 mod 不需要 Node。`Test-GitPanel.ps1 -Node <node绝对路径>` 支持 PATH 外的运行时并等待原生检查。任意启动器命令也可显式传入 `-StateHome <绝对路径>`，初始提示会把此选项传递给子 agent。

当前每个任务采用顺序交付流程。多个 Executor 并行需要明确隔离 worktree/文件范围和 PM 协调，没有自动合并调度器。脏子模块需单独审查。终端恢复不等于 agent 会话恢复。团队面板尚不支持直接启动远程机器任务；需在目标环境安装依赖并运行启动器。

## 仓库结构

```text
config/             默认工具配置与角色映射
roles/              五种角色职责
workflows/          阶段和交接约定
projects/           可移植配置示例
scripts/            启动器、任务状态、检查门槛、安装器
herdr/              个人布局与原创 mods
integrations/       可选的 skillshare 说明
tests/              隔离验证
docs/               验证记录与限制
```

日常配置开发使用 `dev`，`origin` 指向你自己的仓库。安装不会创建版本标签或发布。
