# F2b：空 baseline 的真实 PostgreSQL 16.14 验收

日期：2026-10-06（America/Winnipeg）。沿用 50 USD/月交付优先方案。本批次只操作新建的本地隔离实例，不升级源 PG15，不访问 AWS/Neon，不批准生产 baseline。

## 已完成

上一批次 PG15.3 schema-only archive 已在**真实 PostgreSQL 16.14** 上单次恢复成功，独立只读进程/会话核验：

- 实际 `server_version_num=160014`，绑定准确生成的 data directory、127.0.0.1、非 5432 端口、专用 role/database。
- 73 张表清单一致，全部零行；不是根据 manifest 的 `rows: 0` 推定。
- `uuid-ossp` 1.1/public、5 个函数的 body/language/volatility/非 SECURITY DEFINER、4 个启用的准确 trigger 绑定通过现有 profile 验证 SQL。
- `pg_ctl stop` 后独立 `status` 返回未运行；另起文件核验确认本次和此前两个临时目录均无 `postmaster.pid`。
- 源 archive/manifest SHA 未变；没有执行旧 IAM/Change Set、上传 S3、发布镜像、启动 ECS 或改 Budget。

## 证据

原候选目录：`F:/ChatGPT_workshop/techlong-empty-baseline-20261005-f2a4`。

成功验收目录：`F:/ChatGPT_workshop/techlong-pg16-baseline-verification-20261006-f2b3`。

| 对象 | SHA-256 |
| --- | --- |
| 原 archive / 隔离冻结副本 | `1a65288b4628018932a8d9af4658db5702b6cf49966a2032bc2d919bc591d70a` |
| 原 manifest / 隔离冻结副本 | `62b5dc8cadcf276df140be86e002a08b64d9b713bd0257e14ac515c12a996971` |
| `pg16-verification-receipt.json` | `9b4b2ce704f87c08676a6b7d3f74514296d8d2863c6f25ec59dc5bba57735b27` |
| 实际执行的验证 SQL | `c676d7d47fe45f50c6c1ccecb0eefdae4b3eb9397ffdf62d8ef89b7a55043303` |

收据结果 `PG16_RESTORE_EMPTY_PROFILE_VERIFIED`，`pg16RestoreVerified=true`、`isolatedServerStopped=true`，但 **`baselineApproved=false`**。收据的 UTC 完成时间为 `2026-10-07T04:26:35.535Z`，对应本地 10 月 6 日晚间。私有 archive、SQL、目录、日志、收据不提交 Git。

## 实施边界与工具

服务端 `scripts/verify-empty-tenant-baseline-pg16.js` 只接受明确 candidate/工具/新输出目录和两项输入 SHA；workspace realpath 围栏、新目录独占、冻结副本及恢复前复算防止错用既有目标。它不读 `.env`；子进程清除源 PG、AWS 和其他凭据，只给新实例传递新生成的随机密码。SCRAM 认证，密码不进入 argv/收据，bootstrap password 临时文件在初始化后移除。

便携 PG16.14 下载自 PostgreSQL 官方 Windows 下载页所指向的 EDB HTTPS ZIP，仅提取 bin/lib/share 到 `F:/ChatGPT_workshop/techlong-pg16-20261006/portable`，未安装 Windows 服务、注册表项或修改 PATH。ZIP 325739757 字节，观测 SHA `98af1417ba6a8dc30543e560e5407833a3b9e7cc7ed20e73b2006f3aa2f04663`；程序版本均为 16.14。该 SHA 是实际下载物的完整性记录，**不是独立发布方签名证明**；`postgres.exe` Authenticode 状态为 NotSigned。

仅本地隔离实例使用 `ssl=off`；生产 RDS `verify-full`/CA、ownership、runtime 门禁没有放宽。恢复使用单事务/遇错退出，不使用 clean/create/覆盖现有对象。首次 Windows pg_ctl 输出句柄等待超时、第二次 inet 文本带 /32 的 identity 误判均发生在恢复提交前，已停止实例并保留失败记录；修复后使用新目录验收，没有复位旧目录或重放云操作。

本批次 14 项必要 Node 相邻回归、28 项既有 Python baseline/legacy/profile 测试、类型检查和 diff check 通过。没有把本地验收称为 Aurora、镜像或 Worker 在线验收。

## 下一阶段

F2c 实现真实 `prepare_empty_database / restore_approved_baseline / migrate_saas / verify` provider。现有 production 入口仍仅 inspect/cleanup-only destroy；新 provider 需复用准确 management target、ownership/epoch、session advisory lock 和 durable receipt/崩溃恢复，而非调用会读源 `.env` 的开发迁移脚本。

`saas_control.sql` 会创建租户 singleton/entitlement，`theme_config.sql` 会创建两项配置 seed；因此“baseline 73 张表全空”验收与“迁移后允许哪些初始化行”要分开，不能对迁移后的库仍宣称全表零行。发布前另行审阅 baseline 批准/immutable artifact 清单和 SaaS 迁移内容；本次验收不授权任何云发布或数据库上线写入。

官方依据：[Windows 便携二进制](https://www.postgresql.org/download/windows/)、[pg_dump 跨版本说明](https://www.postgresql.org/docs/16/app-pgdump.html)、[PostgreSQL 16 迁移兼容注意事项](https://www.postgresql.org/docs/16/release-16.html)、[inet 的文本与 host 表达](https://www.postgresql.org/docs/16/functions-net.html)。
