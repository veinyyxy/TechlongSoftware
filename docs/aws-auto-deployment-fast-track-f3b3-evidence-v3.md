# F3b3：v3 新鲜证据与完整候选/计划绑定完成，未启用运行时

2026-10-08 Winnipeg。完成上一小阶段指定的 freshness/admission/authority/deletion 证据适配与版本化候选接线。平台代码提交 `e4a615b69223b09a7c5e2595fffc39e06d00d26a` 已推送 main。**本轮完成的是只读证据和 prepared plan，不是云 authority 安装、可执行 DeleteStack 入口或自动部署上线；F3b3 尚未整体完成。**

## 实现与边界

新增 `sealed-cell-cleanup-evidence-v3.ts`，两个独立适配器不实现旧 schema2/Janitor 的零租户接口，也不把 schema3 降级后交给旧删除 core。

- `SealedCellAuthorityOwnershipEvidenceAdapterV3` 先固定并严格验证完整 provision_verified schema2 前驱，再读取完整 v3 证书型快照。继承已有 provision/drain lineage 是保留真实前驱，不是降级 ownership 证据。DB 时间不能在未来或超过 30 秒；读取/哈希期间的主机时钟回退、总耗时超限、Cell 未到期、准入 fence/provision hash/准确 Stack ARN/expiry 不匹配均拒绝。五类分类集合必须真实为零，缺失 source 不合成零。
- source 返回深度冻结的对象并在私有 WeakSet 标记来源；独立证据与候选也有进程内 provenance。JSON 回执或对象副本不能作为新的 live proof、Stack 证据或候选。它不是替代数据库权限或可信 SQL client 的密码学证明，也不是可恢复的持久 authority decoder。
- `compileSealedCellCleanupAuthorityCandidateV3` 要求新证据及既有可信 Stack collector 的品牌，准确重现前驱 Stack/status/expiry/CF role/template/inventory，使用独立 `sealed-cell-cleanup-authority-v3`、`sealed-cell-ttl-v3:cell:cell-sandbox-1` 与固定专属 Executor role，不开放 caller/role override。cleanup epoch 严格增大、revision 增一，窗口最多一小时。完整前驱、Stack 证据、所有证书与 raw witness 都进入候选 SHA；安装许可固定 false。
- `SealedCellDeletionOwnershipEvidenceAdapterV3.prepareFreshDeletionPlan` 在候选窗口内再次独立读取真实 Serializable/readOnly/deferrable 快照，检查零集合、新鲜性、同一 drain 及完整 state/hash 不漂移。分类集合仍为零但原始 active/association 集合改变也拒绝。新 `sealed-cell-deletion-plan-v3` SHA 保留完整候选和 ownership state，固定 STANDARD/无 retain。只有 DB 观测时间和传输元数据不进入稳定 state hash，sealed_at、fence changed/expiry 等状态时间仍被绑定。

两个适配器没有云写/删除方法；返回 mutationAuthorized/runtimeActivationAuthorized=false。没有持久化候选、安装 v3 authority、修改现有 journal 或 root，也没有从旧 v2 authority 构造真实 v3 删除授权。旧 schema2 source、旧 Janitor、dedicated-v2 core/root/SDK 和永久消费 slot 保持不变；现有严格 1/1 规划门禁没有因本轮代码变为线上零。

## 验证

25 项隔离/source/v3 定向检查及 173 项相邻 authority/cleanup/drain 回归通过，typecheck、定向 lint、PowerShell AST 与 production build 通过。新增 10 项 v3 测试涵盖完整证书 pin 逐字段改变 SHA、第二次读取的 raw drift、五类非零集合、伪造 provenance、未来/过期/回退时钟、准确 fence/window、取消和安全错误归一化，以及旧协议不接受新 source。

[真实 PG18 run 37809750133](https://github.com/veinyyxy/TechlongSoftware/actions/runs/37809750133)，head `e4a615b69223b09a7c5e2595fffc39e06d00d26a`、attempt1 success，复用固定官方 PostgreSQL18.6 镜像及原 C088 SQL 候选，共16组证明。新证明实际使用受限 cleanup_reader 读取数据库：future 未密封部署阻止候选；fixture 清理到零后，完整证书和原始旧记录绑定到候选及第二次读出的 prepared plan。**CI Stack collector 证据是明确的合成 fixture，不是 AWS Stack/authority/CAS/DeleteStack 验收。**

独立 reader 新增 `-RequireV3EvidencePlanProof`，必须16个唯一 proof、两个准确新增 proof 名称、原 SQL SHA、准确 head/run/main/attempt/success、所有未安装边界及固定 image/DB drop/容器 stopped。私有目录 `F:/ChatGPT_workshop/techlong-f3b3-pg18-ci-20261008-a3`：

- raw ZIP SHA `b059e532403ac4329841b31bfa7cd056253c326ea96f487ea7b9e69ec0dbe0e4`，与 GitHub artifact digest 匹配。
- report SHA `68d6e6e46e7bcffc8060c99fea937f1170ae16c3bf0935978228d8c64d2c324c`。
- receipt SHA `ab9822bb7251bb050e443f837acf1f25a81167ecd12aed31b1c5deb7fcd3b99a`。
- 独立 verification SHA `cc095754a758bbca781bc24eff5f8fc48d75a0b669b70d4a55e0855662656585`。

仅清理 CI 自己的随机合成数据库及绑定服务容器，不涉及用户数据；原件保留在私有目录不提交 Git。没有连接 Neon、调用 AWS/Lambda、上传 baseline、重建 app/lifecycle 镜像或新 Lambda 包。服务端生产代码及镜像 pin 不变，仅同步本进度。

## 下一小阶段与继续位置

1. 准备生产密封安装/登记审批入口：只读核对 Neon 准确 schema/owner/最小角色及完整业务 preimage，编制 fresh 精确范围；实现不自动迁移、不自动登记的受审入口和独立提交后证书回读。SQL 安装和准确单行永久登记各需单独确认，不能以本轮 CI 或设计 SHA 代替。
2. v3 仍需持久 authority 的严格解码/CAS、永久一次性 journal 与独立 root 接线，再构建新版包；必须携带完整证书/raw state、拒绝旧 v2 record 和重放，不能把当前进程内 candidate 当生产 authority。新包未完成前不安装旧 v2 包来处理 v3。
3. 专属 IAM/Secret/Lambda/authority/schedule、DNS/mTLS/baseline 及真实 Cell 继续分别批准具体变更范围；Worker/Scheduler 默认关闭，50 USD/月目标和旧 Budget 保持。保存所有历史记录、镜像、产物和 slot。

未授权资源范围记录：`ops/aws-sandbox/reviews/f3b3-sealed-evidence-v3.prepared.json`。两个 main 按默认授权直接提交推送，不创建分支。
