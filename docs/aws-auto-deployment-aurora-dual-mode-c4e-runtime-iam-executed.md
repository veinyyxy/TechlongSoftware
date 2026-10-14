# D002 C4e：三项持久 IAM 变更完成，独立文档核验通过

2026-10-14 America/Winnipeg。用户确认 [准确三写及完整风险](./aws-auto-deployment-aurora-dual-mode-c4e-runtime-iam-review.md)后，按 SHA `785b18c85d29e32c2c54a4d1c20fbffe4b0d7928adad86fafc2817222f2188ce` 执行一次 Run，立即另起进程完成唯一独立 Inspect。结果为 `IAM_DOCUMENTS_INDEPENDENTLY_OBSERVED_NOT_RUNTIME_VERIFIED`。这是实际 IAM 文档安装验收，**不是实际数据库登录、Secret 解密、完整 ready 或 ECS 部署验收**。

## 实际安装与独立回读

| 实际写入 | 资源与结果 | 本地成功响应时间（Winnipeg CDT） |
| --- | --- | --- |
| CreatePolicyVersion，SetAsDefault=true | TechlongSandboxServiceRoleBoundary / ANPAV3GNMXTZHXSTCQBZC，实际新增默认 v4，原 v3 保留且不再默认 | 18:28:51.926 |
| PutRolePolicy | TechlongSandboxTenantLifecycleTaskRole / AROAV3GNMXTZDIWVT3BKN，ImmutableReceiptsAndGenerationSecretRead | 18:28:52.130 |
| PutRolePolicy | TechlongSandboxTaskRole / AROAV3GNMXTZLH2AU5I5G，ConnectExactExpressTenantC4e | 18:28:52.315 |

对应 UTC 为23:28:51.926、23:28:52.130、23:28:52.315；这些是入口 journal 的本地观察时间，不是 AWS 服务端时钟。没有额外 SetDefaultPolicyVersion、DeletePolicyVersion 或 role 创建/替换。

独立 Inspect 于18:29:05.847 CDT / 23:29:05.847 UTC保存结果，确认当前默认文档与受审候选完全一致、版本目录准确为 v3/nondefault 与 v4/default、三角色的原 RoleId/trust/tags/boundary 关联/attachments 保持、execution inline 不变，7个准确 boundary 使用者及普通权限附件为0保持。安装槽18:28:51.526、Inspect槽18:29:04.993 CDT永久消费。

准确连接资源仍分别为：

- 应用：`arn:aws:rds-db:ca-central-1:402010193138:dbuser:cluster-XBWGLIW2B3HPGX3ROHYJA7CNPM/tenant_a0da1748bc4d5419_role`
- 生命周期管理：`arn:aws:rds-db:ca-central-1:402010193138:dbuser:cluster-XBWGLIW2B3HPGX3ROHYJA7CNPM/postgres`

连接 Allow 同时限定各自准确 principal role ARN；应用没有新增 postgres 连接或 Secret 读取 Allow。生命周期保留原四语句并新增管理连接及固定 Secret 版本读取。真实 Secret 为 `arn:aws:secretsmanager:ca-central-1:402010193138:secret:techlong/sandbox/tenant/a4377bce498b9c5ee9e64509dcad_a0da1748bc/runtime/g1-T9CqN5`，版本 `0f45d29f-02d4-4117-99b1-c06645aa3c6e`。新 boundary 显式 Deny 对这个 Secret 的错误/缺失 VersionId 请求，作用于全部7个使用者；execution 既有宽前缀 Allow 保留但不能覆盖 Deny。旧 Full 与其它资源语句不改。这些是持久权限，不会自动撤权；既有/未来合格 ECS 会话可能利用它们。

| 执行 | AWS/CLI元数据 | IAM写 | SQL连接 / Secret值读取 / 私密源读取 |
| --- | --- | --- | --- |
| Run | 33 | 3 | 0 / 0 / 0 |
| 独立Inspect | 30 | 0 | 0 / 0 / 0 |

两次均只读核对 Source、物理 Express 17.9/FREE ACTIVE 和固定 Secret 元数据。Run前六组策略模拟通过，Inspect后六组再次通过（各8个准确资源决策）：app→app、lifecycle→postgres及两角色固定版本读取 allowed；交叉数据库用户 implicitDeny；execution错/缺版本 explicitDeny。这是候选策略模拟，不是实际角色会话、SCP/session/KMS、数据库或 Secret 访问证明。未 AssumeRole、生成数据库 token、GetSecretValue 或连接 SQL。

## 完整性、持续影响与不可重放

Run目录 `F:/ChatGPT_workshop/techlong-d002-express-c4e-run-20261014-r1`，Inspect目录 `F:/ChatGPT_workshop/techlong-d002-express-c4e-inspect-20261014-r1`。独立本地核验13份原 Review、14份 Run、11份 Inspect安全结果的原始字节 SHA、三项 request hash/成功 journal、双槽及受审 manifest 一致；254源码LF pins+2工具原字节保持，code binding `8f85439b0967a70c6ac1ad3cdec9947baf3b56bb53019902e51b9f319036d96e`。没有追加 AWS/SQL回读。[紧凑证据及全部文件 SHA](../ops/aws-sandbox/reviews/aurora-express-c4e-runtime-iam.executed.json)。

两槽及本次授权均已消费；即使清单仍在有效时间内，也不得重复 Run/Inspect、刷新后重放、补齐、回滚、撤权、删版本或复位槽。所有 C4d/C4c/C3/Full失败及F3c9历史保留。新默认及 inline 可能与既有 CloudFormation 管理资源产生 drift，后续栈/手动更新可能覆盖；本次未修改或重放原 template/Stack。7角色版本限制和生命周期 postgres 管理能力的完整风险仍适用，不是租户行过滤或全账户 Secret 隔离。

本阶段 SQL/LOGIN/GRANT、Secret值或私密材料读取、业务/authority、Lambda、ECR/ECS/Cell、云删除及自动重试均0。没有重查 SQL角色、隔离/schema或 ready；C4c NOLOGIN仍是历史事实，不能当作本轮新证明。既有 Secret/Aurora等仍可能计费，50 USD/月只是目标。后处理仅结果文档/非秘密证据，254执行pins、Backend153efbc执行源码/已验镜像及用户`.vscode/settings.json`不改，不运行历史大套件或重建镜像。

## 唯一下一主线

IAM文档缺口已完成，不再开权限/撤权探针支线。下一沿C4a最小应用接线集中准备准确 SQL CONNECT/public USAGE/固定73表DML/7序列USAGE、受限rds_iam及LOGIN，并以真实TLS IAM登录验证，再完成完整ready/首轮初始化，随后ECR→ECS。所有实际SQL/初始化、角色会话/Secret值访问、发布/部署需按具体资源与变更范围重新批准；当前C4e授权不延伸至这些动作。保留`full_password`兼容与封存F3c9，不回放任何旧槽。
