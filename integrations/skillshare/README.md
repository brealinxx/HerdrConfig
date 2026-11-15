# Optional skillshare integration

[English](README.md) | [简体中文](README.zh-CN.md)

[skillshare](https://github.com/runkids/skillshare) can synchronize shared skills and supported agent resources across AI tools. HerdrConfig is an independent repository; it neither forks nor bundles skillshare.

Use skillshare for resource distribution; use HerdrConfig for team roles, task handoffs, stage checks, and Herdr UI. Keep a single source of truth for each resource. An agent definition synchronized by skillshare is not automatically an `hc` launch template.

1. Install and initialize skillshare separately using its [official documentation](https://skillshare.runkids.cc/).
2. Select resources and destinations for the AI tools you actually use. Do not overwrite project `AGENTS.md` or native credentials with generic rules.
3. Preview native changes with the corresponding `--dry-run` command before synchronizing. Do not assume every resource kind is supported by every agent.
4. Optionally add the [standalone Herdr panel](https://skillshare.runkids.cc/docs/learn/with-herdr/) to a personal layout. Inspect its recipe/files first; it executes skillshare and contacts GitHub for update checks. Its source-repository controls manage resource synchronization, while `hcconfig-git` inspects the selected code project.

This repository does not install skillshare, change its sources, or run synchronization automatically. No skillshare end-to-end validation has been performed. Refer to the installed version's help for its current schema and supported targets.
