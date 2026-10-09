# F3b3：只读 IAM 基础已安装，运行时实机读取尚未证明

2026-10-08 Winnipeg。用户明确批准清单 `748999ae1ebb298670243d1dae36cf29accb75046daaab981f136534f77764aa` 后，在原有效期内只执行一次 IAM Run，共六次写调用成功；两次独立只读 Inspect 均返回 `FOUR_READONLY_IAM_RESOURCES_AND_INLINE_POLICIES_VERIFIED`，`iamFoundationReady=true`、`runtimeEnabled=false`。本次完成的是 IAM 基础安装，不是自动部署或运行时权限验收。

## 实际创建与回读

| 执行角色 / RoleId | 专属 boundary（v1） | inline policy |
| --- | --- | --- |
| TechlongSandboxCellTtlExecutorRole / AROAV3GNMXTZLB4NZQLZY | TechlongSandboxCellTtlExecutorBoundaryV3 | RuntimeReadOnlyV3 |
| TechlongSandboxCellDrainCoordinatorRole / AROAV3GNMXTZPRETOTXTS | TechlongSandboxCellDrainCoordinatorBoundaryV1 | RuntimeReadOnlyV1 |

两 boundary、两 role、两 inline 的响应均确认；两次回读均准确匹配清单的策略文档、信任、boundary、标签、角色属性及策略集合，RoleId 与创建响应一致。Source 为账户 402010193138 的 `arn:aws:iam::402010193138:user/techlong-sandbox-dev`。没有追加其他权限、修改旧 Janitor/PLAN_ONLY 对象，或在成功后撤掉本次明确批准保留的基础权限。

两次核验的观察起点分别为 **2026-10-09 01:17:32.615 / 01:17:47.584 UTC**（Winnipeg 2026-10-08 20:17:32.615 / 20:17:47.584）；第二次为独立新进程。完整前置状态 SHA 仍为 `191a3784ff04d436c94ee165ffc1b1e2816db7d2c974236ed1ad8e8c6b8d1802`，未观察到漂移：两个目标函数、Cell Stack 和两 authority key 仍 ABSENT；两现有 Secret 元数据及唯一初始 AWSCURRENT 版本保持。此阶段没有读取 Secret 值或连接 Neon，不能将历史凭据证明冒充新数据库观察。

## 证据与不可重放边界

- 原清单文件 SHA：`9c77ac5c1da3df18a7d4f912fb5f457ef6e1ac1781b1862e1edbacaf53ec8cb3`；五文件代码绑定 `91a6dd3fa15abd018838ad5a3777cb436716eaa842c761a454574c29fb6e93c8` 未改。
- 私有提交回执：`F:/ChatGPT_workshop/techlong-f3b3-readonly-iam-20261008-d5-run/submission-receipt.json`，文件 SHA `03be3aa61ab85588a089305c6a045a66f77f038f908189acc20d12ee94c36d6f`。
- 第一次独立 Inspect 文件 SHA：`3d6f57198f69b5f32fe058d7342c36c90dfa1f299945161ba4dbfb5088fe3a3c`，同一目录 `independent-inspect.json`。
- 新进程 Inspect：`F:/ChatGPT_workshop/techlong-f3b3-readonly-iam-20261008-d5-verify/independent-inspect.json`，文件 SHA `f75357bdac331b97ff7ab319603e5c8bf61a82a5ccae559b2283372a651580bb`。
- 两次完整只读 inventory 文件 SHA：`ea9a0f4b5fa9b6b27533751e083af641da0c1f2196b1211bd559bb24077f7b8a` / `fb5f96c0314d7a71109d4c64d3e9aa30393bbcb98f0441cdc6ecac831f2a7cfd`。

永久槽位 `F:/ChatGPT_workshop/techlong-f3b3-readonly-runtime-iam-v1-consumed` 已消费；原清单和全部 attempt/confirmed 记录保留。禁止再次 Run、自动删除、补齐、复位或重试。IAM 跨 API 非原子、RoleId 检查不是服务端 CAS 的已接受风险仍存在；两次观察不能排除观察之后的并发外部修改。

## 下一步：准确 Lambda / 日志只读实机范围

原模拟中 24 个预期拒绝符合、8 个预期允许未证明的结论不因安装而变绿。来源函数围栏完整保留，**真实 Lambda 的读取允许路径仍未证明**，未通过实机门禁不得为本角色追加删除或 authority 写权限。

下一阶段准备两个准确函数、日志组、只读探针及调用的资源/费用/代码清单；先核对环境加密等非业务调用，以及 drain 与密封 v3 的兼容接线。实际创建、调用或策略修正都须新 SHA 单独批准，不自动进入云部署。Cell/provision 前驱和真实到期 draining/zero/raw witness 尚不存在，不能安装假 authority。

本次 **Lambda 部署/调用=0、Secret/Neon/authority 写=0、付费 Cell/ECS 创建=0**，没有创建日志组或启用调度/默认 Worker；50 USD/月仍是目标，不是费用硬上限。两个 main 仅提交脱敏执行证据和进度文档，历史准备记录不改写为已经执行。准确已批准权限和既有验证缺口见 [原 IAM 安装清单](./aws-auto-deployment-fast-track-f3b3-readonly-runtime-iam.md)。
