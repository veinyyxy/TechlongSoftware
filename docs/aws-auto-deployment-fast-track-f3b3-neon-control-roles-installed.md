# F3b3：Neon 两个 NOLOGIN 控制角色已安装并独立核验

2026-10-08 Winnipeg。用户明确批准清单 `4ef39a5995c8a0d394e1cbb72b2c3e51d8588bd86e8b75e3d6287ba138171cac` 后，按原审阅代码和固定 SQL 单次安装；COMMIT 确认、执行后新连接回读及另一个独立进程 Verify 均成功。**仅完成两角色/GRANT 批次；没有设置密码、激活 LOGIN、创建 Secret、AWS 写入或运行时启用。**

## 实际状态

- `techlong_cell_cleanup_reader`：NOLOGIN、NOINHERIT、非super/createdb/createrole/bypassRLS/replication；默认只读，public USAGE，八张准确控制表 SELECT，无有效列写。
- `techlong_cell_drain`：同样 NOLOGIN/NOINHERIT/非管理员，public USAGE、四表 SELECT、准确20项列权限（admission七列 UPDATE、jobs十一列 INSERT、两个 updated_at UPDATE）。没有表级写、DELETE/TRUNCATE/DDL、owner membership、对象 grant option、sequence 或可执行非trigger SECURITY DEFINER 能力。
- 两角色没有向上 membership；创建者 `neondb_owner` 各获得清单明确接受的 ADMIN=true、SET=false、INHERIT=false 自动成员资格。不授新 SET/INHERIT/owner role。列级能力不是行过滤，也不是纯读能力；安装过程没有执行任何业务 DML。
- 原完整密封证书 canonical SHA `dc093614188a8f0a086b4fc6a7e251c43312495a60db2efffc654cf3d48b066f`、sealed=true/revision2、原业务/plan/保护目录与其余既有权限保持。preserved SHA 与批准 prestate 完全一致：`993506a66f586d9ad447b77769769cbf372dee9be9a30cc556af9d9de00426fa`。
- poststate SHA `1528e1e2888bb191200d8bc2224318512cfa63f5aaa138eb324870674f3fe0ef`。两次独立回读一致；未读原始密码或向日志/Git提交数据库URL、SecretString、私有业务preimage。

## 执行与证据

实现/PG验证 head `8c5080e2e8d9c7ba56afabd0e17b8e07fd90977e`，执行时 main 为仅增加文档的 `24862fe06eb93b6bbafbc6937e71b63a0817c45d`。原 code/依赖 binding `03a91abcef1d08dd23fb174130962f4489a98a9625fbec87608654825b8ed93f`、目标fingerprint `06e1188c19fe0c8552bd398f192d7489ccae48498216fcd532344d07720cadab` 和 SQL SHA `7fc82e392d1745b4e7031a1449d094cd2b327cfaccb459f768e917a4754df016` 未改。执行前有效期和空slot通过；准确prestate在控制表短锁内重读一致后，固定SQL一次提交，没有任何写重试。

私有执行目录 `F:/ChatGPT_workshop/techlong-f3b3-control-roles-20261008-b5-run`：

- submission receipt SHA `229e15ec8e7ddf045dbb767a156429beaa5930549a930f231e5bdf72a6f60ab7`；outcome `ROLE_COMMIT_CONFIRMED_REQUIRES_INDEPENDENT_READBACK`，slotConsumed/sqlSubmitted/commitConfirmed=true，retryAuthorized/runtimeEnabled=false。
- 新连接 observation：2026-10-08 **21:27:03.106 UTC**，文件 SHA `faffd1328e48bbc1cd6777eb2ab10deb7c461a5a5537ed897ac28bf10e72f286`。
- independent readback SHA `e995627f19eb029c88ec0b474cdaaed240264ff22d3507c89aed329f9830757f`；outcome `TWO_EXACT_NOLOGIN_CONTROL_ROLES_INDEPENDENTLY_VERIFIED`。

另一个独立进程仅执行 `--mode Verify`，私有目录 `F:/ChatGPT_workshop/techlong-f3b3-control-roles-20261008-b5-verify`：

- 新连接 observation：2026-10-08 **21:27:38.185 UTC**，文件 SHA `8525297ad55418853293b1966f0a3e7660027a5780a35f396f6ad8f0e27459d6`。
- readback outcome/完整poststate一致，readback文件同为 SHA `e995627f19eb029c88ec0b474cdaaed240264ff22d3507c89aed329f9830757f`。readback本身不含时间，所以稳定内容同SHA；上述两个不同时间/文件hash的 observation 证明这不是复制旧收据。

两次观察均为 TLS/Serializable READ ONLY DEFERRABLE，回读原件和全部有效权限，不执行可变helper。不再重新跑审批/管理模拟；本批生产代码未修改，沿用已通过的57项定向、真实PG18 26组、type/lint/语法/build证明。[原安装范围与真实验证](./aws-auto-deployment-fast-track-f3b3-control-role-installation.md)。

## 永久槽位与恢复边界

`F:/ChatGPT_workshop/techlong-f3b3-control-roles-v1-consumed` **已经永久占用**，approved-manifest文件 SHA `551c2c95e1d762ff9a0f73d4c28590c8d1b4dbb7106f20eac89c265db5688a1b` 与用户批准的原manifest文件一致。旧schema/install和registration两个消费slot也仍存在，保持原状。

不能再 Run、刷新角色安装清单重放、复位/删除/重建slot、补GRANT、修改角色、自动down/revoke/drop。后续如需要检查，只在新私有目录用原manifest进行只读 Verify；过期不会恢复写权。此两角色的后续凭据/LOGIN范围是另一个新操作，不是重跑本批安装。

## 下一阶段

准备两个准确角色的随机凭据与 LOGIN、`techlong/sandbox/cell-cleanup-readonly-v3` 和 `techlong/sandbox/cell-drain-control` 的具体 Secret 安装/恢复/失败处置范围，再按 fresh SHA 单独确认；本次批准没有覆盖这些操作，也不覆盖 IAM/Lambda/authority。之后推进专属运行时安装和单Cell/单租户验收。

AWS本轮没有调用；此前只读库存不能当本轮资源新回读。旧镜像/包/PLAN_ONLY/IAM/所有记录保留，Worker/Scheduler/runtime仍关闭，50USD/月预算目标不变，自动AWS部署整体仍未完成。两个仓库main按默认Git授权直接提交推送，服务端仅同步记录，生产源码与镜像未改变。
