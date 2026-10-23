# W8g：两小时 AWS 托管控制入口部署审查

本阶段只把已发布镜像接到既有 AWS 承载方案。准备、代码提交和 CI 不等于部署授权；实际执行以新的原始清单 SHA 单独确认。镜像不重新构建或发布，不增加 IAM，不重开 F3c9、Sites、窄屏退出按钮或旧租户验收支线。

## 准确资源与变化

账户 `402010193138`，区域 `ca-central-1`，Source 为既有 `techlong-sandbox-dev`。部署入口为工程内 `ops/platform-hosted-deploy-v6/local.mjs`，不在 F 盘增加可执行包装。仅一次 `CreateStack`，SDK 单尝试、`DisableRollback=true`、20分钟 CloudFormation 创建超时；不发 Create/Execute Change Set，不设置 service role，不安装权限。

准确栈名 `techlong-sandbox-platform-hosting-v1`。W7r 已删除旧 UUID `2d7d45a0-ced0-11f1-acc8-0effedbce869`；本次是新的托管控制入口验收，不是重试 W7q 或复活旧 UUID。执行前按名称无在用栈、旧准确栈 DELETE_COMPLETE、名称/网络/证书/执行权限/镜像元数据均匹配才可消费新永久槽。允许保留准确family的已知旧任务定义`:1`和`:2`，且只能INACTIVE或已消失；ACTIVE、删除中、分页不明或任何其它版本仍阻断，绝不删除这些历史记录。新建返回的完整栈 ARN 必须记录，后续清理只能另审这个新 UUID。旧原件和已消费槽全部保留。

沿用原11个逻辑资源：TaskSecurityGroup、AlbSecurityGroup、TaskIngress、LogGroup、Cluster、LoadBalancer、TargetGroup、HttpsListener、TaskDefinition、Service、DnsRecord。两安全组仅443公网入 ALB、ALB到3000任务、任务443出网；既有 VPC `vpc-011dab69fff93972b`、两公网子网、sandbox Zone `Z01473621BTTHKXBGOOEJ`、ACM证书 `6d1f2880-9f83-449c-930a-6b17516ef49d`。公网域名固定 `https://console.sandbox.techlong.cloud`。不创建 NAT、数据库、Secret、角色、boundary 或 task role。

单 Fargate Linux/amd64 task，0.5 vCPU、1 GiB、平台1.4.0、desired=1；执行角色仍 `TechlongSandboxPlatformWebExecutionRoleV1` / RoleId `AROAV3GNMXTZJ45S2ANZ7`，W8d boundary v2/原inline/trust 不变。无 ECS Exec。日志保留7天、非阻塞；任务可写根文件系统与原已验收配置相同，不在本次改变容器权限模型。

唯一镜像：`402010193138.dkr.ecr.ca-central-1.amazonaws.com/techlong-sandbox-platform-web@sha256:ad3cbde847375967a1eb0d593e39d9faefcb742c64ba87aa3abb463b9c534789`。其config为 `sha256:c418fef9c5146ef1fcdb39f88cb28ffe2d50a8b89f64ce94f6c8f463f6924230`，实际源码 `f3cea2da7d26dfc09726c4cbc52cab40217340c6`，不是操作器最新文档提交。原镜像仍保留；不因 GitHub archive 到期而重发。

显式命令 `node ops/platform-hosting-v1/start.mjs --hosted-controller`。三个 ECS 管理注入均绑定准确ARN、JSON键与固定版本：

| 环境变量 | Secret完整名称后缀 / JSON键 | 版本 |
| --- | --- | --- |
| DATABASE_URL | `techlong/sandbox/platform-web/neon-v1-UfFKVF` / databaseUrl | `6ea2ca59-9a24-4f3e-b16f-ec824f32bc5f` |
| TECHLONG_PLATFORM_CONTROLLER_DATABASE_URL | `techlong/sandbox/platform-controller/neon-v6-M4A08E` / databaseUrl | `3574f24e-ecb3-476c-8f71-baa501fd129e` |
| TECHLONG_PLATFORM_CONTROLLER_PRIVATE_KEY | `techlong/sandbox/platform-controller/github-app-v6-C58FqK` / privateKey | `0aee41e2-c4c3-4d4d-afca-9e68f66cd379` |

ARN前缀统一为 `arn:aws:secretsmanager:ca-central-1:402010193138:secret:`。安装器不读取 Secret 值或原 PEM；**本次实际部署授权必须包括 ECS 在任务启动前读取这三个私密版本并注入容器**，不能称私密读取为零。AWS ECS/负载均衡自动健康检查可产生请求；本地/Source 不发应用 HTTP、SQL、App JWT/token 或 GitHub workflow 调度。JSON键选择不是IAM字段级隔离。

