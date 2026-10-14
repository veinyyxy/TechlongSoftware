# D002 C1 编码进度：双模式连接核心

2026-10-13 America/Winnipeg；后继[双模式方案](./aws-auto-deployment-aurora-dual-mode.md)。**连接核心已实现并本地验证；C1整体尚未完成，Express实机兼容尚未证明。** 用户本次授权编码，未授权新的IAM/SQL/云创建、删除或激活。

后继进度：独立lifecycle v2任务/只读Fargate准入/角色目录/非发布receipt已接线，仍未实现或放开SQL写。下一先准备最小Express事实核验的受审范围，再依真实引擎/网关/目录完成写适配，C1/C2交叉推进。[本续段准确范围、验证与继续位置](./aws-auto-deployment-aurora-dual-mode-c1-lifecycle.md)。下方第一批继续位置保留历史，不覆盖此后继。

## 已完成的代码

| 位置 | 实际能力 | 不代表 |
| --- | --- | --- |
| 平台 `lib/deployments/execution/aurora-database-v2.ts` | 严格 intent/binding、profile分发、准确dbuser ARN、惰性Express单API创建候选、固定Secret版本ECS配置数据 | 可执行创建清单、已允许IAM或已注册TaskDefinition |
| 双仓 `aurora-database-contract-v2.cjs` / `services/saas/database_contract_v2.cjs` | 同字节v2 wire校验、canonical encoding/digest、Express四键/Full五键Secret校验 | AWS事实、角色授权、activation或完整连接证明 |
| Backend `services/saas/aurora_connections_v2.js` | 动态IAM password callback、五ATS root SPKI身份、ECS metadata凭据来源、固定Secret版本只读来源、固定SELECT连接观察 | 生命周期写provider、SQL权限就绪或客户可用 |
| Backend `services/runtime_config.js` → 现有db config/pool | 显式express_iam分支；Full/local默认路径保留，生产mTLS/JWT等门禁保持 | Worker/admitted root启用或某个部署已ready |
| 双Dockerfile + candidate workflow + 新镜像自检 | 两最终镜像包含新模块；网络关闭、合成凭据下检查真实SDK签名、pg动态password、TLS根和混用拒绝 | 真实IAM认证、SQL恢复、ECR发布或ECS部署 |

代码只在新模块和app配置分支接线，不修改旧Full session/SQL目录校验器、冻结F3c9或已执行的基础创建入口。旧版本仍不能接受Express input，不把新binding当旧authority品牌。

## 本批实现的准确契约

`techlong/database-binding/v2` 包含准确cluster ARN/resourceId/endpoint、port5432、实际engine版本、独立tenant database/user、管理database/user、stableIdentity/generation、runtime Secret ARN/VersionId、TLS trust和profile-specific access。Express access只有IAM/gateway=true以及分开的app/lifecycle role ARN；Full access只有password/gateway=false与managed master Secret ARN，仍固定16.14。未知/额外/混合字段、非sandbox账号/域名、tenant命名不成对或Secret generation错误拒绝。

Secret版本引用采用ECS `arn:json-key::version-id`；SDK只读来源同时要求准确ARN/VersionId/AWSCURRENT。Express只有HMAC/JWT/Stripe四个稳定键，禁止database_url/password/token字段；Full原五键保持。没有生成或读到真实租户Secret，更未派生首位商户密码。

初稿里的 `connectionProofDigest` 不塞进binding本身，避免binding/proof相互哈希循环。当前采用**detached connection observation绑定bindingSha256**，状态为 `CONNECTION_OBSERVED_NOT_LIFECYCLE_VERIFIED` / `lifecycleCompatible=false`；未来完整权限/SQL准入证明须另实现，不能只把false改成true。

## Express app 配置与凭据行为

平台候选输出显式 `PG_DATABASE_PROFILE=express_iam`、canonical `PG_DATABASE_BINDING_V2`、准确 `PG_DATABASE_BINDING_SHA256`、AWS_REGION/TLS标记及pool默认3。`PGSSLROOTCERT=''` 显式覆盖旧Docker ENV中的RDS root路径，实际采用新ATS trust profile，不能让URI或PG变量覆盖TLS配置。

配置构建没有AWS/DB I/O，也不签名。每次建立新物理连接才调用password callback；默认只用ECS `/v2/credentials/...` metadata临时凭据，无本地Login/shared profile、静态access key或EC2 IMDS fallback。拒绝错误源、缺少session token/expiration、无效Date或不足60秒的凭据；SDK/provider异常均脱敏。没有将token缓存为env/Secret/磁盘/receipt，也不承诺JS内存可靠清零。

