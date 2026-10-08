# F3b3：独立 Executor v2 代码与候选包完成，未安装

2026-10-08 Winnipeg。本切片针对前次真实 IAM 核验发现的 Janitor 双重附加 Deny，完成独立执行身份的代码接线、真实候选 ZIP 构建及新角色只读存在性核验。没有更改旧 Janitor role/boundary/attached policy/PLAN_ONLY函数、安装权限、写数据库、上传或调用 Lambda、创建付费 Cell。F3b3/F3 整体仍未完成。

## 已完成的精确接线

- 旧 `inspect/execute/recoverSharedCellCleanupDeletion` 仍为 schema1、仅接受准确 Janitor assumed-role session，旧事件/计划/日志语义不变。
- 新 `createDedicatedCellTtlDeletionProtocolV2` 只接受 `TechlongSandboxCellTtlExecutorRole` 的准确 account/role/session；所有 double-read、立即删除边界和独立缺失回读都使用同一固定身份。没有任意role参数、环境变量角色开关或重写STS结果。
- 新 schema2 删除计划绑定 `executorIdentityProtocol=dedicated-cell-ttl-v2` 和完整 executor role ARN，SHA与旧计划隔离。CF `RoleARN` 仍是准确 `TechlongSandboxCellCloudFormationExecutionRole`，不是caller role；DeleteStack仍需准确live Stack ARN与单次稳定token。
- 新prepared root/SDK journal接受独立v2事件，intent/receipt与DDB item schema均为2，仍以准确plan SHA使用永久 `cell-cleanup-intent:` / `cell-cleanup-receipt:` 键、conditional append-only写和强一致回读。CAS赢家最多一次删除，失响应/重启只能恢复；旧版本记录拒绝而不改写。
- 新 `cell-ttl-executor-v2.ts` 在事件和准确函数context通过后才接凭据；单独固定新角色的Secret入口只读取既定readonly Secret/DB角色。旧Secret API不能通过cast传入新role来放宽；不注入drain、job producer或authority writer。

现有严格 schema2 ownership source完全未改。部署旧规划记录的环境仍被 activeTenant=1/nonterminalDeployment=1阻挡；新身份协议**不是**隔离登记或新schema3 ownership的放行。

## 构建与真实只读证据

新构建命令只产出独立executor，不重建drain或app/lifecycle镜像：

```powershell
node ops/aws-sandbox/scripts/build-cell-cleanup-artifacts.mjs --out F:/ChatGPT_workshop/techlong-f3b3-executor-v2-20261008-a1 --dedicated-executor-v2
```

私有artifact-review SHA `ba1d328eb650f33e35eef239c7a8dfe7442efe963d7e74bee7c52d3b48d02331`。ZIP SHA `201775955cc3b80bdbabf89b84a163c174442c81f3a0f2ea48429d4333f5f23c`、365126 bytes；bundle SHA `79f8ffb4b7aabdaa25bbc50bcd02806b4bf3a844780cc39585a05afda880b106`。nodejs22.x/x86_64/index.handler，ZIP仅一个index.js，非builtin依赖全部打包。双次构建/ZIP可复现、解包SHA和无凭据无依赖启动/无效事件拒绝通过；这是本机Node22验证，**不是Linux/AWS Lambda在线proof**。原F3b2 a5两个ZIP及报告保留，drain仍引用原SHA，不用新caller identity安装旧executor包。

新增只读collector `-DedicatedExecutorRoleOnly` 模式只读Source STS和准确新role。2026-10-08T14:03:45Z真实返回NoSuchEntity/ABSENT，证据 `F:/ChatGPT_workshop/techlong-f3b3-control-executor-v2-20261008-a1/executor-role-inventory.json` SHA `e5390a8bf836a46d3e265040d74e258fa30c11118419cd947863c1e4ef16e5a5`。未创建role、未读取Secret值。未来安装仍需当时fresh prestate，不能把这份历史ABSENT视为长期未占用保证。

143项清理/隔离相邻回归（含原35项TTL与新增6项v2、原PLAN_ONLY/SDK/authority/source/admission/coordinator和6项legacy审阅）、typecheck、定向lint、JS/PowerShell语法及production build通过。首轮新增测试两处夹具错误：向strict root多传signal、把身份切换设在inspect完成之后；修正夹具后全部通过，未放松生产校验，也未因测试失败发生云调用。

## 隔离协议候选，不是新迁移

`ops/aws-sandbox/reviews/f3b3-sealed-plan-protocol.candidate.json` 将前次设计收敛为具体契约：准确原行/plan bytes/hash、登记批准和保护schema checksum；append-only登记及原deployment永久freeze；对jobs、owner/created resources、capacity、schedules、steps的全部未来引用围栏。实例/订阅不冻结；同一实例的未来新deployment必须重新进入ownership集合。登记与引用writer必须串行化，不允许check-then-insert竞态。

候选source schema3须包含完整密封证书、实际guard/schema证明、admission fence和五类集合的hash；非终结deployment仅能排除精确密封原记录，activeTenant仅能分类“没有任何未密封deployment”的旧规划实例。其余资源/容量/调度集合不做过滤。证书缺失、原文漂移、保护未安装/被禁用或新live部署必须失败关闭或恢复非零集合。旧schema2及当前两个deletion入口不自动接受该新envelope。

本切片只准备契约，没有DDL、migration注册、登记executor或schema3 ownership adapter。设计hash和artifact SHA均不是安装/登记/删除许可。范围草案 `ops/aws-sandbox/reviews/f3b3-dedicated-executor.prepared.json` 的所有创建、数据库和runtime授权仍false；它补充历史兼容性审阅，不改写旧证据。

## 下一小阶段

1. 准备未注册的密封隔离schema/永久引用guard候选及版本化ownership证明，保留原记录和业务状态；不能直接改environment_id、禁用原trigger或简单过滤plan_only。真实Neon安装和准确单行登记仍各按fresh具体清单批准。
2. 整理专属role/trust/identity policy/boundary、准确Secret与最小DB权限、日志/函数/调用/期限/费用的安装材料，绑定新ZIP和fresh云prestate；不拆旧Janitor策略、不放宽共享ServiceRoleBoundary。新增权限/实际云安装仍单独批准。
3. 补独立authority writer/调度以及真实Cell TTL/failure/lease/cleanup证明；Cell/authority不存在时不生成伪运行删除SHA，默认Worker和Scheduler不启用。50USD/月仍为目标而非硬上限，旧10USD云Budget未静默更新。

服务端本轮仅同步此继续位置，生产source19cc与已发布双镜像不变、不重放已消费发布slot。两个main直接提交推送，无新分支。
