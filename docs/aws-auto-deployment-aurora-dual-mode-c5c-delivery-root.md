# C5c：真实镜像接线及 Express 组合入口（尚未部署）

后续更新：[首次认领接线及默认店铺候选](./aws-auto-deployment-aurora-dual-mode-c5c-first-claim.md)已完成控制面实际只读核对，明确旧futureScope并非已安装owner，并接通新ID的scoped准备入口。以下是上一子阶段交接；当前仍未认领/部署，继续位置以新页面为准。

2026-10-15 America/Winnipeg。继续已完成的[ECR 发布与撤权](./aws-auto-deployment-aurora-dual-mode-c5c-publication-executed.md)，不另开 Grant、SQL 诊断、恢复或 F3c9 支线。当前完成的是**独立 Express 组合入口及真实元数据编译**，不是已经启用的端到端 worker。新资源、旧栈删除、私密读取、业务写入均未执行，也没有新的部署批准清单可供执行。

## 已落地

- `express-delivery-images-v1.ts` 固定实际 registry manifest URI：app `5e42b2de…`、lifecycle `c5ef6cf0…`，源码仍 `8753546772476b018d33b96ab66db4837abde186`，发布 run38682952254。测试逐项比对已执行 capsule；不把 config digest 当 registry digest，不改旧 Full 镜像常量。
- `prepareExpressSingleTenantDeliveryV1` 统一绑定现有租户、template/configuration、环境、Express DB/OID、generation、固定版本四键 Secret、两份镜像及业务预期。构造不读文件、凭据、Secret、SQL 或网络，不认领 epoch，不启用 runtime。
- 原 D001 plan 保留。新候选只显式修订两项物理数据库名：`tenant_9c5ee9e64509dcad_db/role` → 已安装的 `tenant_a0da1748bc4d5419_db/role`。新旧 plan 分别 hash；不是把旧 plan 的 hash 贴在新内容上。此修订尚未写回 Neon、创建 deployment/job，数据库 owner 不因新镜像而自动换人。
- `renderCell` 使用独立16资源计算网络模板，不创建或接管 Express RDS；`renderWorkload` 复用7资源 workload，必须提供准确 active provision fence及六项实际网络输出，绑定四键 Secret 固定版本、TaskRole、当前 epoch 和新镜像。旧 one-shot/五键/Full brand 不接受这些材料。纯参数验证不证明输出的云来源，实际适配器仍须回读准确 Stack UUID/所有权。
- `composeControl` 接上四键密码 lease、独立模板/配置来源和现有 mTLS/JWT 客户端；调用前锁定准确域名/app/owner/generation/DB/epoch，编译前锁定新 plan、镜像、配置及 schema hash。wrong-image、schema drift 在 Secret value 读取前拒绝；错误目标即便在外层拒绝也清除 payload 中密码。
- 模板编译新增**无密钥审阅投影**，无需伪造测试密码来提取业务预期；原执行编译器仍要求真实运行时密码。组合入口仍检查 bootstrap、受认证 initialized、实际 entitlements/themes/store/name、epoch/image/desired hash；bootstrap 200 不是平台 ready。

## 实际验证与边界

本机用三份现有**非私密元数据**实际编译通过；没有加载 `private-material.json`，也没调用旧 private loader。完整候选：`F:/ChatGPT_workshop/techlong-express-delivery-c5c-20261015-r1.review.json`；机器可读摘要见[prepared capsule](../ops/aws-sandbox/reviews/aurora-dual-mode-c5c-delivery.prepared.json)。这些是可重新生成的未批准材料，不是执行槽或旧授权续期。拟保留的 D001 futureScope owner **尚未证明等于已安装 Express 数据库的 owner**。