ATS trust依据[官方五root与SPKI清单](https://www.amazontrust.com/repository/)，从Node bundled roots筛选自签CA并校验签名；不pin leaf/intermediate。TLS必须验证链和hostname/SNI。**这是已实现的候选信任策略，不是Express实际证书链验收**；若真实gateway不兼容，须报告/审阅调整，不改rejectUnauthorized为false。

固定只读观察仅打开管理或应用目标、执行 `BEGIN READ ONLY / SELECT identity / COMMIT`，验证客户端TLS授权/SNI及真实DB/user/session_user/version/OID；后端pg_stat_ssl值独立记录，可以观察null/false，但永不据此签发lifecycle权限。失败关闭准确client并脱敏，无写重试或SQL callback。

## 验证与追溯

- 平台：6新 + 7相邻 = **13项**，typecheck、定向lint零warning通过。
- Backend：9新 + 32相邻 = **41项**，typecheck/syntax、生产 `npm audit` **0漏洞**通过。
- 首次受限沙箱测试中，两项本机HTTP fetch失败；允许localhost后同一回归全部通过，数据库query由测试替换，不连接本地PG或云。未为环境问题修改HTTP测试或业务逻辑。
- 新镜像自检脚本本机通过，真实SDK签名仅用明确合成凭据，不调用AWS。真实Express连接、15分钟会话/新连接、metadata凭据真实轮换、SQL/容量/角色隔离仍未验证。
- 两仓wire source LF归一化SHA `7292fa771b56c09b3d304c3b946e15e561d0a0d68372423d549af9d4cbda1c9c`，同字节；共用合成binding fixture digest `2891614ddb70868794d053bca6fbdd6e8ca53e462c9d0137a01642d68322d751`。后者不是真实部署审批SHA。
- 原5份code binding的172项pin entries全部保持（有重叠，不等于172个独立文件）。Backend用户`.vscode/settings.json`不提交；旧镜像digest及旧批准/记录均保留。

服务端源码提交 `aa6dd1d501afeefd5df2c5d11f09d2d5cdb69f5c` 已推送main。实际push触发[双镜像候选38488816036](https://github.com/veinyyxy/SpeedFeast_Backend_main/actions/runs/38488816036)和[Backend CI38488815977](https://github.com/veinyyxy/SpeedFeast_Backend_main/actions/runs/38488815977)，attempt1；**两个候选job与完整CI的check/docker均独立回读success**，各构建/原容器自检/新增Aurora断网自检/生产依赖与OS安全门禁/导出步骤通过。实际job日志在2026-10-14 00:12:54.823/00:12:58.872 UTC（Winnipeg Oct13 19:12）记录两次新自检：ATS roots5、真实SDK合成签名、混用拒绝、AWS calls0/DB connections0、Express live compatibility=false。

GitHub返回的两候选artifact元数据（**未下载/本机复算整个镜像归档，不是ECR digest或生产镜像证明**）：

| 候选 | artifact ID | GitHub ZIP digest | expiresAt UTC |
| --- | --- | --- | --- |
| app | 11860911967 | `sha256:e1abb910a81e5c44aadcf1360eea17b76f868011798e3c17713dd54c9a3dc7df` | 2026-10-15 00:13:11 |
| lifecycle | 11861205258 | `sha256:4b792c9bcd5c5481618791cc2af7a71cfe4a70276091606d03150b6aad9a1e92` | 2026-10-15 00:13:15 |

两个artifact均绑定准确main/head/38488816036/attempt1。短期候选过期不意味着自动重新构建/发布；后续镜像代码若继续变化，必须重新按准确新源码构建，不提升这次旧候选来冒充新代码。候选工作流仅contents:read、无OIDC/AWS credentials/ECR推送；手动发布/Release工作流未调用。

## 当前仍缺少的主线接线

1. 完整 lifecycle raw input / Secret生成与首位密码来源 / 目录profile / receipt / activation v2；旧PASSWORD SQL、membership/PG16.14指纹不能静默解释为IAM。
2. Express管理权限/新增租户用户网关行为、实际引擎/73表baseline/容量、TLS和会话证明。没有真实cluster，不能填造endpoint/OID或放宽旧检查。
3. Express真实RDS SDK操作/独立readback、account plan服务资格guard、永久journal、准确托管writer/cluster删除及compute模板；当前只生成disabled创建候选，不提供可执行云SHA。
4. 将上述事实接回受审single-tenant live root和worker，保持旧scope/epoch/predecessor/ownership；新的IAM、SQL、云部署和删除各按具体范围另批。

下一继续 **同一C1兼容包的生命周期v2与准入接线**，并集中准备C2需要的实机范围，不开启新的Grant微探针系列，不扩F3c9，不运行过期清单或原已消费Run。当前AWS/IAM/Neon/Secret值/tenant/job/资源创建/删除/部署均0；仅GitHub代码推送和云端候选验证，无ECR发布。50USD/月目标非硬cap不变，账户未升级。
