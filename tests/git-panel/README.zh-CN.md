# Git 面板验证

[English](README.md)

## 运行

需要 Windows PowerShell 7、Git、Node.js 22+ 和 Herdr。在仓库根目录执行：

```powershell
pwsh -NoProfile -File tests/git-panel/Test-GitPanel.ps1
# Node 未加入 PATH 时：
pwsh -NoProfile -File tests/git-panel/Test-GitPanel.ps1 -Node '<node.exe 的绝对路径>'
```

脚本先执行真实 Git 与模拟宿主控制器回归，再检查源 mod 以及历史、工作区、比较三种有数据的原生状态。Windows GUI 入口必须等待进程退出后读取返回码；脚本已处理。所有测试仓库、合成提交、linked worktree 和原生检查目录均位于本测试目录内，结束时校验路径后清理，不提交源仓库、不部署、不切换布局。check 自动生成的 `gpui-kit.d.ts`、`jsconfig.json` 不属于实现文件。

## Unreleased：行为与限制

- 跟随当前终端的目录与机器，面板取得焦点时保留项目上下文；显示工作树根目录、分支或 detached HEAD。
- 历史每页 30 条，以已加载的 HEAD 为分页快照。消息关键词为不区分大小写的字面匹配；文件过滤为仓库相对文件/目录，不解释通配符。输入框 Enter 或 Apply 才应用。
- 选提交查看说明、文件与逐文件 diff。根提交相对空树；merge 明示 first-parent。重命名显示为删除与新增。
- 工作区分暂存、未暂存、未跟踪和冲突；同一文件可同时列于暂存、未暂存。未跟踪使用宿主文本读取，不提供写操作。
- endpoint 为 A→B，merge-base 为唯一共同祖先→B；无共同祖先或多个共同祖先明确报错。ref 先安全解析为提交 ID。
- Git 使用参数数组、字面路径；禁止外部 diff/textconv，不刷新索引、不使用 fsmonitor。文件列表以 NUL 解析，显示转义不修改实际路径。
- 列表、提交/比较、文件预览各自维护请求版本，并核对当前项目；过期结果及错误不更新界面。无轮询或 watcher，切换项目自动加载，原目录内文件或分支变化使用 Refresh。
- 最多 1,000 个文件条目、12,000 字符提交说明、500 字符历史标题、200 字符作者。diff 上限 200,000 字符、1,500 行、每行 2,000 原始字符，明确标记截断。宿主 Git 输出上限 8 MiB，接近上限或记录不完整时拒绝显示不完整结果；未跟踪文本读取上限 1 MiB；每条 Git 命令 20 秒超时。宿主不能取消已启动进程，但过期后不继续查询、不接受结果。

## 交互验证入口

部署与展示由主 agent 完成后，可发送 `herdr-app do hcconfig-git.<command>`。命令包括 `history`、`worktree`、`compare`、`refresh`、`next`、`previous`、`select-first`、`select-file-first`、`endpoint`、`merge-base`、`run-compare`、`focus`；仅到达当前展示副本。

History 下 `select-first` 选择首条提交并自动预览首个文件，其余模式选择首个文件。Compare 下 `endpoint`/`merge-base` 使用当前原生输入框值立即比较。Refresh 重读仓库、回到第一页并清空选择；Compare 需要重新发起比较。依赖前一步结果的命令应等待加载完成。

## 已验证与未验证

2026-11-15：12 组回归通过，执行 78 次只读 Git 查询；源 mod 及三种有数据状态的原生 check 均通过。包含空仓库/未出生分支、中文空格与字面路径、根提交/merge、分页、失效 ref/无共同祖先、工作区三类预览、二进制、linked worktree、NUL/截断、过期请求、模拟控制器切换、index 字节及 mtime 保持。Windows 下换行/tab 文件名使用解析模拟；远端路由仅模拟，未连接真实远端。

真实 UI 由主 agent 验收：480/320 px 宽度、浅深主题、原生输入、历史分页与选择、滚动、空仓库、加载中切换项目/工作树、暂存/未暂存内容、两种比较与连续刷新。check 不代表实际布局、绘制、键鼠交互、延迟渲染行或异步终态通过。初始实现 SHA-256 见英文说明，属于历史记录；后续侧栏更新已给 main.js 添加 Hide 按钮。
