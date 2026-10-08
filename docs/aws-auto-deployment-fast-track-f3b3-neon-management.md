# F3b3：Neon 精确管理审批入口完成，安装待确认

2026-10-08 Winnipeg。完成只读 owner/schema/角色预检、分离的安装/登记审批入口及独立提交后回读。平台实现提交 `554b125155adb4ed5d632c3627327c788bf91430`。**本轮没有执行 Neon DDL/登记、创建角色/授权、修改 AWS 或启用 runtime；下列安装清单尚未获得批准。**

## 实际 Neon 预检

两次实际连接均为 TLS 证书/hostname 验证开启的 PostgreSQL 客户端，读取采用 Serializable/readOnly/deferrable 和事务局部 pg_catalog search_path，不调用可变 SECURITY DEFINER 指纹 helper。

最终私有目录 `F:/ChatGPT_workshop/techlong-f3b3-sealed-management-20261008-a2`：PG18.6（180006），管理身份/相关13张表 owner 均为 neondb_owner，owner membership 与 public CREATE 资格符合候选安装要求；十个 deployment FK 引用闭包准确，新对象0。cleanup_reader、drain_writer、拟议 plan_only_registrar 三个角色均不存在；这不是最小运行权限已经安装的声明。管理入口本次使用现有 owner 身份，不授予它任何新权限。

原计划仍 planned/plan_only/cell-demo-1/attempts0，唯一关联 deployment；实例 pending、订阅 active。九类执行引用均0，包括资源/容量/调度/步骤/事件/external operations/cleanup runs，原不可变 environment/app 触发器启用。完整原行、原 plan 字节与业务 JSON 只留私有 preimage 文件，未提交 Git。

最终 preflight 文件 SHA `b164e365e47de1472bd2016ea9eff87f3a8810f6edb2c70879dd0bfbbe64ffaa`，private preimage 文件 SHA `c53e659d644894377de56d2a72b40dc5a84dc605490de4b0c9dd1282bfaed5c6`，完整稳定 prestate SHA `88748fb48033ad44688576200982934257018607b16677a47814f7802963525e`。原a1初稿保留，不执行、不覆盖；a2绑定最终代码和当前数据库状态。

## 两个独立阶段

`sealed-plan-management-v1.ts` 与显式 CLI `review-f3b3-sealed-management.mjs` 没有加入自动 migration 或默认 Worker：

1. ReviewInstall → 单独确认 SHA → RunInstall → 新连接独立只读回读。只应用已验证 C088 SQL：两表、八函数、十六 Always triggers，以及一条**未密封内部 fence**。registry 仍为空，不登记旧计划、不创建角色/GRANT、不更新实例/订阅/原计划或原 trigger；新保护约束会限制原计划删除。DDL 使用短暂表写锁。
2. 安装独立核验成功后，才可 ReviewRegistration，重新读取原件、业务及已安装完整 guard/catalog，生成另一个 SHA 单独确认。RunRegistration 只插入准确十字段证书并让永久 trigger finalize 内部 fence；证书 pin 来自该次批准，sealed_at 来自 DB 事务时钟。当前 schema 未安装，**本轮不生成或批准登记清单**。

manifest 绑定 TLS 目标 fingerprint、四个管理代码文件 digest、准确 SQL SHA、完整 table/column/default/collation/index/constraint/trigger/owner/ACL、FK 闭包、拟议角色实际能力、原行/plan/business 哈希和一小时审批窗口。执行前及提交前严格校验批准 SHA/code/target/窗口；RW Serializable 事务内短暂锁住准确13张既有表并重新读取全部 prestate，漂移则不领取写槽位、不提交 DDL/INSERT。安装与登记不互相授权。

已安装保护校验直接读取 catalog：八个函数 body/语言/definer/search_path/参数/返回类型/PUBLIC EXECUTE/owner，十六触发器准确 table/function/type/参数/Always 属性及完整 FK 闭包都必须匹配。旧 trigger、原件/业务状态与现有角色不能被本入口改变。登记再绑定当前独立 protection hash，证书原件、批准 SHA 和 fence revision 增二必须回读一致。

