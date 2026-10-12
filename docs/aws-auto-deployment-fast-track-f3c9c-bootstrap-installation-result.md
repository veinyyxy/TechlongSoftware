# F3c9c：锁定控制面安装完成，独立核验通过

2026-10-12 Winnipeg。用户批准清单 `0cb547a6016a508ff5903fb99f804b6cb341147e273e262e1a7a43ef3362676c` 及完整风险后，在有效窗口内运行原六写安装器一次。**四个指定对象已存在并独立核验为 LOCKED；自动部署仍未启用。** 没有新增执行权限、调用函数、登记 parent、连接 Neon 或创建付费 Cell。50 USD/月仍是目标，不是费用硬上限。

## 实际结果

| 对象 | 独立双回读结果 |
| --- | --- |
| `TechlongSandboxCellLifecycleCoordinatorBoundaryV4` | 默认 v1，准确全 Action/Resource 显式 Deny |
| `TechlongSandboxCellLifecycleCoordinatorRoleV3` | 准确 boundary、Lambda-only trust，inline/attached policy 均空；RoleId `AROAV3GNMXTZBYYFRN63O` |
| `/aws/lambda/techlong-sandbox-cell-lifecycle-coordinator-v3` | 准确标签，7天保留 |
| `techlong-sandbox-cell-lifecycle-coordinator-v3` | 准确候选 ZIP，Node22/x86_64、120秒/256MB、Active/Successful，无 Layer/应用环境变量/VPC；reserved concurrency 0 |

独立读取完成于 **2026-10-12 22:54:39.017 UTC / Winnipeg 17:54:39.017**，两次完整读取稳定，18项检查均 true。函数 RevisionId `7817b5a5-c53c-4df5-a2a7-e1385fc1d89c` 与首次原检查一致。parent、六 workflow、旧登记排除及新 registration-attempt 槽仍全 ABSENT，Cell 名称查询 ABSENT。这里只证明本次锁定安装，不证明完整权限的有效 Allow-path 或运行时就绪。

## 原安装器非零退出与表示差异

原安装器记录了 **6次写调用尝试**，随后返回 `BOOTSTRAP_WRITE_UNCERTAIN_INDEPENDENT_INSPECT_ONLY`；没有把该回执改写成成功。原独立 Inspect 中全拒绝/空权限/并发0/保留7天均通过，仅函数聚合检查失败。

实际固定 `$LATEST` GetFunctionConfiguration 返回准确 `FunctionArn` 加 `:$LATEST`，而原检查要求未限定 ARN。新增只读核验器只接受准确未限定 ARN 或准确 `:$LATEST`，并同时要求准确 FunctionName/Version；不接受 alias、数字版本、其他账户/区域/名称。实际无 Layer 返回 `null`，因此新核验器只将 undefined/null/空数组视为无 Layer，拒绝非空 Layer 或不合法形态。

仅新增只读 helper、独立核验 CLI 与4项针对性测试；**原批准63文件、安装器、候选 bundle/ZIP/lock 均保持字节绑定不变**。没有重跑安装器、补写、撤权、删除、回滚或重置槽位。第一次新增核验器因 null Layer 检查未完成的记录也保留；修正后只在新的私有目录进行读取。

## 证据绑定与不可重放继续位置

- 原批准63代码 SHA：`3fbde58c8f9a60a85f3174a3c36d1ab33e93da5b52100c124093892706757d34`。
- 新独立核验65文件 SHA：`ae57d6dc8a1326a4a59383273f5c94c1834bf38087f3d11579198df52e5e94ad`。
- 候选 ZIP SHA：`405e6654b9c8ca0c80536f5fcf8caa910e00246ce497c2dedc81c9f63f3be35f`；CodeSha256 `QF5mVLnIygyAU29fz4yqkQ4AJGzkl8Le3IHJ9j87418=`。
- 原执行失败摘要：`F:/ChatGPT_workshop/techlong-f3c9c-bootstrap-20261012-r3-run/bootstrap-failure.json`，SHA `40110cff9347b0158c7c17998c91b623348a755819431117418711f2e8385ab6`。
- 原独立 Inspect：`F:/ChatGPT_workshop/techlong-f3c9c-bootstrap-20261012-r3-independent-inspect/bootstrap-review.json`，SHA `58999cd73bbde25ad48dad48e44db3dc53b07fa893d4d993d14744a4c9674aee`。
- 首次新增核验器检查未完成记录：`F:/ChatGPT_workshop/techlong-f3c9c-bootstrap-20261012-r3-qualified-independent-inspect/independent-locked-inspect.json`，SHA `4663fc460ee0b08b11445bdc4c8595147c0a4a30738ee9723c000fb0518e0568`。
- 最终独立核验：`F:/ChatGPT_workshop/techlong-f3c9c-bootstrap-20261012-r3-qualified-independent-inspect-r2/independent-locked-inspect.json`，SHA `9cfbfb40af9984f3e6359bb13528acd8fdda0fc821d9a3b54b65ee141081c45a`，结果 `LOCKED_BOOTSTRAP_INDEPENDENTLY_VERIFIED`。
- 永久本地槽 `F:/ChatGPT_workshop/techlong-f3c9c-control-bootstrap.permanent-slot.json` 已于22:44:43.515 UTC消费，SHA `cb39a024782c106028340b590b013dc77495eb97b8785ee1e2106f5466ba8754`；禁止删除、换目录、复位或再运行 Run。

16项针对性与Source登记/六写相邻测试通过，typecheck、定向 lint 0 warning 和 CLI syntax 通过。本次总 AWS 写尝试6、额外核验写0、Invoke0、Secret值读取0、Neon连接/写0。日志 storedBytes0仅为当时观测，不等于账单为零。本仓公开摘要只含非秘密资源标识、状态和证据 SHA。

## 下一切片，另按实际变更范围审批

1. 准备并刷新 Neon 失败保护 schema 与现有受限角色窄 grants 的准确安装清单；当前锁定安装授权不含数据库写入。此前PG18只读取证是历史前态，不能冒充安装后真实验收。
2. 在锁定期修正运行时 installation reader 同样的 `$LATEST` ARN/null Layer 表示问题，完成固定 gate-capable 入口和 async age60/retry0 配置，冻结最终包。**当前运行时 reader 未修改，不能使用本次只读 acceptance 冒充 runtime proof。** 函数代码/配置更新需要另批。
3. 最终包及数据库保护就绪后再 fresh 审批 RESERVED、准确 ARN 的最终 IAM/table窗口、Source parent登记及实际 allow/deny gate；gate通过前不 ARMED/PAID，不创建付费 Cell。

Source身份有效只用于本次读取；今后仍按即时有效身份、fresh SHA和前态核对执行。不重做镜像、旧 generation 探针或本次已经完成的六写。
