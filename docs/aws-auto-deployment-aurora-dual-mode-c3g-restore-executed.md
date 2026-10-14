# D002 C3g：Express schema恢复及独立回读通过

2026-10-14 America/Winnipeg。用户针对[准确C3g清单及风险](./aws-auto-deployment-aurora-dual-mode-c3g-owner-compatibility-review.md)明确要求开始后，只执行一次Run，并立即执行一次独立新进程Inspect；两者均为 **SCHEMA_AND_MIGRATION_OBSERVED_NOT_RUNTIME_VERIFIED**。原73表结构、两迁移和九条技术seed的本阶段验收通过；**没有应用登录或ECS/runtime/ready验收**。

批准清单 SHA：`1c0d3371744eecbf9f0346059a0305b4ce365862c4d6615462d524b038965307`。V5双槽已永久消费，即使原清单未过期也不可重放；旧C3f失败报告与V4双槽全部保留。没有写重试、down、权限补齐或自动cleanup。

## 实机结果与证明边界

- 保留准确cluster `techlong-sandbox-express-d001` / `cluster-XBWGLIW2B3HPGX3ROHYJA7CNPM`、PG17.9、原writer和nonce；目标库 **tenant_a0da1748bc4d5419_db / OID16459**、postgres owner/OID16410、app role/OID16456、NOLOGIN/零成员/无提权和guard缺席通过原严格V4 owner checks。无prepare、建库/角色/成员或guard动作。
- 同事务写前EMPTY/目录hash通过：449字节空目录 SHA **56f65c613ba62ada90240b72679ca0323b3e0b8414f85b25f6263d360be5b0d7**，随后一次原固定schema restore和两原迁移。
- baseline实际目录 SHA **868ca1351fc83ae6d202dfc1539345c63b39c21e82c0194bef402b7b3f9e223e** / 741,911字节，与上次C3f被拒绝时实际目录完全相同。V5准确uuid-ossp/1.1/public/rdsadmin admission全部17组通过，其余安全条件不改；旧冻结V3校验仍仅因owner假设拒绝，收据分别保留两种结果，没有改写原目录或假称旧校验通过。
- 迁移后实际目录 SHA **93d3c7eb62bbdd3e38f0a3943c9d44d607b419d562fcbd73ebd2fccf319e876b** / 744,370字节，Run和独立Inspect完全一致，V5 admission均17组通过。73表、7 sequences、196 indexes、15 functions；两原迁移完成，独立回读核对九条技术seed（singleton1/默认entitlement8）及其固定字段/默认值，其余原业务表count0。
- Run在COMMIT确认及提交后owner核对后保存成功OBSERVED/result；独立新进程再回读固定目录、行数、种子和owner，验证此次已提交状态。不读取/导出业务内容，不创建商户账号、店铺登录、deployment/job或authority。
- Run物理库大小12,223,731字节，Inspect为12,322,035字节，均低于512MiB租户门禁。物理size不是精确一致门禁，两次不同不等于目录漂移；不因此推算账单、集群总容量/credit或hard cap。
- 结构pin/ready fingerprint未安装，app login仍false，lifecycleCompatible/runtimeEnabled均false，clusterFreeStorageVerified=false。其它数据库PUBLIC CONNECT、Secret/IAM/Neon/F3c9/生产库/旧Full失败Stack均未改。没有ECR发布、ECS/Cell/Lambda调用或新收费资源创建；唤醒/留存cluster仍可能产生ACU/storage/I/O费用，50USD/月仅目标。

## 时间、计数和永久槽

| 实际观察 | UTC（2026-10-14） | Winnipeg CDT |
| --- | --- | --- |
| Run槽消费 | 16:08:07.137 | 11:08:07.137 |
| restore INTENT | 16:08:29.574 | 11:08:29.574 |
| 写前准确空目录 | 16:08:30.088 | 11:08:30.088 |
| baseline admission | 16:08:34.085 | 11:08:34.085 |
| migrated admission | 16:08:35.515 | 11:08:35.515 |
| 提交后成功OBSERVED | 16:08:35.977 | 11:08:35.977 |
| 独立Inspect槽消费 | 16:08:59.052 | 11:08:59.052 |
| 独立最终目录观察 | 16:09:01.919 | 11:09:01.919 |

