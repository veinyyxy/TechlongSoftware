# F3c9d：安装在提交前停止，数据库前态已恢复

2026-10-12 Winnipeg。用户批准 `91a63757de532e1189f7c2478401e26d46cd2643965c802172cb9841477c4291` 及完整风险后，原68绑定 Run 仅执行一次。窗口/代码/目标/权限基线及完整前态通过，永久槽位消费，两份 schema/grants SQL 在同一事务中提交给服务端；**提交前目录核验失败，未尝试 COMMIT，已对未提交事务请求 ROLLBACK。安装没有完成，不能称新保护已安装。**

## 当前确认的事实

- 原停止代码 `FAILED_INSTALL_TABLE_GUARDS_OR_ACL_INVALID`，回执 `STOPPED_BEFORE_COMMIT_READONLY_INSPECT_ONLY`；`ddlAttempted=true`、`slotConsumed=true`、`commitAttempted=false`、`commitConfirmed=false`。没有 SQL 写重试、自动 down、第二槽或云变更。
- 原流程关闭写连接后，**00:44:48.270 UTC / Winnipeg19:44:48.270** 的新 TLS SERIALIZABLE READ ONLY DEFERRABLE 回读完整摘要为 `e2f42d03...`，与批准前态一致。原 Inspect 仍用“应已安装”条件检查，因此返回 `FAILED_INSTALL_ROLE_DELTA_EXCEEDS_SCOPE`；这是 rollback 后未出现预期新增授权，不是已发现权限扩大。
- **00:48:52.085 UTC / Winnipeg19:48:52.085** 第二独立新连接只读验收再次确认：完整 state hash及canonical状态与批准前态完全一致，结果 `REVIEWED_PRESTATE_RESTORED_INDEPENDENTLY_VERIFIED`。PG18.6、open/epoch0/apply0、旧证书/保护/业务摘要与原角色属性、schema目录、权限均在该完整前态内。
- 新失败围栏表/函数未留存；reader仍8个表SELECT/0列权限，drain仍4个表SELECT/20列窄权限，两者均无 non-trigger SECURITY DEFINER access。没有调用失败入口、改业务原件/密码/Secret/AWS、登记parent或创建Cell，runtime关闭。
- 固定槽 `F:/ChatGPT_workshop/techlong-f3c9d-failed-birth-installation.permanent-slot.json` 于 **00:44:45.179 UTC** 消费；即便数据库事务已回滚，也**禁止删除、复位、换目录或重跑原 Run**。原 r1/r2/r3评审、批准、运行和失败回执全部保留。

## 已定位的核验缺陷与诊断限制

原核验器要求新表 `pg_constraint` 总数**恰好7**，按5 CHECK+1 PK+1 FK计数。PG18将列 NOT NULL 也保存到该目录；官方变更说明明确记载此变化。[PostgreSQL 18约束变更](https://www.postgresql.org/docs/18/release-18.html)

本次新只读目录检查实际观察到 `deployment_environments` 有17个 `contype=n`，原隔离fence表有3个。候选新表有4个 NOT NULL 列，因此原“总数7”的核验规则具有确定的 PG18 兼容性遗漏；此前纯夹具测试只构造7项约束，未覆盖真实PG18目录形态。

**停止时的新表事务内快照没有持久化，原错误码还合并了owner/RLS/ACL等检查，所以不能宣称已唯一证明这次失败仅由总数导致，也不能声称ACL实际无问题。** 当前证据足以确认前态恢复及核验代码缺陷；不能通过重新执行DDL来补取证，也不放宽检查后重跑旧批准。

下一修正应明确核对PG18的NOT NULL映射、CHECK/PK/FK与enforced/validated状态，并在失败前保存安全目录明细；不能仅把7改为11或接受任意总数。当前仅记录建议，**原批准68文件/SQL及写入器未修改，没有生成新的写批准或新的重试槽**。

## 证据与继续位置

| 记录 | 摘要 |
| --- | --- |
| 原68代码 | `cd90d88625ea3c2b25226ea5a326a53bc9b34104ad05e8c628735489290f4486`，保持不变 |
| 原提交停止回执 | `43077c961fd125583102b8209510ab24587ba7fb4d4830d26f79fa6b344a4cee` |
| 永久槽文件 | `d113cae152d5eb0a3c4b10e7f16fd07983813bd303c8d0e057d729676f2b7d9e` |
| 批准及两次回读完整state | `e2f42d036a44235ebfede2f0703336740df95d091551540ddf21a53920c26b88` |
| 新独立只读69代码 | `188df45ac87355f2b178086bb4a377f4a266c8511de4bf1c1d6ab23a24830c1e` |
| 新独立验收报告 | `3d2853a1e4542cfaa24244b55343efcc79ed0b9de887a8caa8c5775aa7257945` |

原记录目录 `F:/ChatGPT_workshop/techlong-f3c9d-neon-install-20261012-r3-run/`；独立验收目录 `F:/ChatGPT_workshop/techlong-f3c9d-neon-stop-20261012-r1/`。新工具 `inspect-failed-cell-birth-installation-stop-v4.mjs` 只有读取与私有证据保存能力，不是安装或修复入口，不生成新批准、槽位或runtime proof。3项新增只读工具边界测试、lint 0 warning和syntax通过；不重做原24项或隔离数据库模拟。

本次共3个数据库连接（原写事务1＋独立只读2），schema SQL尝试1、grants SQL尝试1、COMMIT尝试0；持久前态恢复已验证。新增 inspector 写0，AWS调用/Secret值/Invoke0。DDL未提交不意味着提供者日志或费用必为零，50 USD/月仍非hard cap。

需要用户同意后再准备**仅本地PG18兼容修正及新的受审恢复方案**，明确旧槽永久保留、恢复范围与新fresh SHA。实际下一次安装必须另审，当前授权不允许自动重试或绕过原槽。后续 gate-capable包/async/最终IAM-table-parent和付费Cell仍未授权或就绪；F3c9d及自动部署都未完成。
