# HerdrConfig 开发约定

默认使用中文。此仓库是个人配置源，独立于 Herdr、skillshare 和业务项目。

- 开工读取 git status 与相关 diff，保留既有改动；日常分支 dev。
- 维护角色职责、启动适配和项目规则的边界。项目自己的 AGENTS.md 与用户授权必须纳入任务，不可用通用模板放宽限制。
- PM 统筹；Planner 计划；Executor 实现；Reviewer 独立审查；Version Controller 管理 Git。允许 PM 明确分派独立子 agent，禁止递归扩张；并行写入必须有互斥文件范围或 worktree。
- 不覆盖 Herdr 官方 AGENTS.md、类型声明、内置 mods/layouts，不覆盖用户未知配置。个人 mod 使用 hcconfig- 前缀。
- 启动 agent 使用交互模式，首条任务作为原生独立参数随 hc run 提交；如果返回 first_message 则检查 sent。参数送达不代表已通过登录/信任或完成任务，必须读状态与结果。Windows 不依赖需要 sh 的 hc 命令模板。Codex 必须 --no-daemon；不得加入跳过审批/沙箱参数。
- Git 浏览功能只读：不用 shell 拼接命令，不执行外部 diff/textconv，处理中文/空格/换行路径、空仓库、worktree、失效引用与过大输出；异步结果须关联项目和请求版本。
- 配置/安装需支持预览和回滚。运行记录、凭据、机器路径、日志不提交。不能读取或修改其他项目的真实任务数据来做测试。
- 验证：pwsh -NoProfile -File tests/Test-Workflow.ps1；每个 mod 运行 herdr-app check，并实际查看窗口。区分模拟、真实启动和真实 UI 验证。
- README 和 CHANGELOG 记录行为及限制，未发布使用 Unreleased。
