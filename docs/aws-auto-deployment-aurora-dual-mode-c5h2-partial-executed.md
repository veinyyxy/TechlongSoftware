# C5h2 实际部分交付：基础设施通过，provision HTTP500，未 ready

2026-10-15 America/Winnipeg。用户明确确认新manifest `1db32e27374d79128ae5f56b0c1c606678088e94dd7e329efe1ea4106eac16a2` 后，唯一一次Run使用原未消费固定根执行；没有再次Run或新建绕过槽。旧r1本地guard拒绝记录保留。

## 结果与准确时间

- Source observer预检槽：20:24:28.943 UTC / 15:24:28.943 CDT；首次Aurora只读检查通过。
- 根入场：20:25:07.618 UTC / 15:25:07.618 CDT，在20:25:27.139 UTC入场截止前完成；之后不以新日期续期。
- 首次Neon认领：20:25:09.637 UTC；准确epoch1安装及激活通过。
- 新workload栈创建回执：20:25:12.080 UTC。七资源、完整模板/参数及UUID检查通过后才进入DNS。
- DNS创建提交：20:27:15.170 UTC，收到准确ChangeId，等待INSYNC完成后进入bootstrap。
- 第二次Aurora只读检查通过：20:27:55.062 UTC；随后接纳既有schema为verified，没有restore/seed/migration。
- provision槽：20:27:57.475 UTC；真实访问日志20:27:58.502 UTC记录一次 `POST /api/saas/provision` HTTP500。
- Run结果：`REQUIRES_INDEPENDENT_INSPECT_NO_RETRY`，phase=`provision_once`；没有进入verifying、initialized/effective configuration核验或atomic_ready。

不能把栈成功或bootstrap成功称为完整初始化成功。程序结束后不重发POST，不重读私密来源，不追加Aurora连接，也不自动清除job/lease或补写ready。

## 独立只读事实

统一Inspect新进程在Neon读到准确一行，因非ready而以 `LIVE_READY_PLATFORM_NOT_PROVED` 停止。之后只读核验现有准确资源，不伪造ready输入绕过validator：

| 范围 | 实际状态 |
| --- | --- |
| 新workload栈 | `techlong-sandbox-tenant-9c5ee9e64509dcad`；UUID `863828e0-c8d6-11f1-bd9d-06fff5ad0437`；七资源全部CREATE_COMPLETE；角色、tags保持 |
| ECS | desired1/running1/pending0；task definition `tenant-9c5ee9e64509dcad-task-definition:1`；实际RUNNING任务digest匹配旧已批准镜像 |
| 镜像/Secret引用 | app `sha256:5e42b2de7e0cc81b1c83a8abb21c866eeedc8801ddf50e686d116a5837caa004`；准确五项固定版本引用，无Secret值读取 |
| 网络 | 准确target健康、3000端口；`first-acceptance.sandbox.techlong.cloud` A alias匹配既有ALB |
| DDB | Source独立身份通过；准确legacy epoch1/revision1完整记录通过，aurora-v2 namespace仍缺失 |
| Neon | deployment `dep_7c99bd249470184852f0dc74`=`configuring`；instance=`pending`；job `job_202c8dc12a8bf379f3a7c693`=`running`，attempt1/max1，lease未清除 |
| Neon资源/operation | generation1、原stable identity、准确owner/deployment、lifecycle=`verified`、epoch1/intent=provision/state=active |
| ready证据 | observation/delivery-plan/stackId最终outputs仍null；未写ready，不声称initialized或业务回滚已独立核实 |

20:33:11.126 UTC独立provider结果为 `INFRASTRUCTURE_VERIFIED_APPLICATION_INITIALIZATION_NOT_PROVED`。诊断脚本只有3次显式SDK只读+9条CLI（包括一次20秒窗口日志分类），0写/0Aurora/0私密读取/0应用调用。日志只在内存分类；结果保存HTTP500、`INVALID_STORE_CONTEXT`及已知stack frame布尔值，不打印或保存原始日志、请求体、JWT、密码等。

## 500的确定原因与代码修复

已发布服务端栈：`saveStoreName → readStoreProfile → readSystemConfigRows → requireStoreId`，`system_config_service.js:135`抛出 `INVALID_STORE_CONTEXT` / `Store context is invalid`。