## 租约和人工窗口

原始清单人工审核有效48小时，最晚开始时间提前30分钟，避免用户刚获知就过期。执行前仍重新只读核对，不扩大批准范围。真正控制租约在最后权限核对之后、CreateStack意图落盘时才生成，绑定发布镜像源码和已安装的 V6 release SHA，最长30分钟；两小时承载意图也从该时刻起算。创建、拉取镜像和健康检查会消耗控制时间，不承诺就绪后仍有30分钟。

租约到期仅关闭控制能力，不退出 Web、不停止/缩容 ECS、不销毁资源、不撤销IAM/数据库LOGIN、不抹除已返回字符串或在途令牌；不自动续租。任务晚启动时可能因租约过期拒绝启动，服务仍可能重启并重新读取Secret。两小时标签不会自动停止收费。后续管理员真实登录、创建请求、批准 Review/RunOnce/Inspect及调度分别审查，本次不替用户点击，也不推断业务验收成功。

## 完整风险

1. **收费及持续运行。** Fargate、ALB/LCU、公网IPv4、日志、ECR、Secrets及已有资源可计费；50 USD/月是目标不是硬上限。准备清单从 AWS ca-central-1 官方 offer 文件重新取价，示例按一task、一ALB、0.1平均LCU、三公网IPv4计算。两小时示例不含数据库/旧资源、ECR、日志、传输、额外地址/容量、启动/删除耗时、重启/重叠、税费；不承诺总费用或停止时间。未另批清理前资源继续计费。费用结构参见 [Fargate](https://aws.amazon.com/fargate/pricing/)、[ALB](https://aws.amazon.com/elasticloadbalancing/pricing/)、[IPv4](https://aws.amazon.com/vpc/pricing/)。
2. **非原子和并发。** 元数据快照不是跨服务CAS；其它操作者可在检查后更改资源/策略/Secret。只比较固定RoleId/版本/模板不能消除此竞态。单次CreateStack会引发多次底层资源创建及托管Secret读取，不能承诺总AWS写入只有一次或私密读取只有三次。IAM传播、服务端自动行为不受本地单尝试计数控制。
3. **公开暴露和凭据。** HTTPS域名可公开访问；DNS/证书/访问日志等可公开或被提供者保存。已有管理员账号可登录；登录通常有会话数据库写入，此项后续另批。固定版本注入的数据库密码及App私钥进入容器环境，ECS在应用校验前读取，替换任务可再次读取。环境变量、调试/日志、内存、缓存CryptoKey/令牌、进程崩溃或供应商日志均有泄露/残留风险；不声称可可靠擦除。元数据不能证明私钥仍与GitHub登记匹配，真实签发/调度尚未验收。
4. **部分失败与永久槽。** 新槽 `F:/ChatGPT_workshop/techlong-platform-hosted-deploy-v6.intent.json` 独占写入后永久占用。ACK丢失、时钟回拨、凭据失效、局部安装、健康检查失败/超时、证据写入失败都不自动重新Create、不补齐、回滚、删除、复位或换槽重试。可能留下收费资源、公开端点、日志及私密注入任务。DisableRollback可留下部分栈；部署circuit breaker保留Rollback=false。只读Inspect不能把失败变成新的写入许可。
5. **恢复与清理边界。** 允许独立客户端/独立进程只读核验准确新栈、11资源、SG/DNS/监听器、任务镜像/命令/租约/Secret版本、执行权限和健康状态；这些不是端到端控制验收。没有Create ACK时先报告不明状态，不按名称臆造成功，不自动重试；进一步精确恢复另审。清理另按新准确栈ARN和全资源清单确认，可能删除本轮日志/临时任务数据且不可恢复，不属于本次授权。旧栈、租户、数据库、Secret、IAM、镜像均不在删除范围。

## 工程入口与继续点

`Prepare <F:/ChatGPT_workshop/techlong-hosted-deploy-review-*.json> <准确CI run ID>`：仅读取现有AWS元数据、官方价格和准确CI；不读私密值、不消费槽。`RunReviewed <同一原件> <用户批准SHA>`：仅在新确认后执行一次。`Inspect <同一原件> <同一SHA>`：允许过期后独立元数据核验，不授权写重试。复用旧承载模板、W8d精确权限验证与同一已安装controller binding，不新增工作负载执行器。

顺序：通过无AWS针对性CI → 生成新48小时清单 → 人工批准准确SHA及本完整风险 → 单次承载部署及独立Inspect → 分别审核真实控制功能验收/准确新栈清理。此前的镜像发布或供给批准不覆盖本次部署。
