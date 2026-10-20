# W6f：最小激活第1步，只安装 NOLOGIN 控制账本

2026-10-20。沿用已实测的App身份proof `1465a6050e878dba63b58c0214b82ef88ff051256a28ddc63a14e817e2076aca`，不再调度身份实验。当前最短落地动作是安装已通过真实PG测试的现有 `ops/platform-controller-v6/install.sql`；**本轮只实现/测试安装入口、只读盘点和准备待审清单，不执行生产安装**。

用户要求延长有效期：**仅此NOLOGIN账本安装清单从48小时延长为7天（168小时）**，不是权限启用、Secret/LOGIN、App调度或实际部署清单的全局延期。旧SHA `203cda411dd01c01d3295663ee517d936dd80634c907d6291b78ca8f7f2c2c2a` 从2026-10-20 07:55:11至2026-10-22 07:55:11温尼伯时间，本来并未过期；因代码/风险pin和时长变化，旧清单保留但不执行，也不把原确认挪到新SHA。新清单需要重新确认，永久执行槽不变且未消费。以后展示完整年月日、时区、UTC和168小时，避免把截止日误读成当天。

## 收口后的剩余路线

1. 本步：Neon审批/intent/ACK/证明账本，角色保持NOLOGIN。已有SQL不重写，完整批次原子执行，独立目录核验。
2. 紧接着集中接入可信publisher生产I/O、平台专用窄凭据和App caller/reusable/trust发布。保留owner-only计划/证明导入，不向平台HTTP暴露owner DSN；具体Secret/LOGIN/IAM/发布范围集中准备fresh清单，不再拆身份探针。现有 `PLATFORM_RELEASE` 仍UNPUBLISHED，只有明确受审的发布绑定才能启用。
3. 用新held job完成Review→人工environment批准→RunOnce→独立Inspect；不复用旧W5r完成任务。最终整套系统AWS上线、Aurora双模式和50 USD/月目标保持，不转向Sites。

本步不宣称第2步生产I/O或第3步已完成；不要因此直接打开平台开关。旧认证pins在未来合法激活变更时需要改为核验原冻结源码，不能清空历史或借旧批准激活新代码；当前它们保持不变。

## 唯一拟批准变更

准确当前Neon目标，通过平台 `.env.local` 已有DATABASE_URL内存连接，显式TLS证书/主机验证（不接受自定义endpoint或不安全TLS）。不输出DSN或密码，不把owner凭据绑定到API。其公开目标指纹在清单冻结；真实只读盘点指纹为 `5d5e52c00c54ed761aac13730f81b1b6f107d7ac06a68a407276132d150690a7`，本机原件位于 `F:/ChatGPT_workshop/techlong-w6f-control-inventory-20261020-a`。

- 1个角色 `techlong_deployment_controller_v6`，NOLOGIN、NOINHERIT、非superuser/CREATEROLE/CREATEDB/REPLICATION/BYPASSRLS。
- 1个schema `deployment_control_v6`、3表 `plans` / `approvals` / `dispatch_attempts`，含原SQL的PK/FK/唯一性/check约束及其隐式索引；不新增业务行或修改旧表定义。
- 9个固定SECURITY DEFINER函数。只有7个控制函数向该角色授予EXECUTE；`publish_plan`、`attest_evidence`保持owner-only。新表不给服务角色直接读写，PUBLIC权限按原SQL撤销；固定search_path为pg_catalog,pg_temp。
- **不设密码、不LOGIN、不创建Secret、不授予IAM、不读App key、不调度、不改业务状态或旧schema/触发器，不调用AWS。** 创建者可能自动获得该角色的ADMIN等成员资格；NOLOGIN不禁止授权成员SET ROLE，不能把它说成任何人都无法使用。

SQL文本完全复用既有候选，已有BEGIN/COMMIT、5秒lock_timeout、20秒statement_timeout、固定advisory事务锁及占槽拒绝；不加IF NOT EXISTS、ALTER补齐或CREATE OR REPLACE。创建角色/schema任一已存在即拒绝，不修复/删除/重建。

## 实现与核验

`ops/platform-controller-review-v6/`：

- `catalog.mjs`：Repeatable Read READ ONLY事务，只读安装者/目标角色/schema/函数/表/ACL/成员资格和三个旧业务表身份/owner元数据。仅在新控制表已存在时计数其行，不读取业务行、payload或凭据。
- `install.mjs`：固定SQL函数体摘要、14项源码/风险/证据pin、目标指纹、准确CI和7天清单；一永久槽先于唯一原始SQL批次。COMMIT ACK后同进程回读，之后必须新连接独立Inspect。延长只影响批准有效期，不放宽执行前fresh目录逐项比对、准确main/源码pin/CI校验或原SQL事务门禁。
- `local.mjs`：显式Postgres TLS连接，无AWS/App客户端。Inventory/Prepare只读；唯一Install路径提交原完整SQL一次。Inspect不发DDL/补偿，不受清单过期限制，但必须绑定原槽和原目标；部分/漂移状态只报告。

