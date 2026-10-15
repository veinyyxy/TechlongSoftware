# C5e：Express 控制材料显式重绑定与实时配置接线（待批准）

> **本页已执行，以下是原审批范围/风险历史。** 用户继续后，唯一Run成功，私密来源在内存校验/重绑定后dispose；永久槽已消费，不能重跑下方命令或复用SHA再次读取。没有JWT/控制HTTP或云/数据库写，尚非runtime/ready。当前状态及唯一继续点见[已执行记录](./aws-auto-deployment-aurora-dual-mode-c5e-private-control-executed.md)。

2026-10-15 America/Winnipeg。继续[已完成的16资源计算层](./aws-auto-deployment-aurora-dual-mode-c5d-compute-executed.md)，不恢复空库、不重新seed、不发布镜像、不扩展F3c9。**已完成本阶段代码及真实只读准备，尚未读取私密包、认领owner/epoch或部署应用。**

## 为什么这是部署前置，而不是重新生成密钥

既有本地JWT/mTLS包的历史绑定是旧future deployment `dep_9f0a6951c7e2d244de4fec29`、旧镜像`2af648ae…`、旧plan `c45dafe1…`。它不是现有Express数据库的deployment owner证明。直接让旧loader接受新scope会绕过原保护；重新生成密钥则会增加公钥Secret/TrustStore等变更。本次保留原文件、原Full校验、原密钥和旧记录，明确记录允许的三项变化：新部署ID、已经发布的新镜像、plan内两项物理数据库名称。

实际非私密元数据编译确认目标仍是：

- 新deployment候选 `dep_7c99bd249470184852f0dc74`，尚未登记。
- plan SHA `8690c22f5b4dbf80d49bcee3cdff717dd8ae14957eedb7606b9829b533e49dc8`；配置SHA `06d3cb50dd46b5f32771c356b7e7cd7d524a0707799ae24b9ace0672ef7281c9`。
- 应用registry digest `5e42b2de7e0cc81b1c83a8abb21c866eeedc8801ddf50e686d116a5837caa004`，原已发布生命周期镜像也保持。
- 新scope SHA `71bde6ed93121fcf5480c6bad8add6051548a5d890c8765cdec6e6d364a80e2b`；新owner绑定后的delivery material SHA `db70c7461464910bff782619a2168a99a29adef45e8ab97a4ca2f227bdf17057`。

## 已落地的实际接线

`express-private-control-v1.ts` 先用不改动的Full validator验证原binding及原summary指纹，再显式校验新plan相对原件只改变两项数据库名称，推导并绑定准确新owner/image。纯准备入口不读私密文件；对象须经过进程内验证，序列化副本不能直接调用私密loader。

批准后的实际loader复用**原路径/ACL/summary/binding/RSA3072/mTLS密钥对/指纹校验**，不修改原校验或文件。读取后只暴露限准确app/域名8443的控制端口和非秘密public参数，不暴露旧payment credentials source；可dispose，disposed后禁止委托调用。构造不签JWT、不发HTTP。它只证明本地材料与明确新scope一致，不证明任何已安装owner、Secret内容或应用ready。

`express-control-binding-sources-v1.ts` 已接入真实参数化Neon只读端口：独立回读准确app的配置和发布schema；密码lease前必须回读已存在的准确owner/generation/verified resource/active provision operation、数据库名/角色/Secret/marker等。缺失记录直接拒绝，不能用准备时的JSON代替实时所有权。这里核对的是Neon视图，不声称代替DDB强一致authority核验或跨服务CAS。

`createPreparedExpressFirstDeploymentRuntimeV1.composeLiveControl` 已把新私密端口、实时binding、四键密码来源、mTLS/JWT客户端及编译器连起来；装配不连接数据库，不启动worker或claim/enqueue。旧Full入口/镜像白名单不变。

18项定向检查（新增8项）、类型检查和定向lint通过；没有重跑生产构建或容器构建。fixture只验证分支/参数/失败顺序，不是真实私钥、IAM、SQL、控制HTTP或ready证明。

另外UTC14:26:59.147通过新增适配器**真实执行4条Neon只读SELECT**，实际app配置hash及发布schema hash匹配；verified generation查询在真实schema上运行成功并因owner记录不存在而准确拒绝`EXPRESS_CONTROL_VERIFIED_GENERATION_REQUIRED`。每条在独立READ ONLY事务中，不声称四条共享一个快照。没有以fixture代替这个实际结果，也没有为通过查询而写owner。非秘密结果投影保存在`F:/ChatGPT_workshop/techlong-express-c5e-live-control-bindings-20261015-r1.observed.json`，不冒称原SQL行或stdout字节。

## 真实只读准备与审批材料

最终Review-r2于UTC **2026-10-15 14:21:09.946** 完成。独立C5d Inspect再次核对准确新UUID、CREATE_COMPLETE根事件/token、16物理资源、输出来源、既有IAM及ECS ACTIVE/任务和服务0。另以既有Source和Neon/DDB入口核对七项控制面检查全部true，deployment/job/resource/operation均0、两套authority key均缺失，apply仍0。未连接Aurora重查店铺，C5c store1仍是绑定的历史已执行证据。

