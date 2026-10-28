---
kind: upgrade-guide
description: 随 Harness 不变式注册表移除废弃的 @yejiming/dsh-data-agent/invariant 入口。
---

# 移除不变式配套插件

## 变更

Harness 已移除运行时不变式注册表。可选的 `@yejiming/dsh-data-agent/invariant` 入口及对应 SDK 依赖随之移除；普通 Host 和客户端入口保留注册与释放行为。

## 迁移

1. 从 `cordis.yml` 和 profile 补丁移除 `@yejiming/dsh-data-agent/invariant` 行，并删除对该子路径的导入。
2. 加载普通 `@yejiming/dsh-data-agent` bundle，确认 Data Agent 连接面板可以打开并列出已有连接。已有连接设置和工作区文件不需要迁移。
