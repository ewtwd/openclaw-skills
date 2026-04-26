---
name: gitee-skills-installer
description: 从 Gitee 仓库下载最新的 workspace/skills，先备份本地旧版，再整体覆盖本地 skills，并自动恢复依赖。用于“从 Gitee 更新 skills”“下载远端 skills 覆盖本地”“同步技能到本机”“备份后替换 skills”等场景。适用于其他设备。
---

# Gitee Skills Installer

从 Gitee 下载最新 skills，备份旧版后整体覆盖本地 `workspace/skills`。

## 默认行为

- 目标目录：`%USERPROFILE%\.openclaw\workspace\skills`
- 备份目录：`%USERPROFILE%\.openclaw\workspace\skills-backups`
- 默认下载仓库：`https://gitee.com/chen-zhuoxiao/openclaw-skills/repository/archive/master.zip`
- 覆盖方式：备份旧版 → 删除旧版 `skills` → 用远端 `skills` 全量替换

## 规则

- 不关心 `skills/` 里具体有哪些技能；按整个目录处理。
- 下载后会自动扫描所有 skill 子目录：
  - 有 `package-lock.json` → `npm ci`
  - 没有 lock 但有 `package.json` → `npm install`
- 这是“其他设备更新技能”的正式入口。

## 正式入口

```powershell
powershell -ExecutionPolicy Bypass -File ${SKILL_DIR}/scripts/update-skills-from-gitee.ps1
```

常用参数：

```powershell
powershell -ExecutionPolicy Bypass -File ${SKILL_DIR}/scripts/update-skills-from-gitee.ps1 -DryRun
powershell -ExecutionPolicy Bypass -File ${SKILL_DIR}/scripts/update-skills-from-gitee.ps1 -KeepBackup
powershell -ExecutionPolicy Bypass -File ${SKILL_DIR}/scripts/update-skills-from-gitee.ps1 -ZipUrl "https://gitee.com/.../repository/archive/master.zip"
```

## 前置条件

- 设备可访问 Gitee
- 建议已安装 `node` / `npm`（用于自动恢复依赖）
- 本地 OpenClaw 已有 `workspace` 目录

## 输出内容

脚本会输出：
- 目标目录
- 备份目录
- 下载地址
- 实际备份位置
- 依赖安装结果
- 更新成功 / 失败

## 失败处理

如果失败，优先检查：
- Gitee 是否可访问
- zip 链接是否有效
- 本地磁盘空间
- `node` / `npm` 是否存在

备份不会自动删除；失败时可手动从备份目录恢复旧版 skills。