两个固定私有槽位 `techlong-f3b3-sealed-install-v1-consumed`、`techlong-f3b3-sealed-register-v1-consumed` 均尚未创建。清单过期/错误批准/漂移在槽位领取前停止；领取后错误永久保留槽位，不复位、不自动重试。DDL/INSERT 的未提交事务失败允许 ROLLBACK；COMMIT 已提交但响应未知时不再提交或 down，只关闭原连接并独立只读回读。未知原 RPC 仍作为未知记录，不能凭一次 readback 把它改成“原提交响应成功”。所有私有输出与 consumed manifest 均 append-only，不含凭据日志。

## 真实 PG18 验证

32项隔离/source/evidence/management 定向检查、typecheck、定向 lint、JS语法/PowerShell AST 和 production build 通过。

[GitHub run37813739467](https://github.com/veinyyxy/TechlongSoftware/actions/runs/37813739467)，head `554b125155adb4ed5d632c3627327c788bf91430`、attempt1 success，固定官方 PG18.6 镜像，19组证明。新增一个随机、空、由 cell_admin 持有的合成数据库，使用真实 PostgreSQL 事务执行同一管理 core：错误批准先拒绝，正确安装只创建未登记保护，登记的实际 COMMIT 后模拟响应丢失，再从另一真实只读连接核对准确证书；重复调用不再次领取槽位或写入。原16组 guard/并发/v3证据证明在另一独立数据库保留。

两个 CI 自有数据库均 DROP，服务容器 stopped，独立 reader 新要求19组唯一 proof、准确管理证明名称及 ownedCiDatabaseCountDropped=2。它不是 Neon 写入/最小角色部署或 AWS 删除验证。私有目录 `F:/ChatGPT_workshop/techlong-f3b3-pg18-ci-20261008-a4`：raw ZIP SHA `6adfec4f63b944117f1d9d669680f31afab8a829076967c3c4708b4b4fe85dfe` 与 GitHub digest匹配；report SHA `50129d1c63dcefa2ac335b9b6fced56577275b4aff28f831a9d1d7381255deb1`，receipt SHA `4070c01191094fb96e5cfd3c9c0d8cd106f831a992b07ea0780a05ffd15410ef`，独立 verification SHA `9cbc3261d32baf5ad062b2c582c03e83108cba3c5601ac64a3f2b854091dad32`。

## 当前待批准清单与继续位置

仅安装清单 manifest SHA（不是 JSON 文件 SHA）：

`ce844c9096de5c71cf3d3447916143260d336292180dbf2193f3b256d67fb36b`

过期：2026-10-08 13:07:22 Winnipeg / 18:07:22 UTC。JSON 文件 SHA `4f274e1f5cfd09a52e2c8dd688c4e96ac102b415a111cd25323b0b31d19bafe0`。不以“开始下一步”代替这次具体数据库写入批准，过期只刷新只读清单、保留旧稿，再确认新 SHA。

若用户明确批准且窗口/所有 pin 仍有效，下一操作才是：

```powershell
node --experimental-strip-types --env-file-if-exists=.env.local ops/aws-sandbox/scripts/review-f3b3-sealed-management.mjs --mode RunInstall --out F:/ChatGPT_workshop/techlong-f3b3-sealed-management-20261008-install-a1 --manifest F:/ChatGPT_workshop/techlong-f3b3-sealed-management-20261008-a2/review-manifest.json --approved-sha ce844c9096de5c71cf3d3447916143260d336292180dbf2193f3b256d67fb36b
```

命令从平台仓库运行；本轮没有运行它。失败/未知提交后仅 VerifyInstall 新输出目录回读，不再 RunInstall。安装后单独登记，再推进最小 DB reader/writer/Secrets、v3 持久 authority/CAS/永久 journal/独立 root 与新版包；云 IAM/资源/真实 Cell 各按 fresh 具体范围批准。当前 source v3 和自动部署仍未启用，50USD/月目标、旧 Budget、旧镜像/记录/slot 保留。

本仓和服务端 main 按默认授权提交推送；服务端只同步文档，生产代码、app/lifecycle 镜像及现有 Lambda 包不变。未授权范围记录 `ops/aws-sandbox/reviews/f3b3-neon-management.prepared.json`。
