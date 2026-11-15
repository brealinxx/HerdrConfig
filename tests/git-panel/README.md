# Git panel validation

[简体中文](README.zh-CN.md)

## Run

Requires Windows PowerShell 7, Git, Node.js 22+ and Herdr. From the repository root:

```powershell
pwsh -NoProfile -File tests/git-panel/Test-GitPanel.ps1
# If Node is not on PATH:
pwsh -NoProfile -File tests/git-panel/Test-GitPanel.ps1 -Node '<absolute path to node.exe>'
```

The script runs `test-git-panel.mjs`, then `herdr-app check` on the real mod and three temporary populated-state fixtures (history, worktree, compare). It explicitly waits for the Windows GUI executable and checks its exit code. A plain PowerShell invocation of `herdr-app check` can return before the checker finishes.

All synthetic repositories, commits, linked worktrees and native-check fixtures are created under this test directory. They are removed in `finally` after validating the cleanup path. No source-repository commit, deployment or layout switch is performed. `herdr-app check` may generate `gpui-kit.d.ts` and `jsconfig.json` in the mod directory; these are editor artifacts, not implementation files.

Core-only invocation: `node tests/git-panel/test-git-panel.mjs`. This includes controller tests with a simulated native host; it does not draw an actual window.

## Unreleased: implemented behavior

- Follows the focused terminal's directory/machine, retaining its context when the Git pane receives focus. Displays the worktree root and branch/detached HEAD.
- History uses 30-row pages pinned to the loaded HEAD. Message keywords are case-insensitive fixed strings. The file filter is a literal repository-relative file/directory, not a glob. Press Enter or Apply; typing alone does not launch Git.
- Select a commit for its complete message (bounded), changed files and per-file patch. Root commits compare against the empty tree. Merge commits explicitly use the first parent. Renames display as deletion plus addition.
- Worktree entries distinguish staged, unstaged, untracked and conflicts. A path can appear in both staged and unstaged groups. Untracked files use the host's text reader; no staging or other mutation is available.
- Comparison resolves both refs to commit IDs before diffing. Endpoint is A→B. Merge-base is the unique common ancestor→B; absent or multiple merge bases produce an explicit error.
- All Git execution uses argument arrays, no shell, no optional index locks, no filesystem monitor and literal pathspecs. Every diff-capable command disables external diff and text conversion. File lists use NUL delimiters; display escaping never changes the actual Git path.
- Independent request versions protect project/list, selected commit/comparison and file previews. Stale results and errors are ignored, including switch-away/switch-back and repeated requests in one project.
- No polling or watchers. Project changes load automatically; use Refresh for filesystem/branch changes in the same directory. The controls and diff areas scroll independently, and pagination/file selection resets the corresponding scroll list.

Limits: 1,000 file entries; 12,000-character commit message; 500-character history subject; 200-character author; diff previews up to 200,000 characters, 1,500 lines and 2,000 source characters per line. Truncation is labeled. Herdr exec has an 8 MiB output limit: incomplete or near-limit output is rejected rather than shown as complete. Untracked text reads are limited by Herdr to 1 MiB. Each Git query times out at 20 seconds. Already-started processes cannot be cancelled by this host API, but no further query or UI update is accepted after invalidation. Git errors and transport/timeouts remain visible.

## Commands for the integrating agent

After the main agent installs and shows the mod, send commands to shown copies only:

```powershell
herdr-app do hcconfig-git.history
herdr-app do hcconfig-git.next
herdr-app do hcconfig-git.previous
herdr-app do hcconfig-git.select-first
herdr-app do hcconfig-git.worktree
herdr-app do hcconfig-git.select-file-first
herdr-app do hcconfig-git.compare
herdr-app do hcconfig-git.endpoint
herdr-app do hcconfig-git.merge-base
herdr-app do hcconfig-git.run-compare
herdr-app do hcconfig-git.refresh
```

`select-first` selects the first commit in History (and previews its first file), or the first file in other modes. `endpoint` / `merge-base` immediately compare the current native ref-input values when Compare is active. `refresh` reloads the repository and current mode, resets the page and clears selection; Compare then requires another compare command. `focus` is also supported for Herdr pane navigation. Wait for loading to finish between dependent commands.

## Verified / not verified

2026-11-15: 12 regression groups passed, with 78 read-only Git calls. The real source mod and all three populated native-check fixtures passed. Coverage includes empty/unborn repos, Unicode/space/literal paths, root and merge patches, paging, invalid refs, unrelated histories, staged/unstaged/untracked content, binary handling, linked worktrees, NUL parsing, output limits, stale requests, simulated controller transitions and unchanged index bytes/mtime. Newline/tab filename parsing is synthetic on Windows. Remote routing is simulated, not an actual remote-machine test.

Actual UI acceptance belongs to the main agent. Check the `hcconfig` layout at 480 px and 320 px, both themes, real InputState typing, history paging/selection, scrolling, empty repos, project/worktree switching during loading, staged/unstaged previews, compare modes and repeated refreshes. Native `check` verifies eager controls, not layout/paint, real keyboard/mouse interaction, deferred rows or eventual async states. No actual UI acceptance is claimed here.

Stable candidate SHA-256:

| File | SHA-256 |
| --- | --- |
| `main.js` | `10C7196A7D469DB05A4342C9126987C3642740D2BC3EA44C82993E12805F8684` |
| `git.js` | `9D7D75855F00A562A7572C8E354A69E9CED3C506241DD945347101256CA3BD29` |
| `mod.json` | `8DED8A3A0CFF0E5348D95B12D363FDBDFEA201DD66F37107C289852048F9191D` |