本次原固定店铺ID是 `add89a8c-f43e-81b9-8287-0cb6c5c54f87`（version nibble=8）；旧店铺配置validator只接受v1–v5。因此existing store可被PostgreSQL读取，却在随后读取店铺profile时被拒绝。不是AWS/IAM/Neon权限问题，无需因此增权或换数据库。UUIDv8由[RFC9562 §5.8](https://www.rfc-editor.org/rfc/rfc9562.html#section-5.8)定义；本次不改变已有UUID或生成算法。

服务端 `provisionInstance` 的catch会尝试ROLLBACK，但这只是代码路径，加上500日志仍不等于独立数据库已回滚证明；本轮两次批准Source只读观察都发生在POST之前，不能拿它们证明POST之后的状态。后续恢复必须先取得新的只读应用/SQL证据。

服务端修复提交：`10fe3c41b97941f5c7755bdcd9f43aee2d5a0ea2`，已推送origin/main。

- 仅`requireStoreId`使用独立v1–v8 store UUID格式/variant校验；原asset-ID校验策略不变。
- 不改业务ID/数据/表结构/IAM/Secret/当前task definition或镜像，不扩大租户/店铺作用域。
- 两项新增回归在改代码前准确复现同一`INVALID_STORE_CONTEXT`；改后验证实际固定v8 ID、标准版本/格式边界，以及`saveStoreName`实际helper的三次查询参数均绑定同一store。
- 33项相邻回归、types、build通过。完整311项测试在沙盒内308通过/3项localhost fetch失败；允许本地回环后同源码311/311通过，不改测试以绕过失败。
- 推送触发既有无AWS凭据的CI和候选镜像构建；没有dispatch ECR发布工作流，没有更新线上服务。服务端`.vscode/settings.json`保留。

真实GitHub云验证已完成：

- [Backend CI 38803364335](https://github.com/veinyyxy/SpeedFeast_Backend_main/actions/runs/38803364335)：check `116657831061`、docker `116657830734` 均success。
- [候选构建 38803364109](https://github.com/veinyyxy/SpeedFeast_Backend_main/actions/runs/38803364109)：app `116657830679`、lifecycle `116657831073` 均success，包含现有自检/兼容性/安全扫描步骤，source为准确修复提交10fe3c4…，没有AWS凭据/OIDC/发布。
- checked-app artifact `12005571375`，72,642,387 bytes，GitHub artifact digest `sha256:d6de76c8501e3eee67254cccc075f7bbed8f3eb515dc33e342721b4bba65f248`，到2026-10-16 20:37:51 UTC。
- checked-lifecycle artifact `12004808747`，85,260,693 bytes，artifact digest `sha256:793e4906618cffe5d1827c2bc0772f665e33cf15fbaba2a3257927f008b6ab24`，到2026-10-16 20:37:43 UTC。
- 两项OS scan artifact也存在、未过期。这里只读核对GitHub run/jobs/artifact元数据，未下载私密材料或镜像包；**artifact ZIP digest不是ECR registry digest**。后续发布必须下载核验准确候选/内层receipts并使用fresh审批，不把候选成功等同线上修复。

## 副作用/永久槽/费用

已发生：Source云写3次（DDB条件事务、CFN CreateStack、DNS CREATE），Neon写入8个事务阶段（首次认领、激活、五次状态变更、schema接纳）；原私密loader1次、operator固定runtime Secret值1次、provision POST1次HTTP500。Source Aurora readonly observer2连接、每次12条正常SQL，全部通过；这不把应用自身运行时数据库连接算作Source observer连接。

固定journal仍为 `F:/ChatGPT_workshop/techlong-express-c5h-first-delivery-v1`，17个永久槽及2个ack保留。`status_verifying`、`atomic_ready`未消费，但不能用这些剩余槽/剩余次数推导新的写许可。禁止重跑原Run、用新SHA绕过根、自动补齐或复位。

child `ExpiresAt=2026-10-15T22:10:27.000Z / 17:10:27 CDT`不是自动TTL执行器；旧父标签也保持。网络、数据库和新Fargate任务仍可能继续收费。50USD/月为目标而非硬cap；原两小时标准参考基础约0.425USD另加变量费用，常驻Fargate+网络参考52.85USD/月尚不含DB。没有自动停费/回滚/删除；暂停或清理需另行具体审批，不能删除现有库、Secret或旧记录来“修复”失败。

## 唯一继续点：窄恢复，不重做基础设施

1. 修复提交的GitHub云端候选镜像自检已通过；不安装本地Docker、不先发布或改线上镜像。准确候选的短期保留截止见上方，过期不偷换source或自动重建/发布。
2. 为准确修复镜像的单次ECR发布、既有栈/服务窄更新准备fresh SHA和具体范围，沿用立即撤权及既有边界；无理由新增AWS权限或重建Cell/数据库。
3. 新的只读应用/SQL核验必须先确定POST之后的实际初始化状态、原owner/epoch/idempotency/lease和资源身份。若已提交，不能再POST；若未提交，新的单次恢复POST仍须独立明确审批。
4. 后续恢复另设经过批准的窄入口，不重跑17个旧槽；最终initialized/effective configuration及当前真实image/健康/DNS都通过后，才能受审完成平台原子ready/job结束。

F3c9/Grant/restore/seed等支线保持封存。当前不是完整自动部署成功，也不是可以无人值守重试的执行器。

[非秘密执行/诊断证据摘要](../ops/aws-sandbox/reviews/aurora-dual-mode-c5h2-live-delivery.partial-executed.json)。原清单、固定风险文件和所有失败/本次运行目录均保留，不回填改写旧批准。
