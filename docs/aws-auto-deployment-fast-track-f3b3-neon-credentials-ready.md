# F3b3：两个现有 Secret 的 Neon 控制凭据已恢复并真实核验

2026-10-08 Winnipeg。用户明确批准恢复清单 `3610895cfb3b42e14929302105c4beb127c26bf74f42deb32734bf9d86e4918a` 后，在原有效窗口内只执行一次 Run。两个既有角色各一次原密码+LOGIN，通过认证 TLS 提交；**COMMIT已确认**。随后两次独立只读 Inspect 均确认两角色 LOGIN、准确现有 Secret 版本和真实受限认证，`credentialReady=true`。**仅控制凭据就绪，不是 AWS 自动部署或 runtime 已上线。**

## 实际执行与范围

执行时平台 main `340b49daa2887b814924f9fe1733e6c7958b8141`；新11文件 binding `a32860e83ce9cda1595497d90f9be6e022136c1f7388e9b5f3bd843b143bc630`，原9文件 binding `3ec561f34c95cf2f80e6ba8a6cebf5572c26d5eeeac28f598d00593960b084c0` 未变。批准 manifest 文件 SHA `44abaedf0dc06b8dd5bfc97e97b5d2eea281b550f1a56d0498e5bc3db3001d00`，截止2026-10-09 00:35:05.741UTC；本轮执行和两次回读均在截止前。

运行前重新核对原失败回执、旧消费槽位、原审批和准确目标 fingerprint；Source 每份 Secret 读前用同份凭据核对准确 IAM User/account。真实 DB 的两 NOLOGIN/完整权限/证书/业务状态、PG18.6/forward_ddl=on/password_encryption=scram-sha-256，以及两 Secret准确ARN/唯一初始UUID/AWSCURRENT/原标签/无rotation、replica、resource policy/严格载荷均通过。

只在一个 Serializable 本地事务中、原15表短暂锁下，设置以下既有角色密码及LOGIN：

- `techlong_cell_cleanup_reader`：原八表 SELECT、默认只读、无列写。
- `techlong_cell_drain`：原四表 SELECT及准确20项列权限保持；不是行过滤或纯读角色。

没有新增 GRANT、角色或IAM，没有修改 Secret 值/版本/标签，没有 Create/Put/Update/Delete Secret，也没有 Neon API、关闭 forward_ddl、自动补偿、SQL重发或槽位复位。没有新 Lambda/Cell/ECS/包/authority/runtime安装。原 schema/registration/roles/credential bootstrap 等历史记录全部保留。

## 独立观察与准确 Secret

两次独立 Inspect 都使用新管理连接和各角色真实新认证连接，认证查询为 Serializable READ ONLY Deferrable；读取准确 Secret ARN+UUID+AWSCURRENT，完整版本枚举包括 deprecated、无分页残留，载荷绑定原完整证书。

- reader：`arn:aws:secretsmanager:ca-central-1:402010193138:secret:techlong/sandbox/cell-cleanup-readonly-v3-AWZoLG`，VersionId `3f8047d4-e357-4d32-ae87-861fda5f8253`；authenticated=true。
- drain：`arn:aws:secretsmanager:ca-central-1:402010193138:secret:techlong/sandbox/cell-drain-control-QDFwQ9`，VersionId `72eb93b3-1da0-40a2-a5a1-176e6869ae98`；authenticated=true。

两次均 LOGIN=[true,true]、完整 roleState SHA **`6ec32bd06b5f4323602bd77d37533922ca24182e9382d51f657496fbd52075ed`**。只把LOGIN归一为false后的完整状态仍匹配原NOLOGIN SHA `1528e1e2888bb191200d8bc2224318512cfa63f5aaa138eb324870674f3fe0ef`，原权限/角色属性/成员关系未放宽。preserved SHA仍 **`993506a66f586d9ad447b77769769cbf372dee9be9a30cc556af9d9de00426fa`**，原seal、完整证书和业务原件/其余权限保持。两份readback不同观察时间但状态SHA一致。

私有运行目录 `F:/ChatGPT_workshop/techlong-f3b3-neon-credential-recovery-20261008-r1-run`：

- submission 文件 SHA `5d8dedfef5b07704e312cb490661b34a21c0373ac053c82d3427ccac0c6c2cf2`，outcome `NEON_RECOVERY_COMMITTED_REQUIRES_INDEPENDENT_INSPECT`，alterAttempts=2、commitAttempted/Confirmed=true、secretWrites=0、failure=null、retryAuthorized/runtimeEnabled=false。
- Run内独立Inspect：observation **2026-10-09 00:15:46.139UTC / 2026-10-08 19:15:46.139CDT**；文件SHA `1458ec56f74c29a9e2ccdea9933845b1d6241d93558adce2cccf7c850f469f42`。

另一个进程只运行 `--mode Inspect`，私有目录 `F:/ChatGPT_workshop/techlong-f3b3-neon-credential-recovery-20261008-r1-verify`：observation **00:16:19.641UTC / 19:16:19.641CDT**；文件SHA `9537b004ce68a4751d16ad93df570e0e02281cffe8623dc7d5a7d90df56c021f`。两次均 `TWO_CONTROL_CREDENTIALS_LOGIN_AND_OWN_SECRET_VERSIONS_VERIFIED`，credentialReady=true、secretValuesPersisted=false。

新固定槽位 `F:/ChatGPT_workshop/techlong-f3b3-control-credentials-neon-recovery-v1-consumed` 已永久占用，保存approved-manifest（文件SHA仍44abaedf...）及不含秘密的login-attempt元数据。禁止再Run、复位槽位、改密码或另建恢复版本；后续仅可独立Inspect。原bootstrap失败槽位不被这次成功“重新授权”。

## 证明边界与继续位置

本次是实际Neon托管提交及现有Secret密码认证证明，超出之前仅普通PG18的32组CI证明；仍不能补回原失败的SQLSTATE或唯一证明当时根因。原密码经TLS进入服务端SQL/托管同步，用户接受的服务端/提供者日志风险仍存在；本地程序未保存密码/URL/SQL/verifier，不能保证外部日志不存在或JS字符串可靠清零。

50USD/月目标与两个现有收费Secret继续保持，未增加Secret数量，不保证费用绝对为零或预算为硬上限。当前只完成凭据门禁，没有安装控制面新AWS权限或启用付费Cell。

下一阶段准备准确现有Secret ARN引用的新IAM/boundary/Lambda及authority安装清单，真实云写各按fresh SHA确认。旧Janitor deny、旧PLAN_ONLY、镜像及历史计划不动，默认Worker/Scheduler仍关闭；不要把本次批准扩大为runtime、DeleteStack或真实租户部署批准。服务端仅同步文档，两个main按默认Git授权提交/推送。

[保留的恢复准备与32组PG18证明](./aws-auto-deployment-fast-track-f3b3-neon-credential-recovery.md)、[原部分失败证据](./aws-auto-deployment-fast-track-f3b3-control-credentials-partial.md)。
