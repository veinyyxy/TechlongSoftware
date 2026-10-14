# D002 C3c实际：只读诊断成功，定位应用角色creator授权假设不匹配

2026-10-14 America/Winnipeg。用户确认待审SHA `25dce03675001fc6ff269cb5a0322a63d9baca9f2c5125ee6d462eef5d5918d2` 及[完整风险/固定查询范围](./aws-auto-deployment-aurora-dual-mode-c3-role-diagnostic.md)，原冻结入口仅Run一次。11:13:40.053 UTC / Winnipeg06:13:40.053 CDT诊断槽消费，11:14:02.985 UTC / Winnipeg06:14:02.985 CDT观察完成；**1个SQL连接、5条固定query、SQL与AWS资源写均0**。Run退出0，查询/分析完成，不是再次安装失败。

## 当前可复现的拒绝条件

| 准确角色 | 真实目录 | 原reserve校验 |
| --- | --- | --- |
| app `tenant_a0da1748bc4d5419_role` / OID16456 | NOLOGIN/NOINHERIT/无提权、无settings/config/owner/parent，ownership匹配；**memberCount=0** | 要求1–2条管理成员且至少一条ADMIN，因此 `members_one_or_two`、`some_admin` 两项拒绝；其余22项通过 |
| guard `tl_prepare_96c4e91750c441e3aab2de2609f7f029` / OID16457 | 同样受限、ownership匹配；**memberCount=1**，成员postgres/OID16410，grantor rdsadmin/OID10，ADMIN/INHERIT/SET均true | 全部24项通过 |

两角色父关系均0，成员/父关系列表未截断；准确租户库仍不存在。管理creator INHERIT/CREATEROLE均true，`createrole_self_grant` 当前值为空字符串。这里是本集群的实测事实，不推广为所有PostgreSQL/Aurora的默认行为或其它身份的授权能力。

冻结原 `verifyStage(...,'reserve')` 原样返回 `AURORA_V3_BOOTSTRAP_ROLE_CHANGED`。只读诊断结果为 `RESERVE_PREDICATES_REJECTED_NOW_NOT_ORIGINAL_CAUSE_PROVED`，不是运行时/ready证据。

原catalog完整SHA仍为 `d4aa1330a48212824bba726b8c550d5523aedb009f3b1956948cc734ade147b8`，**与C3b失败后独立Inspect的catalog SHA相同**；新关系/context SHA `20afac6ed40c8670becc68e86d167cf38390f77378475cf81194d85bebe931ea`。这提供了跨时点一致证据，支持“原校验依赖了本集群并不存在的app自动管理成员授权”这一解释。原Run包装丢弃了底层错误/具体拒绝条件，所以仍不唯一倒填当时异常，`originalFailureConditionProved=false`如实保留；不是以当前SELECT成功证明过去无连接/journal故障。

## 独立后置元数据与证据

新进程InspectMetadata于11:14:24.297 UTC核对Source、准确cluster/writer/PG17.9/历史tags/scaling/gateway、FREE-ACTIVE与connect模拟，5次直接只读、SQL0，与原binding一致。结论仍为 `PHYSICAL_ONLY_ROLE_STATE_NOT_REOBSERVED`，不伪装第二次SQL目录检查。原诊断Run自身已做前后9次直接metadata；没有追加SQL连接或重试。

| 私有证据 | 文件字节SHA256 |
| --- | --- |
| `F:/ChatGPT_workshop/techlong-d002-express-c3-role-run-20261014-r1/observation.json` | `3fc01d30b67e583f5654acbe5d2b4baa9cff70bf113a8abbf45fd04c90602d6c` |
| 同Run目录 `result.json` | `bd805e58b2a73e8ad0966638bd1971ba25c0a0d6078f4fe6de201547cf3b4873` |
| `F:/ChatGPT_workshop/techlong-d002-express-c3-role-diagnostic-v1.permanent-slot.json` | `f6e0d9d0e07e18f095c5226aac9f1e90c42b55bef00db7dafef220caf20d7678` |
| `F:/ChatGPT_workshop/techlong-d002-express-c3-role-metadata-20261014-r2/facts.json` | `2fc84648e3791d2007655c8281884868a0ffd09769851c95a5e9a5d2490a7637` |

212 code entries/原210与183历史entries、code binding `dc5d99e0e5e86171e6e13cfa65cbd3855f48529ea5a5bf6acf1afc3555c8ab9e` 保持。本轮不改执行源码，不再测试/重编译archive/构建镜像/ECR发布。两角色、旧两安装/Inspect槽、历史、Full/F3c9和用户Backend `.vscode/settings.json`保持；新诊断槽已永久消费，不能重放，即使原6小时窗口未结束。集群继续保留可能计费，50USD目标非硬cap，未安装自动cleanup。

## 最窄的后继方向——尚未实施或授权写入

建议保留真实两角色/OID/nonce，针对**NOLOGIN准备阶段**建立严格的实际目录模型：app必须零members/parents且原全部无提权/ownership/OID条件不变；guard必须准确唯一postgres/rdsadmin授权及ADMIN/INHERIT/SET全部true。不是宽泛接受任意成员，也不为迎合旧校验而额外给app安装ADMIN权限。应用LOGIN/rds_iam及业务授权是后续不同阶段，仍另行审阅。

实现准确“已reserve”后继入口，从当前角色与库不存在的事实开始，仅推进原quarantine建库、promotion及固定73表恢复/两迁移；不能重放CREATE ROLE/reserve，不能伪造原成功prepared回执或把原槽复位。需要同时替换prepare和restore的角色目录校验：现有 `aurora_express_restore_v3.js` 的owners核对也导入同一个旧 `verifyStage`，只跳过prepare检查仍会再次拒绝。旧执行pins/根保留，新增窄版本/具体新SHA再批准实际写入。

**下一步只编码这一准确续建/恢复候选及待审清单。** 无需再开一次相同角色诊断或扩大Grant/F3c9；不删除/改名堆叠角色、不重建cluster，不为旧模型增加无必要权限。新建库/guard删除/schema/迁移/独立新尝试槽均按明确新范围fresh批准；本次“确认”只覆盖已完成的只读诊断，不授权后续写。[紧凑接续摘要](../ops/aws-sandbox/reviews/aurora-express-c3c-role-diagnostic.prepared.json)。