- 待确认SHA：`755fc5af86fd7eff9e00f87b17f424c0e8ed2efa5292e1770bac51313e15fe36`。
- 有效至UTC **2026-10-15 16:14:56.246** / Winnipeg **2026-10-15 11:14:56.246 CDT**。过期只准备新清单，不自动重放。
- 执行目录：`F:/ChatGPT_workshop/techlong-express-c5e-private-review-20261015-r2/`，包含manifest、rebind-plan、compute/control-plane、code-binding和result。
- 61项本地源/依赖锁/既有计算层capsule pins，代码binding SHA `267707616e78462c2e80da5790038daac1d04c5de750f954773c39bb518a7066`。
- 新永久槽 `F:/ChatGPT_workshop/techlong-express-c5e-private-control-read-v1.permanent-slot.json` 尚未消费。旧槽全部保留。
- 真实CLI错误SHA `000…000` 已在任何子进程AWS/Neon核验、私密loader或槽消费前拒绝；保留negative-sha输出。r1为较早代码的只读准备，由r2取代，不可批准r1。
- [版本化准备摘要](../ops/aws-sandbox/reviews/aurora-dual-mode-c5e-private-control.prepared.json)绑定14项最终/负例/实际Neon证据。原C5d 53项代码binding保持。

两次Review均只进行元数据读取和Neon只读SELECT；加上新适配器实机检查共6条Neon只读SELECT。当前本阶段云写、Aurora SQL连接、私密包或AWS Secret值读取、token签发、控制HTTP、业务/authority写、新槽消费均0。

## 本次请求批准的准确范围

仅调用一次原本地私密loader，读取 `F:/ChatGPT_workshop/techlong-d001-credentials-20261013-r2/private-material.json`，并复核相同目录原5文件及目录ACL、原公开summary/binding/指纹；在内存构造新Express控制来源后立即dispose。只保存**非秘密**public参数、scope/公钥/证书指纹及结果回执。

该固定文件有8个字段，包含RSA私钥、mTLS私钥/证书/CA及Stripe test输入。虽然本次只需控制材料和publishable key，原文件的Stripe私密字段也会进入原loader内存进行原格式校验；不调用其payment lease，不发送给Stripe，不输出私密字段。不改原文件、ACL、AWS Secret、公钥、IAM或数据库，不生成新密钥。

**明确不批准**：GetSecretValue、JWT签发、mTLS控制HTTP、Stripe API、Aurora SQL、Neon/authority写、owner/epoch/job/TTL、TaskDefinition/Service/RunTask、CFN写、DNS或任何删除。

## 完整风险

1. 私钥及Stripe test私密字段会进入Node进程内存；托管运行时、OS dump/诊断、恶意本地高权限进程可能暴露内容。dispose仅释放持有引用/禁用端口，JavaScript不能保证取证级清零。
2. 目录、文件stat、ACL和元数据检查不是原子打开/CAS；检查后文件或云状态仍可能被并发改变。原检查失败不自动修复ACL、不重新生成材料、不悄悄跳过旧Full guard。
3. 只允许明确的owner ID/image/两物理名称重绑定；这是来源验证，不是已认领owner/epoch、Secret内容、Stripe认证、ECS有效权限或ready证明。不能据此启用apply或写平台ready。
4. 永久槽在调用原loader前消费；即使之后在ACL检查、私密文件读取前或写非秘密回执时失败，也不自动重试、补齐、补偿或复位。成功后同样不能重跑。所有旧文件/记录/槽保留。
5. 本次不新建收费资源，但现有ALB/TrustStore/IP/数据库等继续可能计费。计算层ExpiresAt为Winnipeg11:44:56.246，只是标签、不停机或停费；50 USD/月不是硬cap。清理新栈仍需准确UUID/fresh单独批准。
6. 本包校验成功后会dispose，不持久化私密来源；正式部署时仍需明确批准重新在内存加载及实际云/SQL/业务写范围。不能将这次校验当成后续部署批准。

## 批准后唯一入口

仅确认准确SHA和上述完整范围/风险后运行，不为主进程加载.env.local：

```powershell
node --experimental-strip-types ops/aws-sandbox/scripts/review-express-private-control-v1.mjs `
  --mode Run --manifest F:/ChatGPT_workshop/techlong-express-c5e-private-review-20261015-r2/manifest.json `
  --approved-sha 755fc5af86fd7eff9e00f87b17f424c0e8ed2efa5292e1770bac51313e15fe36 `
  --output F:/ChatGPT_workshop/techlong-express-c5e-private-run-20261015-r1
```

Run先重新核对代码/原材料公开摘要、新计算层及未认领控制面；这些前置核验失败时保存非秘密结果，不消费私密槽或读取私密文件。槽消费后出错则不得重放。成功只输出`PRIVATE_CONTROL_PROVENANCE_REBOUND_NOT_RUNTIME_VERIFIED`，不是部署成功。

下一仍集中同一交付包：把经验证的public参数与实际Cell输出接入7资源workload/DNS，补齐真实first owner/epoch条件写、provision及独立initialized ready/原子回写。此运行时尚无完整live apply/ready root，不提前enqueue启动TTL，不再seed、诊断/恢复、重发ECR或重开F3c9。
