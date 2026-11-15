# 可选的 skillshare 集成

[English](README.md) | [简体中文](README.zh-CN.md)

[skillshare](https://github.com/runkids/skillshare) 可在不同 AI 工具之间同步共享技能及受支持的 agent 资源。HerdrConfig 是独立仓库，不 fork 或内置 skillshare。

skillshare 负责资源分发；HerdrConfig 负责角色、交接、阶段检查与 Herdr 界面。每种资源应保留唯一维护源。skillshare 同步的 agent 定义不自动等同于 `hc` 启动模板。

1. 按[官方文档](https://skillshare.runkids.cc/)单独安装并初始化 skillshare。
2. 为实际使用的 AI 工具选择资源和目标目录。不要用通用规则覆盖项目 `AGENTS.md` 或凭据。
3. 使用相应命令的 `--dry-run` 预览同步。不同工具支持的资源类型可能不同。
4. 可选安装[独立 Herdr 面板](https://skillshare.runkids.cc/docs/learn/with-herdr/)，先阅读 recipe 与源码；该面板会执行 skillshare，并访问 GitHub 检查更新。它的 Source 面板负责资源仓库同步，`hcconfig-git` 则查看当前业务项目。

本仓库不会自动安装 skillshare、修改其资源源目录或执行同步。尚未进行 skillshare 端到端验证；配置结构和支持范围以安装版本的帮助为准。
