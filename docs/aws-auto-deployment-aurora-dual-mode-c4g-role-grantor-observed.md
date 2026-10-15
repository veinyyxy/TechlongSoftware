# D002 C4g：实际授予者差异已确认，提交前回滚

2026-10-14 America/Winnipeg。用户确认[C4g新独立槽、原八SQL及有限证据/完整风险](./aws-auto-deployment-aurora-dual-mode-c4g-application-evidence-review.md)后，按SHA `9a72074b2dd90358bdd9a05a9abdb52609636027e38f68c04fe8d2cbd1eb6270` 执行唯一Run，立即独立Inspect。**本次未激活：八语句收到响应，但冻结角色分类器拒绝，COMMIT未提交、ROLLBACK获响应；独立核验确认仍为原closed/NOLOGIN状态，未尝试应用登录。** 这次新证据已能定位具体角色拒绝谓词，不再只有通用错误。

## 本次直接证实的原因

19:15:47.753 CDT / UTC2026-10-15 00:15:47.753，写后实际应用角色OID16456记录的唯一parent为：

`{name:rds_iam, oid:16389, grantor:rdsadmin, admin:false, inherit:false, set:false}`。

冻结V6分类器要求同一membership的grantor为`postgres`。实际记录是`rdsadmin`，因而返回 `AURORA_APP_V6_CANDIDATE_REJECTED` / `ROLE_CLASSIFIER`。其余记录属性均符合原active约束：LOGIN=true、NOINHERIT、无superuser/create-db/create-role/replication/bypass-rls、无配置/所有权/子成员、其它可CONNECT库0，connection-limit=-1、valid-until/config为null。

本地从已保存的脱敏字段恢复完整角色校验输入，冻结分类器对实际值拒绝；只在**未发送到数据库的假想副本**中把grantor改成旧期望postgres，分类器即通过。该单字段对比可复现这次角色拒绝，未修改实际grantor、权限、membership或数据库，没有额外SQL/AWS调用。**这是校验器的授予者假设与实际Aurora元数据不兼容，不是证明应用需要ADMIN/INHERIT/SET或更宽权限。**

C4f采用相同SQL及谓词，其失败与此解释相符，但C4f缺失写后原件，不能倒填为历史直接证明；唯一确定的直接实机原因属于本次C4g。

## 同事务观测、回滚及独立状态

安装槽于19:15:22.928 CDT / UTC00:15:22.928消费。写前closed角色、四库ACL/完整原目录/九seed及业务count0通过。八语句全部收到响应，写后十个快照框架已保存；截至19:15:48.757 CDT的停止回执明确：

- permissionWriteCalls/permissionResponsesObserved=8；COMMIT submitted/acknowledged均false。
- rollbackAttempted/rollbackAcknowledged均true，ROLLBACK仅一次，无重试。
- validationStage=ROLE_CLASSIFIER、validationCode=AURORA_APP_V6_CANDIDATE_REJECTED；postgresSqlState=null。

已捕获的public USAGE grantor为pg_database_owner；73表DML及7序列USAGE的80组应用ACL向量均为postgres授予、无grant option、无其它对象应用ACL，原九seed/业务count0亦匹配。这些本地向量/count核验不代表写后完整目录投影校验已经执行：**角色拒绝先发生，原完整catalog verifier没有到达。** 实际写后目录digest `ad213560c608cc678d838e1789f9e90d33eff77062febe90a4f8881881299bc9`仅是保存的整体摘要，不冒充原non-app pin已通过。

C3g历史catalog文件是脱敏诊断inventory，不含完整原始定义；本地尝试将其作为原catalog重建时摘要不匹配。没有把脱敏inventory当原始目录、更改原结构pin或制造“写后完整校验通过”。后续精确修正后仍必须在实际事务内执行全部原目录/ACL/行数核验，不能因已识别grantor差异而跳过。

核验槽于19:16:13.685 CDT消费，唯一独立Inspect于19:16:16.632 CDT保存 `ORIGINAL_CLOSED_STATE_OBSERVED_INSTALL_NOT_PROVED`：app仍NOLOGIN/零parents/members/无提升；其它可CONNECT库0；四库ACL digest `0251a30e18af71c2bd73a3880eadda1d00845fcbaf619c599cac88b5b2323d87`、完整原目录 `93d3c7eb62bbdd3e38f0a3943c9d44d607b419d562fcbd73ebd2fccf319e876b`及九seed/业务count0保持。Inspect的COMMIT仅结束READ ONLY事务，不是安装提交；应用连接/token签发/登录均0。

| 模式 | AWS/CLI只读元数据 | SQL连接/query | 权限/LOGIN调用 | 实际结果 |
| --- | --- | --- | --- | --- |
| Run | 26 | 1 / 21 | 8，响应8 | 写后角色拒绝；COMMIT未提交，ROLLBACK成功 |
| 独立Inspect | 26 | 1 / 8 | 0 | 原closed/NOLOGIN确认，未进入应用登录 |

两次IAM/固定Secret/Express17.9/FREE ACTIVE事实保持，C4e默认v4/保留v3及持久IAM能力不撤销。没有IAM/Secret/AWS、业务/authority/Neon写、Secret值/私密源读取、AssumeRole、ECR/ECS/Cell部署。Aurora连接及既有资源可能计费，50 USD/月仍非cap。

## 证据与不可重放

Run目录`F:/ChatGPT_workshop/techlong-d002-express-c4g-run-20261015-r1`，Inspect目录`F:/ChatGPT_workshop/techlong-d002-express-c4g-inspect-20261015-r1`。本地分析`F:/ChatGPT_workshop/techlong-d002-express-c4g-local-analysis-20261015-r1.json`仅记直接观察、假想副本验证与证据限制，不是新的执行授权。

六份原Review、六份Run、七份Inspect、分析文件和双槽原字节SHA核验一致；260源码LF pins/2工具及12项前置实际历史保持。后处理无新云/SQL回读、无执行源码修改、无大套件重跑或镜像重建；Backend153efbc源码/已验镜像及用户`.vscode/settings.json`保持。[紧凑实际事实与全部SHA](../ops/aws-sandbox/reviews/aurora-express-c4g-application-evidence.executed.json)。

本清单与双槽均已消费，即使仍在有效时间内也不得Run/Inspect重放、复位、补写、自动撤权或再次尝试；C4f及全部旧记录保留，F3c9不扩展。

## 唯一下一步：精确校准已证实的授予者

下一主线只准备新的、目标限定的角色校验适配：将本集群准确rds_iam membership授予者期望从postgres校准为已观察rdsadmin；保存实际元数据，不用假想副本冒充数据库观测。不得用“任意grantor”、允许多个角色parent、提高ADMIN/INHERIT/SET或放宽其它角色、ACL、结构、行数规则；原八SQL、库/应用OID及所有其它限制保持。

新代码/清单及一对新的独立永久尝试槽须先准备，实际调用按fresh SHA和具体变化另批。角色校准后仍要完成真实完整目录/权限核验、应用TLS IAM登录、完整ready/首轮初始化，才推进ECR→ECS；Source登录不代替ECS task role验收。不再做同类探针或重启Grant/恢复/F3c9支线，本次确认不授权新修复/尝试或部署。
