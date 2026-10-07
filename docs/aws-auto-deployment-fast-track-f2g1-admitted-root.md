# F2g1：生产admission与CLI root代码接通，尚未云启用

2026-10-07。本阶段完成受审后端入口、准确artifact loading、owned-session/receipt围栏和平台新协议材料编译；真实本地PG与Actions构建通过。**没有安装权限或runtime descriptor，没有发布新候选或部署ECS/Cell。** 50USD/月目标与fresh云批准边界不变。

## 新入口与可信来源

服务端 `tenant_lifecycle_admission.js` 默认实际AWS SDK，只使用STS GetCallerIdentity、ECS DescribeTasks/DescribeTaskDefinition、DynamoDB GetItem；没有Put/Update/Delete/RunTask。固定account402010193138/ca-central-1、cell-sandbox-1和 `TechlongSandboxTenantLifecycleTaskRole`。

只有同时证明实际任务角色、Fargate metadata/current task、准确TaskDefinition/两个roles、registry digest、明确Node/prepared entrypoint、uid65532/readonly filesystem、唯一匿名scratch volume，才能取得进程内opaque capability。环境只能提供定位数据；布尔flag、profile/key/endpoint/TLS/proxy/Node injection设置、任意metadata URL都拒绝。采用固定Fargate metadata地址，限制响应/取消；Fargate隔离仍是信任前提，不适用于EC2共享host。[AWS task role与隔离说明](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-iam-roles.html)、[metadata v4](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-metadata-endpoint-v4.html)

固定table `techlong-sandbox-tenant-external-epoch-authority`：

- 新 `runtime:cell-sandbox-1:lifecycle-v2` 为**未部署读取契约**，外层schema_version2、固定purpose、active状态、canonical JSON、revision及最多6h窗口，至少180s余量；绑定Cell management target、TaskDefinition/image与准确已批准baseline S3 sources、receipt v2。尚无writer/installer，不把record存在视为本阶段已验证。
- 既有 `tenant:<full platform hash>` 仍使用schema_version1、强一致GetItem，准确校验generation/epoch/intent/ownerDeploymentId/operationHash/marker以及cleanup predecessor；不改变旧CAS row schema或写入namespace。
- 平台full ownership hash与服务端SQL scope hash是不同概念。新 `TENANT_RESOURCE_IDENTITY_JSON` 携带五个immutable ownership字段和物理引用，重算平台canonical hash、校对完整authority key/prefix、logical Secret派生、Cell与目标；另绑定 `TENANT_OWNER_DEPLOYMENT_ID`。不能仅相信一个相同前缀或把SQL hash当平台hash。

runtime record需要未来单独受审安装和IAM限制写入者，不能让普通任务写自己的准入记录。当前实现只证明读/校验代码，不证明云上签发权限、record provenance或lease仍有效。[强一致GetItem](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_GetItem.html)

## 执行链

`tenant_lifecycle_admitted_root.js`：capability精确绑定parsed task；先重验admission和receipt目标，准确旧v2 receipt直接返回，不重开artifact/Secret/SQL。缺少receipt才从固定approved baseline key读取：ExpectedBucketOwner、FULL_OBJECT checksum、ContentLength、实际bytes SHA和上限全部校验；不接受任意URI/本地mount，也没有上传私有baseline。

准确archive/manifest再走既有offline compiler与进程内brand，才构造固定CA/Secret/PG owned-session composition。SQL query以及receipt read/publish前后都强读准入与epoch并比较原immutable revision/record；漂移停止，保留durable recovery证据。每个query都受控不是跨系统原子事务：Get与SQL commit之间仍有分布式时序，必须在F3验证真实lease loss/并发/回滚/cleanup，不声称全局TOCTOU已消除。

prepared main支持受审运行模式，但默认CMD仍 `--check-bundle`。没有真实record和live task proof仍失败关闭；旧 `db/tenant_lifecycle.js` inspect/destroy能力不扩展。复用共享120秒deadline与5秒hard-abort；stdout只有固定成功字串，错误只输出受限code，不输出SQL/Secret/actor provider原诊断。Dockerfile显式声明 `/tmp/tenant-lifecycle` 卷以保留image-owned目录；实际Fargate初始化/uid权限仍需真实task验收。

