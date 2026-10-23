# W8c：托管控制器最小接入范围

## 结论与本轮事实

2026-10-23 08:55:11–08:55:14 CDT（13:55:11–13:55:14Z）完成一次集中元数据核对。Source身份有效，无需重新登录；原始记录位于 `F:/ChatGPT_workshop/techlong-platform-hosted-inventory-w8c-20261023.json`，SHA256为 `0c65862be1346c3e8375efeab51c7a988c0d80b7202dc28c24ec6c223562c6b1`。[公开事实索引](../ops/aws-sandbox/reviews/platform-hosted-controller-w8c.inventory.json)和[具体接入计划](../ops/aws-sandbox/reviews/platform-hosted-controller-w8c.plan.json)均不包含私密值。

本轮为准备，不是安装或部署。集中快照31项AWS元数据操作，另有一次Source STS预检及一次KMS DescribeKey；Secret值、PEM内容、SQL连接、AWS写入、GitHub调度和执行槽消费均为0。本机只查看了原PEM的文件属性，未打开、哈希或验证其内容。两次准备命令在本地解析/依赖加载阶段退出、尚未发出AWS请求，随后改用现有cloud-worker依赖完成核对；没有安装新依赖。快照不是跨服务原子状态，执行前必须重新比对。

| 对象 | 当前已核对状态 | 最小后续变化 |
| --- | --- | --- |
| Web数据库Secret `techlong/sandbox/platform-web/neon-v1` | 唯一固定版本 `6ea2ca59-9a24-4f3e-b16f-ec824f32bc5f`；Source/原execution role读取，Source管理 | 保持内容、版本、策略不变 |
| 控制器数据库Secret `techlong/sandbox/platform-controller/neon-v6` | 唯一固定版本 `3574f24e-ecb3-476c-8f71-baa501fd129e`；仍仅Source读取/管理 | 仅为既有execution role增加读取例外；不重设数据库密码或LOGIN |
| 拟用App私钥Secret `techlong/sandbox/platform-controller/github-app-v6` | 准确名称不存在 | 新建这一项Secret，受审读取本地既有PEM一次并保存固定版本 |
| `TechlongSandboxPlatformWebExecutionRoleV1` | RoleId `AROAV3GNMXTZJ45S2ANZ7`；原ECS trust、单inline、boundary v1及无managed attachment均匹配 | 原boundary和inline仅追加上述两项控制凭据的准确读取/转发解密；不新建角色或TaskRole |
| `TechlongSandboxPlatformImagePublisherV2` | RoleId `AROAV3GNMXTZID6CJJBA2`；trust无Allow、inline显式Deny全部ECR；boundary v1保持 | 复用原临时Grant→单次发布→立即Revoke流程，不改仓库范围 |
| ECR `techlong-sandbox-platform-web` | IMMUTABLE；目前仅有旧W7j镜像 `sha256:81fb8157fd9dcf834204a3b0c866d3fc8071386a4cbc1ff71f2ccac992ed4612` | 发布W8b已验收候选，不能把旧镜像误作托管控制器镜像 |
| 平台承载栈 | 按原准确名称查询不存在 | 后续另审同域名、同网络的两小时受控承载；本轮不创建 |