```powershell
node --experimental-strip-types ops/aws-sandbox/scripts/review-express-single-tenant-delivery.ts `
  --business-review F:/ChatGPT_workshop/techlong-d001-business-review-20261013-r3/manifest.json `
  --legacy-binding F:/ChatGPT_workshop/techlong-d001-credentials-20261013-r2/binding.json `
  --runtime-binding F:/ChatGPT_workshop/techlong-d002-express-c4d-inspect-20261014-r1/runtime-binding.json `
  --render-cell
```

此命令只读取指定三个 JSON、输出 JSON，无 AWS/SQL/Secret value 调用或文件写入；加 `--render-cell` 时使用当前时间生成纯模板，所以候选 deadline/template hash 会变化，不可冒用成旧批准。复现完成后真实资源仍须 fresh 回读，历史元数据不是当前事实。

本轮额外真实 AWS 只读：STS identity、准确旧栈 DescribeStacks、ListStackResources、一次 ValidateTemplate。Source identity 正确；旧栈 UUID `ede4f290-c758-11f1-8050-06ffda7a3477` 仍 `ROLLBACK_COMPLETE`，20条 CFN 资源记录均为 `DELETE_COMPLETE`。这不是逐个底层服务资源不存在或账单为零的独立证明，栈记录仍占名，**未获删除许可**。

AWS ValidateTemplate 已接受生成的16资源 Express 计算网络模板，返回四项参数（AZ A/B、CertificateArn、ControlTrustStoreArn），没有 IAM capabilities。它只验证模板语法/声明，不证明 IAM、证书、TrustStore、容量、配额、清理权限或部署能成功。实际模板保存在 `F:/ChatGPT_workshop/techlong-express-compute-c5c-20261015-r1.template.json`，不是已部署栈；其 deadline 仅是标签，不会自动销毁资源。

54项相关测试（含新组合入口7项）、类型检查、定向 lint 和平台生产构建通过；测试中的 Secret/网络是 fixture，不是真实 Secret/ready 证明。服务端执行源码和已发布镜像不变，双方 main 直接提交/推送；不创建分支，用户 `.vscode/settings.json` 保持。

## 必须纳入主线的初始化前置条件

固定镜像中的 `control_service.js:findProvisioningStore` **只查找现有 active store，缺失时 STORE_NOT_FOUND，不创建店铺**。C4h 历史完整目录核验为业务行0，所以不能假定直接 provision 就能初始化成功。本次没有插入 store、放宽 ready 或重建镜像。

首轮最快路线应在一次具体受审初始化中纳入准确默认店铺 seed（固定 UUID/租户身份、事务、冲突拒绝及独立回读），再由现有受认证 provision 写名称/主题、entitlements 和首位 owner；执行前须确认当前业务状态和准确 SQL 范围。不能让收费 ECS 长期等待一个根本不存在的 store。若未来改为应用自行建店，则须修改/验证/发布新镜像并重新固定 digest；本轮没有选择或授权此项扩展。

## 唯一继续位置

先收尾**一个可受审的主线执行包**，不再 ECR regrant 或 C4 SQL 诊断：

1. 在主线准备中一次只读核对已安装数据库/技术 guard 的实际 owner、generation、业务初始化状态和当前 authority，与新 plan 做显式 adoption；保留旧记录，不伪造 prepared-v2 receipt。补齐准确 scoped queue/epoch 与 ready 原子回写，不把本组合入口称为完整 live root。
2. 准备准确旧失败 Stack UUID 退役、16资源新计算层和监督清理的具体审批材料/执行器；fresh 核对所需现有 IAM，任何缺失权限单列审批。未批准前不 DeleteStack、不创建资源。
3. 由实际 Cell 输出接入7资源 workload、准确 DNS alias、经批准的私密材料读取、默认店铺 seed/provision 和独立有效配置核验，再提交 ready。新的真实读取/写入/部署范围按具体清单批准。

50 USD/月仍只是目标，不是费用硬上限；无自动删除。没有据当前材料安装 IAM、创建/更新 ECS/Cell/DNS、读取 Secret 值、运行 SQL、创建 job/激活/TTL、初始化业务或写 ready；全部旧消费槽与 F3c9 保持。
