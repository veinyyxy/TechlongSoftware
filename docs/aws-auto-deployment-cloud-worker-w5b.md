# W5b：SDK云读取、W4c沿革与最小控制材料候选

2026-10-17。继续自动部署主线，不扩F3c9，不发布Sites；50 USD/月仍是目标，不是硬停费保证。本阶段**只交付云adapter/公开材料及最小控制Secret接口，不安装资源、不调用真实AWS/Neon/租户应用、不读取Secret值或原私密包**。

## 已编码的实际增量

- `ops/cloud-worker/aws-initialized-workload-v5.mjs`：从已验证的W3资源/健康观察逻辑派生独立cloud variant。保留Cell/容量、CFN/task IAM原文、固定Secret元数据、ECR digest/scan、Aurora元数据、DNS/mTLS、Janitor、epoch、准确前驱退役、七资源UUID、task实际digest和target健康检查。所有原CLI读取改为SDK（辅助allowlist共12种读取），没有shell/AWS Login/profile。唯一部署副作用仍是准确一次CreateStack，并非本阶段获准执行。
- `cloud-session-v5.mjs`：必须显式传入短期ASIA/session token/expiry provider；过期或解析失败不走默认凭据链。STS核对新专属role ARN、安装后才可确定的RoleId和准确`Deploy-<runId>-<attempt>`，拒绝Source IAM User/镜像发布role/外来session。独立Inspect也重新验身份。
- `cloud-aws-reads-v5.mjs`：13个SDK client固定AWS endpoint、区域/全局签名区域、maxAttempts=1。辅助读取无paginator，错误净化；仅准确target group missing可视为缺失。Lambda配置响应会在内存经过SDK，传回上层前剔除Environment等不用字段，不保存原始响应；不能声称服务端根本没返回潜在敏感配置。
- `ops/cloud-worker/package*.json`：独立精确SDK版本与lock，不动根package/lock、旧W3/W4原件或99 pins；nested node_modules独立忽略。新增RDS SDK模型已确认具备Express的InternetAccessGatewayEnabled/VPCNetworkingEnabled字段。
- `cloud-context-v5.mjs` + `material/public-capsule-v5.json`：从已校验的公开原件打包必要配置/历史IAM基线及**W4c :5/aa96**成功receipt/provider。固定receipt SHA、provider observation重算及全capsule SHA，不是把旧W4的:4前驱改成任意配置。重建仍得到material SHA `8fa2b5c1…da0313`。该历史证明不代替当前退役/namespace检查。
- `cloud-control-v5.mjs`：只接受7字段的JWT/mTLS材料，校验3072-bit RSA匹配、CA/客户端链/用途/有效期及独立公开指纹；固定app/host/issuer/audience/scope，最多2个60秒JWT、readiness→control各一次GET。无POST/密码/支付/数据库接口。Secret读取固定完整ARN+VersionId、AWSCURRENT、最多一次、消费前置hook在读取前调用；丢回执/失败不重读。实际root仍须把hook绑定W5a永久journal，不是回调接口本身证明已经消费云槽。

公开capsule SHA：`5c7e5eeff2febef52b469487e0bd7d170e711fb2b26e3df81162b5b46c6e2e14`。其中没有私钥、JWT、Stripe secret/webhook、DSN、用户密码或本机目录；Stripe publishable key是已有的公开配置。原整包和原业务记录保留，不上传/迁移/重新读取其私密值。

`prepare-public-capsule-v5.mjs`是**仅本地公开历史打包器**，会核对旧99 pins并读取固定公开metadata/回执，不进入云runtime依赖闭包。云端直接读已提交capsule，不访问F盘。旧source witness raw SHA原样保存；新runtime的跨平台闭包显式CRLF→LF规范化并标注normalizedLfSha256，不伪称等于旧Windows raw pin。根package中的历史脚本只做依赖metadata哈希，不执行；安装依赖必须ignore-scripts。

## 检查入口与验证

```powershell
npm ci --prefix ops/cloud-worker --ignore-scripts --no-audit --no-fund
node --experimental-strip-types ops/cloud-worker/check-runtime-v5.mjs --mode CheckRuntime
node --experimental-strip-types ops/cloud-worker/check-runtime-v5.mjs --mode CheckBundle
node scripts/ci/check-cloud-worker-closure-v5.mjs
```