平台 `tenant-lifecycle-prepared-contract.ts` 定义**单参数CMD `[operation]`**（Node/script已在image ENTRYPOINT），编译full identity/owner参数；旧full Node/script command vectors原封不动。该compiler不产生ready或启动任务，当前旧runner/SDK仍拒绝新协议。下一切片必须显式接入prepared-v2并绑定receipt v2，不能把compiler存在当成已可自动运行。

## 验证证据

- 41项backend相邻测试：旧inspect/destroy与watchdog、RDS源、prepared composition及9项新admission检查通过。源snapshot指针可变导致的测试失败已改为独立deep clone/freeze，stale revision拒绝通过。
- 6项平台contract/旧binding测试、两仓typecheck与定向lint通过；新test已纳入平台aggregate test。npm生产audit各级0。
- 最终root在隔离PG16.14/TLS、非superuser cell_admin上通过prepare→restore→migrate→SQL/app login、immutable receipt响应丢失恢复、重放不重开、active业务状态不覆盖、取消与正常cleanup；独立只读进程回读通过，server已停止。**AWS admission/S3/CA endpoint transport是明确local override；compiler复用本轮已真实编译的品牌program，不是实际S3→Fargate在线证明。**
- 私有final目录 `F:/ChatGPT_workshop/techlong-pg16-admitted-root-20261007-f2g2`，`sessions-receipt.json` SHA `989d41483417eeb5ffafa7324ebe5f5e83b5d31b55bad2dda26c9770e86c198b`，realAwsAdmissionVerified/rdsEndpointVerified/baselineApproved/runtimeEnabled均false；首轮f2g1证据保留。
- 最终源 `19cc3e096df4d37be0a6570ce3116d47c472ace2`，[完整Backend CI37702693776](https://github.com/veinyyxy/SpeedFeast_Backend_main/actions/runs/37702693776)与[双镜像build/self-check37702693753](https://github.com/veinyyxy/SpeedFeast_Backend_main/actions/runs/37702693753)实际success，Trivy14/32个OS包，HIGH0/CRITICAL0。源码首批f86d6d2的两run也保留，最终以owner-binding源19cc3e0为准。

## 新候选，不是新ECR镜像

| kind | image config digest（不是registry digest） | checked artifact ID |
| --- | --- | --- |
| app | `sha256:75140a5e88550b04f458e2aa2c1b6b7b4326dc1225e11d8491dc2f440ac63206` | 11518805418 |
| lifecycle | `sha256:8cd975a2f73c11e4363ef5fbf298416323f2723a24a68738e72dfdf273342d9e` | 11518715844 |

ZIP SHA app `8e2a9499479f7a906a5fa93f2278fcedddba07cf0cda5fe9dbca6db52aceeca5`、lifecycle `4788ac20ab98edf2185296ed0ee1ba0be0b41be551d35394eb8844a208316574`。app最早温尼伯2026-10-08 **18:31:29 CDT**（23:31:29Z）过期，lifecycle晚4秒；过期不延长或重放。

小receipt日志SHA app `3045edb91d97f3941d7f21a9527661fddc0ae19f913ca42f4ed9493bbd5ff186`、lifecycle `55461648da1d7a265a36343a0651f9a832c164bc6aab7a1d3cc174c12eb0fb8a`。私有日志/REST metadata index `F:/ChatGPT_workshop/techlong-admitted-root-candidate-index-20261007.json` SHA `8da909ad09dba7702772796658924118a5e66d54785e70c8e8dbe2ec28550d24`；本阶段没有下载原ZIP/receipt或Docker加载，不声称已完成promotion校验。

Source结束只读Inspect仍Locked/v4/UPDATE_COMPLETE，旧ECR发布镜像不改。没有IAM、DDB/S3/Neon/源PG15写入、新镜像发布、付费Cell、ECS任务或Worker启用，没有本地Docker安装。

下一小阶段先完成平台runner/SDK显式prepared-v2与schema2配置接线、未安装runtime descriptor/TaskDefinition候选及最小权限审阅。新root镜像发布、私有baseline批准/上传、runtime record安装、权限与真实付费验收各按fresh资源/变更范围确认；需明确CloudFormation旧IAM版本清理副作用。真实Fargate metadata/卷/credentials、DDB读cap与延迟、跨系统lease/TTL/cleanup/mTLS和50USD预算仍是F3门禁，不能从本地或build-only通过推导runtime ready。
