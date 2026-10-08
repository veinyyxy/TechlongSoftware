# F3b3：独立 NOLOGIN 控制角色安装入口（准备阶段记录）

更新：用户已批准原SHA 4ef39a...；两NOLOGIN角色/GRANT单次提交及两次独立只读回读完成，role-install slot已永久消费，禁止再Run/刷新重放。下文保留准备时的清单和未批准状态作为历史，不是当前执行指令。[实际安装证据与下一阶段](./aws-auto-deployment-fast-track-f3b3-neon-control-roles-installed.md)。

2026-10-08 Winnipeg。接续已完成的密封登记与 v3 durable executor；本小阶段先交付数据库角色/GRANT 的可执行审阅入口，密码、LOGIN、两个 Secret、IAM、Lambda 和 authority 保持后续独立批次。**本阶段尚未获准安装，Neon/AWS 写入与默认运行时启用均未执行。**

## 准确变更范围

固定 SQL `ops/aws-sandbox/sql-candidates/f3b3-control-db-role-grants.sql`，LF SHA `7fc82e392d1745b4e7031a1449d094cd2b327cfaccb459f768e917a4754df016`，不是自动 migration：

- 创建 `techlong_cell_cleanup_reader` 和 `techlong_cell_drain` 两个 NOLOGIN/NOINHERIT/非管理员角色，reader 默认只读。
- reader：public USAGE、八张控制表 SELECT；drain：public USAGE、四表 SELECT、环境 admission 七列 UPDATE、jobs 十一列 INSERT、deployment/resource 的 updated_at 列 UPDATE 以允许必要行锁。无表级写、DELETE/TRUNCATE/DDL、owner membership 或新增函数 EXECUTE 授权。
- **这些权限不是单行/单环境限制。** drain 可以修改其被授权列上的其他未受原 guard 阻断的行（包括 timestamp），并插入新队列行；本次安装只授予能力，不执行这些业务写操作。原密封计划仍受 Always guard 保护。
- PostgreSQL 非 superuser CREATEROLE 创建角色时，自动给创建者 ADMIN=true、INHERIT=false、SET=false 的成员资格；本审阅把此隐式变化明确纳入 scope，并严格回读，不另授 SET/INHERIT 或 owner role。这不是“绝对没有 membership 变化”。[官方角色属性说明](https://www.postgresql.org/docs/18/role-attributes.html)
- 只在准确 Neon 目标、原完整证书 canonical pin `dc093614188a8f0a086b4fc6a7e251c43312495a60db2efffc654cf3d48b066f`、原业务字节和保护目录一致时允许提交；不设置密码、激活 LOGIN、创建 Secret、修改 AWS 或启用 Worker/Scheduler。
- 接受最多约30秒的事务与短暂控制表写锁（lock_timeout 5s）。提交后不自动 down/revoke/drop，固定本地槽位一旦占用永久保留，不复位、不重试。回读不明时不把安装成功当成已证明。

## 入口与恢复

`lib/deployments/execution/sealed-control-role-management-v1.ts` 与 `ops/aws-sandbox/scripts/review-f3b3-control-roles.mjs` 为新独立协议 `sealed-control-role-installation-v1`；旧 schema/install/register 工具和已消费槽位完全不改。

Review 使用真实只读 Serializable Deferrable 会话，核对原封存证书/原业务、角色/别名不存在、管理者 CREATEROLE/非super、createrole_self_grant 为空，并绑定目标/code/依赖锁/固定SQL、全权限目录与业务 state hash。manifest 有效一小时；本轮未取得执行批准。

Run 要求准确批准 SHA，锁住固定十五张控制表、重新完整读 prestate，只有匹配才能一次性 mkdir `F:/ChatGPT_workshop/techlong-f3b3-control-roles-v1-consumed` 并保存已批准清单。耗时或槽位证据保存失败后不写SQL。单事务一次执行固定SQL，完整验证后仅一次 COMMIT。无 `IF NOT EXISTS`、目录重建/清空、GRANT 重放、自动 down 或提交重试。

角色回读不仅看显式 ACL：核对全部非系统 schema、有效表权限、有效列权限、role flags/settings、入/出 membership、grant option、sequence/owner/nontrigger SECURITY DEFINER 执行能力，防止 PUBLIC/default/列写使角色越权。除允许的两个新 grantee ACL，所有关系/列/schema ACL、默认 ACL、函数定义/ACL、原业务与 guard 目录必须保持。SQL 固定无函数授权；原 PUBLIC 的普通 invoker 函数 EXECUTE 不被本次 revoke，不能声称所有函数一概不可执行。

任何 COMMIT 响应丢失都标为 unknown，随后新连接独立只读 Verify；已过期批准也可用于历史完整性回读，不能用于再写。槽位存在时 Review/Run 都拒绝，只可 Verify。若角色不完整/越权或旧状态变化，保存观察结果并停止，不自动补齐或清除。

```powershell
node --experimental-strip-types --env-file=.env.local ops/aws-sandbox/scripts/review-f3b3-control-roles.mjs `
  --mode Review --out F:/ChatGPT_workshop/techlong-f3b3-control-roles-NEW-review
```

最终 fresh 只读清单位于 `F:/ChatGPT_workshop/techlong-f3b3-control-roles-20261008-b5/review-manifest.json`：

- manifest canonical SHA **`4ef39a5995c8a0d394e1cbb72b2c3e51d8588bd86e8b75e3d6287ba138171cac`**；文件 SHA `551c2c95e1d762ff9a0f73d4c28590c8d1b4dbb7106f20eac89c265db5688a1b`。
- reviewedAt 2026-10-08 20:55:47.776 UTC；expiresAt **2026-10-08 21:55:47.776 UTC / Winnipeg 16:55:47.776 CDT**。
- code/依赖 binding SHA `03a91abcef1d08dd23fb174130962f4489a98a9625fbec87608654825b8ed93f`，target fingerprint `06e1188c19fe0c8552bd398f192d7489ccae48498216fcd532344d07720cadab`。
- prestate SHA `88976909aabd2fad28bc0a749179074395867d3a469524cefc8df202cf6aa55b`；preserved SHA `993506a66f586d9ad447b77769769cbf372dee9be9a30cc556af9d9de00426fa`。角色数0、seal完整，安装slot不存在。

**尚未批准/执行。** b2旧草案05c3...保留，但代码binding已改变，不能执行；过期仅再只读Review新目录/新SHA供重新确认，不能复位或重放占用slot。密码/URL/原业务 preimage 仅保存在有界私有目录，不提交Git。

确认上述scope后唯一下一提交命令（当前不要自行当已批准执行）：

```powershell
node --experimental-strip-types --env-file=.env.local ops/aws-sandbox/scripts/review-f3b3-control-roles.mjs `
  --mode Run --out F:/ChatGPT_workshop/techlong-f3b3-control-roles-20261008-b5-run `
  --manifest F:/ChatGPT_workshop/techlong-f3b3-control-roles-20261008-b5/review-manifest.json `
  --approved-sha 4ef39a5995c8a0d394e1cbb72b2c3e51d8588bd86e8b75e3d6287ba138171cac
```

Run已自带独立新连接回读；若结果unknown/非零，或需要另一次独立验证，只用相同manifest、全新输出目录的 `--mode Verify`，不带approved-sha、不再Run。此批只用Neon管理连接，无AWS/MFA步骤；无需为此批刷新AWS身份。

## 本轮只读现状与验证

Neon只读 capability `F:/ChatGPT_workshop/techlong-f3b3-control-db-20261008-b1/control-db-capabilities.json` SHA `9162683bd528642a5380d5eecc5b941ea1ca39ee60072e4cfe4d6ba66d7a533b`：准确原 seal 完整，四个角色/历史别名均不存在，管理者有 CREATEROLE、非super，PUBLIC 可执行非trigger definer为0。

AWS只读库存 `F:/ChatGPT_workshop/techlong-f3b3-v3-resource-read-20261008-b1/resource-inventory.json` SHA `3ae555939f39d9fe604d768dda0ea86e228e814f2afe171f6234e30ad6706b3c`：Source准确IAM user且当前会话有效，新两IAM角色、两Secret、新v3 Lambda均ABSENT。现有authority表ACTIVE/PAY_PER_REQUEST；容量字段0不代表禁止请求或零费用。未GetSecretValue/写AWS，50USD/月预算目标不变。

57项定向检查（含新角色入口12项）、typecheck、定向lint、JS/PowerShell语法与production build通过。新入口覆盖错误/过期批准和代码/目标/SQL漂移、seal/业务/catalog漂移、有效越权、slot耗时/失败、SQL失败、COMMIT失响应独立恢复和占用状态拒绝，以及输入快照/安全SQLSTATE/序列查询的对象类型保护。

首次真实PG18运行 [37841109020](https://github.com/veinyyxy/TechlongSoftware/actions/runs/37841109020)、head `83660c2f3c677108574a04f58506de6309170529` 在角色安装阶段断言失败，不能当安装成功；两CI自有数据库均drop、service停止，artifact SHA `c70d85fc43a1e3746f36ba3608d71cb1f234d4f1b17e4a32b087ca1a8ead5545`，失败目录 `F:/ChatGPT_workshop/techlong-f3b3-pg18-ci-20261008-b1-failed` 保留。补充仅含fixture角色/安全receipt的诊断；不得用未通过的实际提交路径生成可执行批准。

诊断轮 [37841586355](https://github.com/veinyyxy/TechlongSoftware/actions/runs/37841586355)/head98adae0、[37842111813](https://github.com/veinyyxy/TechlongSoftware/actions/runs/37842111813)/head63f22a9 均在提交前回滚；第三轮准确定位 POSTSTATE_READ / SQLSTATE_42809。权限谓词不能依赖 WHERE 的筛选顺序，现用 CASE 确保序列权限函数只消费序列对象，固定授予SQL和权限范围未扩大。b2/b3失败archive SHA分别 `93e34e1efc143b34e59cfbd4aca5dcc4f9ad0b787ff9a9a23e2b920fdb00ae8c`、`6a03c0be4b47cc75b5914ca4f0f0311b5f34283270e457b4290990ec8f33284a`。

[37842472579](https://github.com/veinyyxy/TechlongSoftware/actions/runs/37842472579)/heada964943 的CI自有库已完成角色提交、故意丢失COMMIT响应、独立完整回读和旧批准不重放；之后越权负测试夹具漏设search_path，被原严格上下文门禁拒绝，整体仍failure。修订只补夹具transaction-local pg_catalog，不放宽产品验证。archive SHA `3faa4e8656c93fd38e3606252aac362a61181c2a3bcb1d800c27b76990e6b387`。四个失败目录和原始artifact全部保留，每轮两自有DB均drop、service停止；没有任何Neon/AWS写入。

最终 [37842882331](https://github.com/veinyyxy/TechlongSoftware/actions/runs/37842882331)/head `8c5080e2e8d9c7ba56afabd0e17b8e07fd90977e`、attempt1 **success**，26组唯一证明；除前23组，真实PG18非super CREATEROLE管理者验证本协议：准确NOLOGIN/有效权限/原seal保持、丢失COMMIT后独立回读、错误批准/已占用状态不重放、额外列级UPDATE被精确门禁拒绝。与生产不同，CI测试完会清除本fixture的权限/role，以便同容器另一自有DB继续原角色测试；这些清除SQL只存在CI fixture，生产入口不包含它们。

两CI自有DB drop、容器stop、准确image/head/attempt/26proof/role SQL hash/平台artifact digest均已由新reader `-RequireControlRoleProof` 独立核验。私有 `F:/ChatGPT_workshop/techlong-f3b3-pg18-ci-20261008-b5`：archive SHA `3c5ef884186fe986c5ed825cf1539b520c886c89cfee327a305042efb1b7c113`；report SHA `f3530bf2277b5a7205a46483a0990b0999339bf2724731700d2db52c78bba350`；receipt SHA `93b70feee819c02ab281bf3cb5edb471fde5fc794a6d57b12b0f06adaa4cec51`；独立verification SHA `d47e14f4955360e4959664706d7d148bca826314ef873bb54628dc249534213c`。AWS/DDB/删除证明仍mock；本PG验收不意味着云运行时已安装或删除已验证。

## 后续边界

当前只交付第一批 NOLOGIN 权限入口，不把“开始下一步”当 DB 或 AWS 新权限批准。等待 fresh SHA 4ef39a... 的具体确认，才单次安装并独立回读；接着集中准备 LOGIN/随机凭据/两Secret 的准确范围，再是固定新IAM/boundary/Lambda/authority。实际 Cell、ECS、baseline/DNS/mTLS/自动部署闭环尚未验收，旧记录/角色/PLAN_ONLY/包/镜像和全部历史slot保留。
