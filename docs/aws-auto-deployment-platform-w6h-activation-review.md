# W6h：精确兼容、一个窄凭据与 App 发布材料

2026-10-20。沿最短主线推进，不再做身份探针或重装W6f。本步实现可受审的一次凭据安装入口，并准备两份App工作流的未挂ref Git对象和trust-only模板差异；**当前尚未安装凭据、LOGIN、发布工作流或修改IAM/trust**。

## 收缩后的实际范围

首轮平台仍在本机，整套平台AWS上线是最后阶段。因此本次只拟创建一个数据库Secret，复用既有NOLOGIN角色；App私钥继续保留在已保护的本机文件，不复制到AWS、不在本步读取。不开新IAM角色，不部署Cell/ECS，不开平台/publisher运行开关。

拟安装清单仅包含：

1. 在ca-central-1空创建 `techlong/sandbox/platform-controller/neon-v6`，只有标签和描述，**创建时不带SecretString**。
2. 在该准确ARN安装Source-only显式Deny资源策略并回读，防止旧任务角色对`techlong/sandbox/*`的宽读取Allow获取新凭据。仅Source用户 `arn:aws:iam::402010193138:user/techlong-sandbox-dev` 例外；策略不向它新增Allow，仍需既有身份权限。其它身份的数据读取、值/策略/版本阶段/标签/删除/轮换/复制管理均拒绝。
3. 默认AWS-managed `aws/secretsmanager` KMS；内存随机生成48字节、64字符base64url密码，写入专用角色DSN，准确版本 `3574f24e-ecb3-476c-8f71-baa501fd129e`。不使用owner密码作为服务密码，不记录密码/DSN或私密材料摘要。
4. 唯一原子SQL事务，仅对OID180224的既有 `techlong_deployment_controller_v6` 设置该密码及LOGIN；角色其它禁用flag和7项窄函数授权不变。含5秒lock/20秒statement超时、advisory事务锁及准确OID/NOLOGIN/flags检查。
5. 同进程回读确认目录/权限仅LOGIN从false变true，并用新专用凭据建立一次TLS READ ONLY连接核对身份和空控制账本；再独立新进程读取该准确Secret固定版本一次，单独TLS认证及只读核验。Inspect不改资源。

最多3次Secrets Manager持久写（CreateEmpty/PutResourcePolicy/PutSecretValue）和1次owner SQL批次；不新增数据库角色/schema/表/函数、不改旧业务数据或触发器、不读取App key、不签JWT/mint token/dispatch，不改已有IAM identity policy或worker trust。本清单**不授权App工作流发布材料**。

## 27项精确兼容，而非全局放宽

沿用W6g快照 `ba28793914eae30cb2cd1dc3a9d8cd5ce61553250f68ddf6edd3d2cd93f2d5d2`：27项public、owner16392、零SQL参数、PL/pgSQL、SECURITY INVOKER、返回trigger。配置仅为null或准确`search_path=pg_catalog`，每一项OID/名称/owner/参数/语言/返回类型/config/函数体SHA均逐项相同才允许进入待审清单。其它角色成员资格、表/列/sequence权限、CREATE、grant option或foreign server能力必须仍为空。

默认严格审计仍拒绝这些额外可执行函数；新兼容器只返回“可供单独审批”，不是自动接受。安装时只有新完整manifest SHA获批并在首写前fresh重读完全相同，才将这组精确兼容作为该次LOGIN范围的一部分接受。新增、少项、替换OID、改definer/config/函数体或其它权限漂移一律停止，不自动修改允许列表、REVOKE或改旧业务对象。