发布角色的inline不等于其允许发布的boundary，这是上次撤权后的**预期Locked状态**，不是需要修复的漂移。原access栈仍CREATE_COMPLETE、仅两项IAM资源；publisher栈UPDATE_COMPLETE、仅原角色。现有AWS-managed `aws/secretsmanager` Key为 `3af8de5c-dbb7-451a-83f3-983fb1673570`、Enabled；控制器Secret未返回KmsKeyId符合默认AWS-managed Key行为，不应误判为未加密（[AWS说明](https://docs.aws.amazon.com/secretsmanager/latest/userguide/security-encryption.html)）。未调用Decrypt。

## 收敛后的实施顺序

1. **准备一次固定范围的供给安装入口和镜像发布适配。** 复用原execution身份/CloudFormation模板和原镜像publisher；只把新App Secret、已有控制器Secret的策略例外及两项固定版本权限接上。原发布代码硬编码旧W7j候选，不能直接重放旧Prepare/RunReviewed；应绑定W8b的已验收源码和artifact，保留旧槽。新入口经针对性验证后，生成具体SHA，实际执行再确认。不要为此重建整个应用镜像、重装数据库/身份或重复已完成的容器验收。
2. **分别按具体SHA批准并执行供给安装、单次镜像发布。** 可集中准备材料，但不把一个批准扩大为另一个范围。供给不创建ECS；镜像发布结束无论成功失败都立即按既有流程撤权并独立核验Locked。安装后的Secret/权限不会因镜像发布失败自动删除或回滚。
3. **再审两小时AWS托管验收。** 绑定真实新镜像digest、真实Secret ARN/版本和公开租约后，沿用原11项承载资源、固定 `https://console.sandbox.techlong.cloud`、0.5 vCPU/1 GiB单task及既有网络/证书。先证明真实托管控制器接入，再按新任务/计划分别批准Review→RunOnce→Inspect；既有租户部署证明仍有效，不重复做身份探针。实际登录、业务请求、App签发/调度或租户建栈不由本轮元数据核对授权。

W8b镜像源 `f3cea2da7d26dfc09726c4cbc52cab40217340c6` / [CI39960583333](https://github.com/veinyyxy/TechlongSoftware/actions/runs/39960583333)已完成18步；本轮再次只读查询artifact12503974340仍未过期，大小307773703字节、摘要 `sha256:12f027cccd21d955c5a0c4db9b6f536606749028c0a1fdcc8d09f95279265723`。到期为 **2026-10-26 08:24:09 CDT（13:24:09Z）**。尚未下载并独立封验镜像二进制/receipt，registry manifest digest未知；不能把GitHub artifact ZIP摘要当成镜像digest。发布前必须完成原有字节、配置及安全门禁；若产物实际失效，再准备新候选，不自动重跑或沿用旧批准。

## 下一份供给清单必须精确包含的范围

- 新App Secret先空建、设Source-only读取/管理保护，再受审读取现有本地PEM一次、验证RSA格式/强度并写入一个预先绑定的版本。这三次值安装写入之后，最终接入还需一次该Secret的读取例外策略写入，**新App Secret合计最多四写**；不生成/轮换/删除GitHub key、不签JWT、不向GitHub申请token。安装程序不通过GetSecretValue回读，独立检查仅看版本/策略元数据，因此不冒充真实签名或App端验证。
- AWS会生成ARN随机后缀，当前不能给出其真实ARN。执行清单应明确接受“准确名称/account/region的新建返回ARN”这一受限派生，之后IAM仅用该**完整准确ARN**，不使用名称通配符；若不满足就停止，不能换Secret、补齐或重试。该派生以及新版本UUID、文件属性/ACL、源码、完整风险都须绑定到最终SHA，本计划不预授权它们。
- 新Secret的最终读取例外为Source和原execution role；管理仍仅Source。已有控制器Secret同样只扩读取例外，原管理Deny和Web Secret原策略不变。IAM只向原boundary及inline追加每项Secret的单独GetSecretValue和准确Key/SecretARN/SecretVersionId/Secrets Manager ViaService的Decrypt条件，避免把两组ARN与版本放进数组形成交叉组合。保留原ECR拉取/日志/Web Secret权限及ECS trust。
- 原access栈仅更新两项已有IAM逻辑资源，不创建身份、不改trust或TaskRole，不附加AWS managed policy。供给安装的拟议顶层写调用总数为七：新App Secret四写、原控制器Secret策略一写、原access栈Create/Execute Change Set两写；CloudFormation可能进行多次底层IAM写及维护/删除旧policy version，不承诺这些底层写也只有两次。最终源码验证、准确diff、顺序和风险必须在执行清单列明；本轮没有Create Change Set或IAM写入。
- ECS注入：Web `DATABASE_URL`仍取Web Secret的 `databaseUrl`；控制器URL取原控制器Secret的 `databaseUrl`；私钥取新Secret的 `privateKey`。三者均指定完整ARN、JSON键和固定版本，不跟随AWSCURRENT。ECS Linux1.4.0支持此格式（[AWS说明](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-secrets-manager.html)）。JSON字段选择不是IAM字段级隔离，具有GetSecretValue权限的主体仍可能读取该版本完整内容。

## 必须沿用的风险与执行边界

私钥将新增AWS托管副本。Secret创建/策略/IAM是跨服务非原子过程，IAM传播及并发不可由快照消除；可能遗留空Secret、已存私钥、部分读取权限或收费资源。Secret内容不进模板、Git、日志、产物或聊天；元数据核对不能证明云端私钥与GitHub登记key匹配。失败不自动删除、撤权、down、补齐、复位或重试；精确写入前后及独立核验位置应保存。

ECS在启动前读Secret，不因应用惰性getter而推迟；任务替换也可能再次读取，不能承诺一次部署只读一次。环境变量、日志/调试工具、已返回字符串/CryptoKey及在途token有暴露/残留风险。30分钟控制租约到期只关控制能力，不停止Web、收费、IAM权限或数据库LOGIN；不能保证撤回在途操作。两小时标签不自动销毁，清理仍以新栈UUID另批。50USD/月仍是预算目标而非硬上限；新增Secret本身也收费（[官方价格示例](https://aws.amazon.com/secrets-manager/pricing/)为0.40USD/Secret/月，API另计，实际账单依地区/用量/税费等）。承载费用需按最终资源另估，不用旧试验数字冒充新报价。

保留W7r全部原件及已消费槽，禁止重放旧Create/Delete。原81/76云执行闭包、已发布binding及业务数据保持；不重开F3c9、不新增执行器、不修用户已排除的窄屏退出按钮。本阶段只落文档和公开元数据，不改应用/构建/工作流，因此不重复运行87项测试或构建新的镜像。

**本计划没有可执行SHA、没有安装器执行授权。** 唯一继续点是第1项的最小入口/发布适配及其针对性验证，然后生成可执行的具体清单；不能把本计划文件的内容哈希当成运行批准。
