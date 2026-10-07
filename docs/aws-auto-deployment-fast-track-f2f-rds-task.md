# F2f 第一批：固定 RDS 会话源、任务 verify 与 v2 回执

2026-10-07 完成代码与真实本地 PG16 验证。F2f 尚未全部完成：镜像没有构建/运行，独立生产 admission/authority/CLI 写入口与实际 RDS/ECS readback 未启用。本机没有 Docker，WSL 未安装；不因这一阻断擅自安装系统组件或转为付费构建。

## 已实现

服务端 `tenant_rds_sessions.js`：独立 prepared AWSCURRENT Secret source、固定 RDS endpoint/5432/数据库/role、固定 CA 文件 SHA、显式 pg Client 字段与 timeout、管理/租户/app owned-session 生命周期。没有 connectionString，避免 URL 中 sslmode 覆盖已配置 CA；TLS rejectUnauthorized 与 servername 固定，实际 PG16.14/TLS/database/username/read-only 状态回读。borrowed management Secret 只有 username/password，runtime Secret 五键校验后只有 database URL 进入 SQL/app source；取消会关闭本任务自有连接，失败/end bounded cleanup，原诊断和密码不输出。不宣称 JavaScript 字符串可可靠擦除。参考 [node-postgres SSL 配置](https://node-postgres.com/features/ssl)。

`createPreparedRdsTaskComposition` 要求进程内 branded baseline compiler output 在任何 SDK/会话构建之前已完成；然后核对 image CA 并组合既有 SQL/application/cleanup providers。构造不发送 AWS API，不连接数据库。旧 production inspect/destroy factory/命令限制没有放宽。

composition 新 `taskService` 与 SQL-only `service` 区分：首轮 verify 完成 SQL verified，再原子激活并实际 app TLS 登录；已 verified 的 active 库复验固定完整结构/ACL/登录，不重新迁移或要求业务数据仍零行。当前回执包含严格 `applicationAccess` 三键 proof（policy、databaseLoginVerified=true、evidenceHash）；这不是 HTTP、ECS health 或 tenant ready。

`db/tenant_lifecycle_prepared.js` 提供独立 receipt-aware runner API 和 v2 S3 publisher。目标/版本先校验，准确已有回执不构造 Secret/SQL providers；完成 SQL/app proof 后才 immutable publish，已接受 PUT 响应丢失从准确 canonical/checksum bytes 恢复。旧 v1 decoder 不读 v2；平台显式配置 `receiptSchemaVersion:2` 才读新协议，并拒绝 SQL-only/false/额外 proof 字段。v1 不能伪装 applicationAccess。transport key 仍使用受批既有 `tenant-lifecycle/v1/...` 形状，不自动改 IAM 或旧对象。

平台 one-shot mutation adapter/Guarded database port 验证并传递严格 proof 到安全部署证据；默认 standalone Worker 与旧 v1 root 仍 disabled，旧 SQL-only legacy 回执兼容不等于新登录证据。

独立 CLI main **仅支持 `--check-bundle`**。环境 flag 或 verify 参数不能打开实际写入；执行 API 必须由后续受审 authority/root 调用。生产 env override 拒绝、task deadline/hard-abort、fresh admission/准确 task-definition/image/baseline/source 与 S3 artifact loading 仍要在下一批 root 中一起绑定，不能直接用这个镜像替换旧在线 TaskDefinition。

## 真实 catalog 兼容修复

固定 pg startup search_path=pg_catalog 后，pg_get_constraintdef 的 schema 限定文本与既有 journal pin 不一致，首个新实例 fail closed。新增 `tenant_journal_catalog.js` 在 durable management transactions **之间**用独立 BEGIN READ ONLY/SET LOCAL pg_catalog,public 读取固定完整 catalog，commit/rollback 恢复原 GUC。prepare v1/v2 与 normal cleanup SHA 保持原值，不忽略 ACL/constraint 差异，不更改云端 journal。最终非默认 search_path 下三个 pin 与 GUC 恢复均实际证明。

## 镜像候选与证书复核

`Dockerfile.lifecycle` 使用既有固定 Node24.18.0/PostgreSQL16.14 digest，linux/amd64 pg_restore 与同 pinned stage libpq、Python3、非 root、固定 SQL/hash/CA bundle check。它不嵌入 candidate archive、manifest 或 Secret，不监听 HTTP，默认仅 check-bundle。新 Dockerfile 目前只有静态检查通过，不能声称 Linux 动态库、pg_restore render 或实际 image digest 已验收。

AWS 官方公开 `global-bundle.pem` 当前 SHA 与仓库旧 `e5bb...` 不同。独立 HTTPS 下载到 `F:/ChatGPT_workshop/techlong-rds-truststore-20261007-f2f.pem`，169984 bytes，新 SHA：`fe45bbebf92ad3e27a583bbb2ddd1553c521ed4d49af5514dc0a40372ea5395c`。111 个证书均 CA/self-signed、签名自验、有效期覆盖本日、subject 为 Amazon RDS；包含 ca-central-1 的 RSA2048/RSA4096/ECC384 G1。只信任 root，参考 [AWS CA 与下载说明](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.SSL.html)。

新 prepared loader 与三个候选 Dockerfile/既有迁移 shell 的固定 SHA 同步为此次审阅值；没有升级线上 image、系统 trust store 或 RDS CA。未来公开 bytes 再变更仍 hash fail closed，不自动学习或接受任意 PEM。公开 HTTPS 获取不是 Secrets/AWS SDK 资源调用。

## 真实证据与验证范围

最终目录 `F:/ChatGPT_workshop/techlong-pg16-prepared-rds-task-20261007-f2f4`。

- `sessions-receipt.json` SHA：`7960a3c9cda002af640ecac4bad465d73f6861ece765d37b0664045f6111112c`。
- outcome：`PREPARED_RDS_SOURCE_TASK_REAL_PG16_VERIFIED`；actualPreparedFactoryUsed/pinnedOfficialTrustStoreVerified=true。
- 真实 SQL prepare→restore→migrate→combined verify/app login、v2 receipt 已接受响应丢失恢复、receipt replay 不构造 providers、业务 entitlement 实际修改后 fresh active verify 不覆盖、owned session 取消、准确 activated cleanup 和独立只读 psql terminal 回读通过。
- 固定 production Client 配置被检查；AWS SDK Secret/receipt storage 以及实际网络传输 **明确用本地测试依赖替换**。PG TLS/SCRAM 与 SQL是真实的，但不是实际 AWS endpoint/CA/server/Secrets/S3/ECS 证明：`localTransportOverride=true`、`rdsEndpointVerified=false`、`rdsCertificateVerified=false`。
- runtimeEnabled/baselineApproved/sourceMutationPerformed/cloudMutationPerformed/managementSuperuser=false，isolatedServerStopped=true。

平台独立进程用真实 validator/canonicalJson/sha256Hex 读取上述 `task-4-receipt.json` 字节，跨仓协议通过；此准确 v2 task receipt SHA：`f3339ef910cdcb6ca6786d997222f1c47d898d8dc3bc61b2517ab4f8ed533f39`。不是 S3/ECS 在线 readback。

服务端 97 项 Node 定向回归、28 项 Python 严格 baseline 校验、类型检查及既有 migration shell 语法通过；平台 64 项相关测试、类型检查与定向 lint 通过。首个 catalog mismatch 失败目录与后续成功目录保留，四个实例独立 pg_ctl status 证明停止。私有 CA/SQL/archive/keys/cluster/完整 receipts 不入 Git；用户无关 `.vscode/settings.json` 保留不提交。仅本地测试 database/role 删除，原 OID 不可恢复，永久记录保留；没有源 PG15/AWS/Neon 删除。

## 下一批

1. 用户选择本地 Docker Desktop（推荐）或另行审阅 GitHub Actions 仅构建、不上传；本阶段未安装 Docker/WSL、创建/dispatch 新 workflow 或使用付费构建。
2. 构建 linux/amd64 lifecycle candidate、容器内 bundle/compiler/严格 artifact 读回验收，记录准确 image digest；不自动 push ECR。
3. 完成生产 admission/authority/环境/截止/只读 artifact mount 或准确 S3 source/receipt protocol 与固定 commands 的 root 接线，保留旧入口，不靠 env boolean 启用。
4. F3 再准备真实 account/Cell/费用/模板/IAM/baseline/image fresh SHA 清单；用户批准后才安装/创建/运行和独立收尾。50 USD/月目标不代替这些批准。
