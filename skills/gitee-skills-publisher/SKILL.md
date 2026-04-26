---
name: gitee-skills-publisher
description: 将当前设备本地的 workspace/skills 全量发布到 Gitee 仓库。用于“上传技能到 Gitee”“同步本地 skills 到 Gitee”“发布当前 skills 版本”“把本机 skills 推到远端仓库”等场景。仅在主编辑设备使用。
---

# Gitee Skills Publisher

把当前设备上的 `workspace/skills` 作为唯一源，发布到 Gitee 仓库。

## 默认行为

- 源目录：`%USERPROFILE%\.openclaw\workspace\skills`
- 默认仓库：`https://gitee.com/chen-zhuoxiao/openclaw-skills.git`
- 默认分支：`master`
- 运行方式：克隆远端仓库到临时目录 → 用本地 `skills/` 覆盖仓库中的 `skills/` → `git add/commit/push`

## 发布规则

- 这是**主设备专用** skill；其他设备不要用它上传。
- 发布的是整个 `skills/` 目录，不按技能名单写死。
- 默认排除运行时/缓存内容：
  - `node_modules`
  - `.git`
  - `state`
  - `__pycache__`
  - `dist`
  - `tmp-*`
  - `debug-*`
- 不要手写零散上传逻辑；只走正式脚本。

## 前置条件

- 设备已安装 `git`
- 当前用户对 Gitee 仓库有 push 权限
- 该设备已配置好 git 凭据（HTTPS 凭据管理或 SSH）

## 正式入口

```powershell
powershell -ExecutionPolicy Bypass -File ${SKILL_DIR}/scripts/publish-skills-to-gitee.ps1
```

常用参数：

```powershell
powershell -ExecutionPolicy Bypass -File ${SKILL_DIR}/scripts/publish-skills-to-gitee.ps1 -DryRun
powershell -ExecutionPolicy Bypass -File ${SKILL_DIR}/scripts/publish-skills-to-gitee.ps1 -Branch master
powershell -ExecutionPolicy Bypass -File ${SKILL_DIR}/scripts/publish-skills-to-gitee.ps1 -CommitMessage "update skills"
```

## 说明

- `-DryRun`：只打印计划，不克隆、不提交、不推送
- `-CommitMessage`：自定义提交信息
- `-RepoUrl` / `-Branch` / `-SourcePath`：仅在特殊场景覆盖默认值

## 成功输出

脚本会输出：
- 源目录
- 仓库地址
- 临时工作目录
- 是否检测到变更
- commit hash（若有）
- push 结果

## 失败处理

如果失败，优先检查：
- git 是否安装
- Gitee 凭据是否有效
- 分支名是否正确
- 远端仓库是否存在