入口只有CheckRuntime/CheckBundle，**没有Review/RunOnce/Inspect云执行模式**，没有dispatch/OIDC exchange/installer或queue poller；不能将库函数存在当成自动部署已启用。

本地新12项加journal8/W4相邻9项共29项通过；测试使用自生成一次性证书与真实RSA签验，检查材料/指纹/域名/方法/版本/顺序及重试阻断，没有使用真实控制密钥或发送租户GET。Windows沙箱曾阻止OpenSSL命名对象，随后仅对自有fixture测试提权重跑通过，临时密钥目录已按准确前缀删除；不是放宽生产证书规则。完整typecheck/定向lint通过，独立依赖audit为0 HIGH/CRITICAL，旧99 raw pins仍通过。

`.github/workflows/cloud-worker-candidate.yml`在干净Linux runner安装两套锁定依赖，运行20项新云/journal测试和8项W4纯逻辑回归、真实fixture crypto、runtime/capsule/60文件本地源码闭包检查；**contents:read、无OIDC/AWS凭据/仓库Secret**。不会调用真实provider或Secret loader。旧W4的1项Windows本机CLI测试仅在Windows的29项中验证，Linux明确排除该项，**新V5入口测试不排除**。首轮run 39071674100因错误地附跑旧CLI测试而失败（旧CLI加载E盘backend package），未修改旧码或放宽其限制；更正CI范围后另跑新提交。最终云CI结论及原件摘要以随后准确run记录为准，不把HTTP替身/本地fixture宣称为真实AWS权限/TLS部署验收。

## 具体待安装材料边界（尚未批准）

候选新role：`arn:aws:iam::402010193138:role/TechlongSandboxGitHubDeploymentWorkerRole`。不借用image publisher。RoleId未知，不能占位通过实际身份核验。OIDC trust必须限定本仓受保护部署environment，部署workflow/commit及environment分支与审批规则一起审阅；Environment subject不是天然的单workflow限制。[GitHub官方OIDC说明](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws)与[SDK显式凭据说明](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/migrate-credential-providers.html)已核对。

候选控制Secret名：`techlong/sandbox/deployment-worker/control-first-acceptance-v1`。完整ARN随机后缀、VersionId尚不存在，**此处不是创建清单**。未来经过单独批准，仅把现有控制用5项PEM加schema/app打成新最小版本；不复制旧整包中的Stripe材料，不自动轮换或改现有租户公钥。

Neon连接必须单独最小DB角色/独立Secret。**本阶段没有创建该角色、导出/上传现有owner/admin DSN或实现其租户权限隔离**，不能因为控制Secret接口已有就把平台管理员连接传给Actions。DB领取/原子完成的准确行范围、只读Review权限及未知状态处置需绑定最终执行根并集中审批。

未来每次真正Run仍要新的准确held job、有效清单、云role/table ID/固定Secret version、fresh IAM/前驱退役/namespace/lease/epoch、两GET及原子回执/独立Inspect。历史到期不等于已经清理，原W4到期和父Cell费用边界不变；本阶段未查实时云状态。

## 唯一下一步：W5执行根收口，不再增加观察器切片

直接将已有W5a journal、V5 provider、最小control loader与W4同job持久层接到**一个**准确job的Review→明确批准→Run→独立Inspect入口；同时完成最小Neon角色/连接材料的代码合同和公开回执保存。W4c是首轮链根，不是永远唯一的最新前驱；后续应接续已独立核验的成功回执，不能设计成每部署一次就改源码/重打包起点。W5b已完成的SDK/crypto/lineage不重复验收，不再引入一套generation/Grant流程。

接线后一次列出新OIDC角色及精确策略、W5a专属表、最小DB角色/两个Secret、公开不可变执行材料/回执位置和成本风险，再按fresh SHA批准安装/材料迁移及首次实际云运行。该资源清单尚未生成，本轮不需刷新Source或交出密码；仅在确需只读核对安装材料时再请求刷新。
