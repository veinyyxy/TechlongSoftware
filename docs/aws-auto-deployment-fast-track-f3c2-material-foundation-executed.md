# F3c2：空 baseline / mTLS 基础安装完成

2026-10-11 Winnipeg。用户明确确认新清单 `6b47167066caf637608833497dcd30aa85855f265129c5a15e756b14c517afab` 后，在原有效窗口内一次执行成功；12次直接写调用完成，临时Source标签策略立即删除，两次只读Inspect（第二次为独立新进程）均通过。**未部署Cell、未启用运行时，尚未证明mTLS/数据库/租户端到端可用。**

## 已完成的准确范围

IAM直接写3次：准确Source临时inline策略安装、ELB服务关联角色创建、同一临时inline策略删除。S3直接写8次：新桶、四项安全配置及三对象各一次上传。ELB直接写1次：一次带准确五标签Trust Store创建。共12直接调用，无自动重试、补齐、资源删除或回滚；服务内部操作可能更多，不能视为全部内部写入上限。

Source为 `arn:aws:iam::402010193138:user/techlong-sandbox-dev`，UserId `AIDAV3GNMXTZEO7SHLC2X`，账户 `402010193138`、region `ca-central-1`。ELB服务关联角色 `arn:aws:iam::402010193138:role/aws-service-role/elasticloadbalancing.amazonaws.com/AWSServiceRoleForElasticLoadBalancing`、RoleId `AROAV3GNMXTZNUJ5QVBFD`；其准确AWS管理策略/trust/无inline/无自定义boundary通过核验，角色保留，不属于临时撤回范围。

私有桶 `techlong-sandbox-402010193138-ca-central-1-tenant-baselines`：ca-central-1、BucketOwnerEnforced、四项Public Access Block均true、默认AES256；准确五标签、Deny-only策略、无versioning/lifecycle/replication、全桶仅三对象均实核。策略拒绝非TLS、无If-None-Match:*的Put、对象删除及生命周期/复制/版本修改；管理员仍可改策略，无Object Lock、无S3对象版本ID锁定，不宣称绝对不可篡改。

| 对象 | 准确SHA256 | 字节 |
| --- | --- | --- |
| `approved/1a65288b4628018932a8d9af4658db5702b6cf49966a2032bc2d919bc591d70a/baseline.dump` | `1a65288b4628018932a8d9af4658db5702b6cf49966a2032bc2d919bc591d70a` | 203375 |
| `approved/62b5dc8cadcf276df140be86e002a08b64d9b713bd0257e14ac515c12a996971/baseline.manifest.json` | `62b5dc8cadcf276df140be86e002a08b64d9b713bd0257e14ac515c12a996971` | 26502 |
| `mtls/sha256/e60ee2d18d79c7e28c1e1dae192798ba7e18c5a106dcb5e280c1dd5643d27d5d/ca-bundle.pem` | `e60ee2d18d79c7e28c1e1dae192798ba7e18c5a106dcb5e280c1dd5643d27d5d` | 1497 |

所有对象GetObject回读完整字节并重新计算SHA；HeadObject长度、AES256、metadata/checksum及无版本ID一致。复用原空schema-only baseline/真实PG16验收，没有重导出、恢复或连接数据库。本清单已批准并完成**sandbox材料发布**，不等于批准Aurora恢复、业务数据库写入或运行时激活。

Trust Store `arn:aws:elasticloadbalancing:ca-central-1:402010193138:truststore/techlong-sandbox-control-v1/aa1771fd0469cc44`：创建响应CREATING，后续实际ACTIVE，1CA、0撤销条目、0关联、准确五标签。通过服务返回的S3 URL下载公共导入bundle并复算完整SHA，与本地CA一致；URL仅在内存，不入日志或Git。未创建Listener/ALB、CRL或Private CA，客户端证书/私钥、CA私钥/口令均未上传。客户端CA与公共ACM服务器信任方向分开，未做真实TLS握手验收。

## 撤回、模拟缺口和执行证据