保留既有PUBLIC TEMP能力。[PostgreSQL的trigger函数规范](https://www.postgresql.org/docs/18/plpgsql-trigger.html)要求trigger返回类型和特殊调用上下文；普通SQL调用限制及自有临时表上挂trigger、invoker不取得owner权限的行为将由临时PG实测。实测不能代替对27个真实函数和provider/system能力的审查，也不消除资源消耗/错误侧信道或以后并发修改风险。

## 已准备的 App 发布材料，与本次凭据安装分开

Prepare在仓库外新目录使用独立Git index，生成两个未挂ref提交：新的 `cloud-worker-platform-job-v6.yml` reusable和 `cloud-worker-platform-v6.yml` caller。只写不可达Git对象，不创建本地分支、移动main、写工作树workflow或推送。

复用已经通过CI及真实App proof的冻结云源码 `ca2b38d8c756dd8fb800a88ded596c93687f278f`、81文件闭包828491ec…和proof1465a605…；不重新冻结/发布云逻辑。reusable不嵌自身未来SHA，先得到真实R，再生成固定R的caller。材料中还提供现有foundation的trust-only副本，仅将actor14145707改为344813947、旧job_workflow_ref改为新R路径；其余claims/资源/permissions/boundary逐字结构不变。旧个人worker将不再符合新trust，这是未来发布须明确接受的影响。

实际发布需要新的资源范围和SHA批准，严格核对准确Change Set ARN与两项trust差异后才执行；本步没有对应AWS/远端写入口。GitHub workflow ID必须在真正发布后只读解析，不猜ID。平台/publisher绑定仍UNPUBLISHED；未来publisher编译绑定固定release/R与冻结云源码，caller main SHA由每份fresh审批计划/intent冻结，避免把当前Git SHA编译进自身的自指问题。此修正不允许环境变量开启入口。

## 执行和恢复边界

`ops/platform-activation-v6/local.mjs`：Inventory/Prepare只读远端元数据；Prepare还写本机不可达Git对象。最终clean main准确无AWS CI通过后，生成仓库外48小时新manifest；本次包含真实LOGIN能力，未沿用旧NOLOGIN安装的7天窗口。展示完整年月日、America/Winnipeg及UTC，不是几分钟即过期。

```powershell
node --experimental-strip-types ops/platform-activation-v6/local.mjs --mode Prepare --ci-run <准确成功CI> --output F:/ChatGPT_workshop/techlong-w6h-activation-20261020-a
```

精确SHA获得确认后才允许：

```powershell
node --experimental-strip-types ops/platform-activation-v6/local.mjs --mode Install --manifest F:/ChatGPT_workshop/techlong-w6h-activation-20261020-a/manifest.json --approved-sha <准确SHA> --output F:/ChatGPT_workshop/techlong-w6h-activation-20261020-a-run
```

新永久槽 `F:/ChatGPT_workshop/techlong-w6h-controller-credentials.intent.json` 在首写前占用。准备时名称必须准确缺席，不猜其它名字或覆盖。执行前fresh源/CI/Source身份、Secret缺席、KMS、worker身份和Neon目录逐项相同；preflight限2分钟，活动执行限20分钟，SQL前最后目录事实窗口30秒。SDK maxAttempts=1；可自动刷新既有AWS Login，但不自动登录/MFA或保证刷新成功。

成功/失败/ACK不明都不重跑Install；独立进程：

```powershell
node --experimental-strip-types ops/platform-activation-v6/local.mjs --mode Inspect --manifest F:/ChatGPT_workshop/techlong-w6h-activation-20261020-a/manifest.json --output F:/ChatGPT_workshop/techlong-w6h-activation-20261020-a-inspect
```

Inspect绑定原manifest/原槽，允许过期后只读检查；只有准确受保护固定版本和LOGIN目录均成立时才一次读取该专用数据库Secret值并进行只读认证。部分状态/漂移/传播失败只报告，不自动down、关闭LOGIN、删除、补齐、改版本、复位或重试。旧W6f及其它全部槽/记录保留。

Secret值读取前另占永久只读能力槽 `F:/ChatGPT_workshop/techlong-w6h-controller-credentials-inspect.intent.json`。一经消费，不因Get响应不明、连接失败或换输出目录就自动再读；没有“反复Inspect直到成功”的私密读取授权。仅未进入值读取的元数据检查不消费此槽。

## 完整风险与费用

- 新持久凭据让该角色能够远程认证并使用既有7项控制函数及精确兼容的PUBLIC触发器/TEMP能力。角色不能直接发布计划/证明或读写业务表，不等于没有控制账本写能力。函数中的admin ID/SHA不是人的签名，仍依赖可信平台会话和受审运行绑定；本步不会开启平台。
- owner只在本机受审入口内存使用，属于高权限连接；固定代码不是provider侧的owner ACL。随机密码必须经SQL及Secret API传输，可能进入数据库/provider/网络终端日志或内存，不能保证完全擦除或脱离提供者可见性；不在聊天、仓库或本地回执输出值。
- AWS Secret和Neon不是同一事务。失败可能留空/已收费Secret、已写有效密码或已LOGIN角色；密码改变后不会自动撤销，不能用旧批准再尝试。Create空对象和安装策略之间没有值，但已有宽身份/管理员仍可并发操作资源；Source或更高权限可修改/移除策略，不能宣称所有AWS主体都已穷举隔离。
- metadata、文件、GitHub、AWS IAM与数据库不是跨服务CAS；角色ID检查和事务锁也不能阻止不配合的并发操作者。策略/KMS/Neon认证可能传播延迟，首次认证失败不会自动重试。Source凭据失效可能在部分安装后阻断后续步骤；需要人工按新范围处理。
- 更长批准期并不延长AWS凭据寿命。任何代码/main/目录/权限漂移会使原manifest拒绝，不能仅因尚未到期而跳过fresh检查；永久槽不复位，提交后不自动down或删除。
- 一个新增Secret按[AWS官方当前示例价格](https://aws.amazon.com/secrets-manager/pricing/)约0.40 USD/月，另加API调用（示例为0.05 USD/一万次），实际以ca-central-1账单/税费/用量为准；没有升级plan或新增客户KMS Key。50 USD/月是总预算目标，不是本步/既有AWS资源费用的硬上限，已有Cell等收费没有停止。

只读盘点已确认目标Secret缺席、默认Key为AWS-managed、Source与既有worker角色身份符合、27项快照匹配且仍NOLOGIN。早期三次只读盘点因兼容器过严拒绝固定pg_catalog配置而停止，空输出目录保留；修正后只读盘点成功，未产生任何写入或占槽。这不是生产LOGIN已验证的证明。