Run：2连接/26次pg query/9直接metadata、mutationPerformed=true；Inspect：2连接/17只读query/9metadata、mutationPerformed=false。query数不等于DDL语句数。两者AWS资源写0，无自动重试，两新槽均永久消费，所有旧槽不复位。

## 私有安全收据字节SHA256

Run目录 `F:/ChatGPT_workshop/techlong-d002-express-c3g-run-20261014-r1`，Inspect目录 `F:/ChatGPT_workshop/techlong-d002-express-c3g-inspect-20261014-r1`。这里只记录非秘密安全摘要；原归档、定义、IAM token、credential和业务内容不上传。

| 文件 | SHA256 |
| --- | --- |
| Run prepared.json（原准确C3d证明） | `59d8b5af4ab581fcc26d194346eb24917d5aa21735f6c0127e0e91d671c86d0a` |
| Run result.json | `3ec0a90c18920a0625a5857f05b4b1d86da483f9e1915ef718b122a72894fd00` |
| Run schema.json | `a45ce4d91726190ae98b43281988e5e26184dde3b61293a4b1574a791da605ec` |
| Run stages.jsonl | `db9e0e9105fca395cf64a00bc500e98e97e3d0c4804fe48defeef63900d6fc68` |
| Run catalog-empty-before-write.json | `ade32106f31eb8dc137f6db696a532a04131fa2c698b0b19d270f00d2e08347d` |
| Run catalog-baseline-before-verifier.json | `ac64ee11f78f4219229e3f53d08a589d8aca2953ad71e3a89d3ef909e2502ce9` |
| Run catalog-migrated-before-verifier.json | `9cd4f1d68aa552359b130ee570c5d63d5f00bb4031efe5b77dd83120357a7beb` |
| Inspect result.json | `f7040b664ce600c521dd37af9140941bd48de4fc66568538b878ab28cbccce03` |
| Inspect schema.json | `f1e71c4fd6ab7f882b78bd4d0cc7d91f5c2580069e5f731671ba14eaf94e0276` |
| Inspect stages.jsonl | `97da7073cf1ea225c5de8c617e026597f299ebff7c4eddf1f6a7784116c891fb` |
| Inspect catalog-independent-final.json | `9a93c4f72bde5cb35a9f4b0ad33200e6f68d01060d996451cbb5b242214e1ab2` |
| V5 Run永久槽 | `52ed41f01de5988093a3939ef68cd85f06cf44279dd20d7ac1907e8f2238311a` |
| V5 Inspect永久槽 | `69865304f48d1f9807e88330a09d971322090a6678e41603d7b1793d5dc7bcc9` |

236源码/两工具/13历史证据绑定在两进程均核对，code binding **d588ae8af11d72d606506b8cdcecc5aa1c613c6a0e432357c370bb6444f90dc2**，history **192bf08034227f6ff9c8af2f4ded972adc92ea1bcc324d0c318388dfe6310b2e**。原archive/private brand真实编译、原SQL/两迁移/角色policy保持，新program **4468b84cbc553812ab143561ad72011cf294ebff2e4185d9422b7eac1033e982**，catalogPolicy **5bc73bb1e9f094a67bd4bf06bb8972d88f6cc84449734e21c99c915c79e148f2**。Backend执行源12400d4和已通过的CI/双镜像保持，本轮只结果文档，不改源码、不重复测试/构建/ECR；用户.vscode不提交。

## 唯一后继：应用登录/运行时接线的待审准备

停止C3恢复/目录诊断循环，不再重跑空库恢复，也不建库/角色/guard或回Grant/F3c9。下阶段只准备将这个已验收数据库接到首轮单租户应用的窄方案：准确app角色的最小权限与IAM登录、Secret-v2配置、PG17运行时/ready门禁接线及对应受审清单。必须保持Express IAM与Full password快速切换边界，不能把本次catalog digest自动转成旧v2 ready凭据。

实际数据库LOGIN/rds_iam/授权、Secret/IAM写、ECR发布与ECS/Cell启动仍需各自fresh具体范围批准；本次恢复确认不覆盖它们。先完成应用接线候选和必要只读核对，再按具体清单推进部署，不新增同类探针代次。

[紧凑真实结果和继续位置](../ops/aws-sandbox/reviews/aurora-express-c3g-restore-only.executed.json) · [原范围/风险（历史，已消费）](./aws-auto-deployment-aurora-dual-mode-c3g-owner-compatibility-review.md)
