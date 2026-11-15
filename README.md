# HerdrConfig

[English](README.md) | [简体中文](README.zh-CN.md)

A personal, versioned [Herdr](https://herdr.dev/) workspace for **Project Manager → Planner → Executor → Reviewer → Version Controller**, with interchangeable coding agents and a read-only Git history/diff panel.

This is an independent configuration repository, not a fork of Herdr or skillshare. Default documentation and UI are English; agents follow your conversation language. Your project keeps its own instructions, branch policy, runtime requirements, and publication permissions.

## What it provides

- Five role contracts, on-demand interactive sessions, and per-role tool/model selection.
- Task requests, initial Git baselines, handoff reports, and stage state stored outside your project.
- A review gate that detects changes to HEAD, index, working tree, and untracked file content after approval.
- A personal Herdr layout with a team launcher, role sessions, Git history, working changes, and revision comparison.
- A previewable installer that refuses to overwrite unknown or locally edited files, checks mods, and rolls back failed installation.
- Optional skillshare guidance for distributing shared resources across tools.

Roles provide workflow separation. They are not an OS permission boundary, and a recorded report is not proof that every claim in it is true. Runtime sandbox policies and an independent review remain important parts of the workflow.

## Requirements

- Git, PowerShell **7.2+** (`pwsh`), `hc`, and a running `herdr-app` for UI installation/launch.
- At least one installed and authenticated interactive agent. The bundled profiles support Codex and Claude Code; all roles initially use Codex.
- Codex launches with `--no-daemon`. Model and permission settings are inherited unless you explicitly override them in a profile.

Developed against Windows, Herdr **0.1.15**, and hc **0.1.21**. WSL/Linux/macOS execution and Claude Code require separate validation. Run the launcher inside the environment that owns the project; do not use a Windows launcher to bypass a project's WSL-only development rule.

## Install

Clone your configuration repository anywhere; `F:\HerdrConfig` is only this machine's chosen location:

```powershell
git clone git@github.com:brealinxx/HerdrConfig.git F:\HerdrConfig
cd F:\HerdrConfig
git switch dev
pwsh -NoProfile -File scripts/Herdr.ps1 Doctor
pwsh -NoProfile -File scripts/Install.ps1 -Preview
pwsh -NoProfile -File scripts/Install.ps1 -Activate
```

The installer adds only `layouts/hcconfig.json`, its preview, and `mods/hcconfig-*`. It does not replace built-in layouts, `AGENTS.md`, keys, settings, credentials, or other mods. It stores a hash manifest in the Herdr app directory. Re-run it after updating this checkout; if you move the checkout, reinstall so the launcher path is refreshed.

The mods execute Git and, only when you click **Start team**, the local launcher and your selected agent. The mods themselves do not contact network services; agents may use their configured services. No external agent or skillshare is automatically installed.

Switch layouts using Herdr's layout selector. To remove the managed files and return to the previous layout:

```powershell
pwsh -NoProfile -File scripts/Install.ps1 -Remove -Preview
pwsh -NoProfile -File scripts/Install.ps1 -Remove
```

Locally edited managed files cause installation/removal to stop without overwriting them. Reconcile or save those edits first. Task records are retained.

## Start a project

In the personal layout, expand **New task**, enter the request, optionally select a local project and team JSON, then click **Start team**. The PM starts in a new project space.

The sidebar groups real agent sessions under their spaces. Working sessions have a native pulsing dot; blocked/done states remain visible, idle sessions are folded, and unstarted roles have no placeholder cards. Click a session to select its space/tab and peek at its terminal. Roles come from the launcher's labels; other agents show their actual tool name. Use **Hide Git** in the sidebar (or **Hide** in the Git panel) to reclaim terminal space; **Show Git** restores it. Visibility and expanded sections are remembered by Herdr.

From a terminal, use a UTF-8 request file so quoting and multiline text remain unambiguous:

```powershell
pwsh -NoProfile -File F:\HerdrConfig\scripts\Herdr.ps1 Start `
  -Project F:\Projects\Example -Request F:\Tasks\request.md -Preview

pwsh -NoProfile -File F:\HerdrConfig\scripts\Herdr.ps1 Start `
  -Project F:\Projects\Example -Request F:\Tasks\request.md
```

`-Preview` writes nothing and starts no sessions. `-NoLaunch` creates the task records without starting PM. Keep the printed task ID for later commands.

The launcher checks the Git project but does **not** automatically checkout, stash, commit, or push. PM and Version Controller apply the project's own rules after inspecting the initial baseline. Opening a directory with `cd` alone does not launch agents.

## Mix agents and models

Copy [projects/mixed.example.json](projects/mixed.example.json) to a local configuration file, then customize its command arrays and role mapping:

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

Pass `-Config <file>` to `Start`. Omitted roles inherit [config/team.json](config/team.json); the effective configuration is frozen for the task. `*.local.json` is ignored by Git. Missing executables fail with a clear error rather than silently switching vendors.

Commands are native argument arrays. The initial role/task prompt is appended as **one positional argument**, as supported by the bundled Codex/Claude profiles. Other CLIs need a compatible adapter; arbitrary tools are not automatically supported. Do not put shell pipelines in `command`. Profiles are trusted executable configuration.

For hc 0.1.21 on this Windows installation, command templates attempted to start unavailable `sh`. The launcher therefore uses direct interactive argv, not shell-based hc templates. Successful launch means the process received arguments, not that trust/login dialogs were accepted or the model completed the task. Inspect `hc get`, `hc read`, and `hc wait`; do not blindly retry a possibly started session.

## Responsibilities and handoffs

| Role | Owns | Boundary |
|---|---|---|
| Project Manager | Scope, acceptance, delegation, blockers, final report | Does not silently take over implementation |
| Planner | Investigation, plan, dependencies, validation strategy | No business-code edits or Git writes |
| Executor | Implementation, tests, review fixes | No staging, commits, merging, or publication |
| Reviewer | Independent review of implementation and evidence | No business-code edits; approval tied to a snapshot |
| Version Controller | Baseline/worktrees, staged scope, authorized delivery | No unreviewed changes or blanket publishing permission |

The complete contract is in [workflows/contract.md](workflows/contract.md). [workflows/report-template.md](workflows/report-template.md) defines the evidence format. PM reads reports before recording them:

```powershell
$taskId = '<printed-task-id>'
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

Use `-Decision changes-requested` to return to Executor. Record new Executor evidence after any change to an approved snapshot, then repeat review. PM may launch Version Controller during `planning` for a preflight; this does not grant final delivery approval. `Status -Task $taskId` shows saved state. Concurrent CLI operations on the same task are rejected rather than overwriting state.

Task state defaults to `%LOCALAPPDATA%\HerdrConfig\runs` on Windows and `$XDG_STATE_HOME/herdrconfig/runs` (or `~/.local/state/herdrconfig/runs`) elsewhere. Set `HERDRCONFIG_STATE_HOME` to an absolute local path to override. These records can include project paths and requests; they are not committed or synchronized. Read-only agents can return report contents to PM when they cannot write the task directory.

## Git history and diff

The read-only panel follows the active project/worktree and displays its repository and branch. Use history to inspect commits and changed files, working-tree mode to distinguish staged/unstaged/untracked content, and compare mode to inspect two revisions. Filtering, paging, and output limits keep large repositories manageable.

The panel uses argument arrays, literal paths, disabled external diff/textconv, and request/context checks before applying asynchronous results. It does not stage, discard, commit, push, or change branches. Reviewers and Version Controller can use the same view; final acceptance still requires evidence and Gate.

## skillshare

See [integration notes](integrations/skillshare/README.md). skillshare can distribute resources; HerdrConfig controls workflow and UI. Its optional Source panel concerns the resource repository, while this project's Git panel inspects your selected code repository. Installation and synchronization are separate, opt-in operations.

## Validation and limitations

```powershell
pwsh -NoProfile -File tests/Test-Workflow.ps1
pwsh -NoProfile -File tests/Test-Install.ps1
pwsh -NoProfile -File tests/git-panel/Test-GitPanel.ps1
node tests/test-sidebar.mjs
herdr-app check herdr/mods/hcconfig-team
herdr-app check herdr/mods/hcconfig-git
git diff --check
```

See [docs/VALIDATION.md](docs/VALIDATION.md) for actual results and unverified items. CI configuration is not evidence of a completed CI run. `herdr-app check` alone does not verify deferred renders or live interactions.

The Git data tests require Node.js 22+ (test-only; the installed mods do not need Node). `Test-GitPanel.ps1 -Node <absolute-node-path>` supports a runtime outside PATH and waits for native checks. Custom task roots can also be passed explicitly as `-StateHome <absolute-path>` to any launcher command; the initial prompt includes this option for child agents.

Current scope is one sequential delivery workflow per task. Parallel Executors require explicit isolated worktrees/scopes and PM coordination; there is no automatic merge scheduler. Dirty submodules require separate review. Restoring a terminal after a crash does not restore an agent conversation. Remote-machine launching from the team panel is not implemented; run the launcher on the target machine after installing its prerequisites.

## Repository map

```text
config/             Default tool profiles and role mapping
roles/              Five role contracts
workflows/          Stage and handoff contracts
projects/           Portable configuration examples
scripts/            Launcher, task state, gate, installer
herdr/              Personal layout and original mods
integrations/       Optional skillshare guidance
tests/              Isolated verification
docs/               Validation evidence and limits
```

Use `dev` for daily configuration work. Remote `origin` is your own repository. No version tag or release is created by installation.