临时inline `TechlongSandboxControlTrustStoreCreateTagsV1` 仅准确创建时标签授权，23:40:08.526UTC记撤回尝试、23:40:10.349UTC记缺失确认；成功之后立即精确删除，没有等待清单到期。两次Inspect均独立确认准确Source该策略缺失，不以时间条件失效替代删除证明；也不宣称账户所有权限都已Locked。若将来需重新安装权限，须新清单另批，不能恢复/重放旧grant。

Review仍是16管理项allowed、AddTags及附加策略模拟implicitDeny，没有改报通过。用户批准的**一次实际准确带标签创建成功**，不解释模拟拒绝原因，不证明撤回后或其它对象/动作允许。没有无标签回退、扩大策略或替换名称。

- 批准manifest SHA：`6b47167066caf637608833497dcd30aa85855f265129c5a15e756b14c517afab`，文件SHA `a7fd3b640ebba8ca03ec80961c31c9fde4e43e55858855fb184423de044bac97`；Review 2026-10-11T23:33:21.359Z，截止 2026-10-12T00:33:21.359Z。
- 七代码绑定：`b6c884c9b5e4e4cc6ddff9556a04ad40876cbaeae9a439bcdbaca32f2b8220d7`，执行前后复算未变。原28定向测试/type/lint准备阶段结果保留，本次仅执行和证据检查，没有改代码、重建镜像或重复整套离线模拟。
- 提交回执：`e62bd45d9369b30df127d1486d00c50072769173286e14f49cd6575ea3fc5492`，failureStage/failureCode/revokeFailureCode均null。
- 首次Inspect：2026-10-11T23:40:17.790Z / Winnipeg18:40:17.790，SHA `05ba06fb9d0aa19c9a0df3547a8a55e65fa473290cea73c9268b550a61755228`。
- 独立新进程Inspect：2026-10-11T23:40:25.594Z / Winnipeg18:40:25.594，SHA `7e37a5f3f70670721d3aac7e64fa3cd138c2f0f55feccc9598cb5cc2e4d167bc`。
- 两Inspect除observedAt外结果完全一致，stable SHA `01530cf7593b28c3488554bfe58ff70111b003feafebb1faf60a6e74e33e62ca`；公共摘要见 [执行证据JSON](../ops/aws-sandbox/reviews/f3c2-material-foundation.executed.json)。

私有Review/Run/独立核验目录分别为 `F:/ChatGPT_workshop/techlong-f3c2-foundation-20261011-r5`、`...-r5-run`、`...-r5-verify`。新永久槽位 `techlong-f3c2-sandbox-material-foundation-v1-consumed` 已消费，25个准确marker保留；**不得再次运行Run或辅助脚本，不自动复位、补齐、删除或重试**。r1–r4、原批准清单、失败目录、旧绑定/槽位、镜像与本地材料均保留；原[待批清单及风险](./aws-auto-deployment-fast-track-f3c2-material-foundation-review.md)为历史记录，不能再当作未执行入口。

## 边界与下一阶段

服务关联角色、桶/三对象、Trust Store继续保留；只删除了上述临时Source policy。50 USD/月仍为预算目标、不是硬上限。沿用已确认清单的请求/存储演示费用模型，不是实际账单证明；现有DNS/Secret及后续资源费用另计，未修改线上Budget10/readcap5。

本次无ACM/DNS/旧IAM/boundary/Secret/Key/Neon/authority/Budget/readcap改动，无Lambda调用、Cell/ECS/RDS/ALB/Listener或Worker激活。两已发布镜像未变，未安装本地Docker。仅元数据与材料字节验收通过，真实mTLS握手、Aurora恢复/迁移、租户ready和清理闭环仍未完成。

下一小阶段准备**专属任务IAM与费用门禁、v3兼容的准确短TTL Cell模板/清理闭环**，复用本批实际RoleId/TrustStoreARN/三对象，避免重复材料探针。旧schema1/PLAN_ONLY清理模板不能直接部署；不得伪造authority/零行/部署ready证据，或提前drain旧历史实例。新AWS权限、Budget/readcap变更及真实付费部署仍按各自fresh SHA和准确资源范围确认；代码提交/推送继续默认授权，两main直接推进。