独立核验要求：3张新表均空、列名/owner正确、无PUBLIC或服务角色直接表访问；角色保持上述禁用flags且不属于其它角色；仅允许安装者成为新角色的自动ADMIN成员并记录其SET/INHERIT实际值；9个函数的参数类型、语言、owner、SECURITY DEFINER、固定search_path、**服务端prosrc逐个摘要**与原SQL匹配，7服务EXECUTE/2 owner-only。旧三表OID/owner未变不等于审计所有业务行或列定义；程序不作这种更强声明。

12项安装入口检查（含7天边界、旧SHA不延期及第6天漂移拒绝）+6项既有publisher回归；临时PG18.6 CI会实际安装原SQL批次、检查COMMIT ACK，再调用相同目录核验器，随后继续原publisher实际SQL验证。原48小时版准确CI39425720068已通过；7天版必须绑定本次新源码的成功CI，不借用旧绿色结果。生产Neon已只读确认18.6、目标角色/schema缺席和安装权限；**只读兼容性不是生产安装成功证明**。原App身份原件逐一校验，不重新读取PEM或调用GitHub身份workflow。

## 命令与批准边界

最终代码提交推送并在准确源码CI成功后，保持main不再推进：

```powershell
node --experimental-strip-types ops/platform-controller-review-v6/local.mjs --mode Prepare --ci-run <准确成功CI运行ID> --output F:/ChatGPT_workshop/techlong-w6f-control-20261020-b
```

Prepare重新核对当前main/准确CI/Neon目录，生成仓库外 `manifest.json` 和最终SHA；这解决manifest包含自身父commit的自指问题。公开仓库准备记录不是执行授权。精确SHA获批后才允许：

```powershell
node --experimental-strip-types ops/platform-controller-review-v6/local.mjs --mode Install --manifest F:/ChatGPT_workshop/techlong-w6f-control-20261020-b/manifest.json --approved-sha <最终SHA> --output F:/ChatGPT_workshop/techlong-w6f-control-20261020-b-run
```

新永久槽 `F:/ChatGPT_workshop/techlong-w6f-control-install.intent.json` 先于单次SQL安装批次占用。执行前重新核对目录与批准prestate逐项一致；原SQL中的事务锁/存在性检查还会拒绝期间出现的占用。若SQL/网络/ACK/回读失败，不自动重新安装、撤销、down或补齐。

无论成功/不明，独立进程只读：

```powershell
node --experimental-strip-types ops/platform-controller-review-v6/local.mjs --mode Inspect --manifest F:/ChatGPT_workshop/techlong-w6f-control-20261020-b/manifest.json --output F:/ChatGPT_workshop/techlong-w6f-control-20261020-b-inspect
```

未占槽的过期/源码/目录变化只能准备新清单重新确认；不得自动重跑失败命令。已占槽不自动复位，旧W6b/W6d/W6e槽和原件保留。

## 完整风险

- 原SQL创建持久数据库对象、角色、成员资格和引用限制；不是临时探针。FK/约束可能影响以后删除业务对象，DDL会短暂锁表。锁/语句超时不保证零影响，执行会唤醒Neon计算并产生网络/托管日志。
- 现有owner连接具有高权限，只有此本机受审入口使用；不是数据库提供者侧对该凭据的单批次ACL。凭据、TLS终端、客户端内存或本机被攻陷仍有风险；不输出密码不能保证提供者日志或内存完全无暴露。不更改owner密码/权限，不存入仓库或平台HTTP。
- NOLOGIN不等于没有能力：已有角色成员可能SET ROLE，未来获得LOGIN的服务凭据可调用7个写控制账本的函数。SQL中的admin ID和SHA不是人的密码学签名，仍依赖可信平台授权/会话；本步没有激活该服务凭据。PUBLIC其它函数/列权限/继承路径尚未做未来LOGIN的全量审计，必须在激活前另审，不能由本次通过推导最小权限全面安全。
- 只读目录、文件、GitHub和数据库事务不是跨服务CAS；并发DDL/权限变化会使安装失败或回读漂移。程序不发自动down；提交前断连可能由数据库事务机制回滚，提交后ACK丢失则可能已安装，必须独立Inspect，不能重放。
- 7天批准窗口增加等待期间事实或操作者意图变旧的风险；到期仍拒绝，未到期也仍须逐项重读目录与源码/CI，漂移就停止而不是自动刷新批准。源提交固定，main推进会使安装拒绝；7天不代表允许跳过变化审核，不改变数据库连接或临时凭据自身的有效期。
- PostgreSQL角色创建者可能自动取得ADMIN/SET/INHERIT成员选项，实际值记录，不承诺不同版本默认行为完全相同。角色/函数属主与集群/数据库范围必须以真实目录为准，既有owner本身的权限没有被本步收紧。
- 独立Inspect只能核验准确schema/目录与空表时点，不能消除随后并发变化或证明所有业务行未被其它进程改动。provider、数据库或本地原件缺失时停止，不凭CI绿色冒充生产成功。
- Neon/Actions可能消耗免费额度或产生费用，低成本但不保证绝对零费用；不升级plan、不改付费设置，50 USD/月是AWS预算目标而非硬性费用闸。原有AWS资源仍可能收费，本步不创建/删除它们。
- 提交后不自动回滚/down；永久槽不复位、不重试。任何Secret/LOGIN/IAM/trust/App部署发布和新任务执行，仍需具体资源与fresh SHA单独确认。
