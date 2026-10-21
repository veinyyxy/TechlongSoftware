# W7a：平台管理端 AWS 托管的 Node 容器候选

## 本阶段只验证可运行工件

用户要求先完成自动部署、最终整套系统在 AWS 上线，不使用 Sites，不安装本地 Docker Desktop。W6w 已通过的是一个 sandbox 租户的独立云端验收，并不是平台管理端已在 AWS 运行。

本阶段的最小目标：**把现有管理端编译为可在 Node 容器运行的候选，并用 GitHub Actions 实际构建、自检。** 不创建或发布 ECR 镜像、不改 IAM/Neon/Secret/DNS、不运行 ECS，不读真实私钥或 `.env`，不启用请求登记/部署控制器/worker/支付能力。代码按既有授权直接提交推送。

## 已发现的实际差距与取舍

根 `vite.config.ts` 当前显式加载 Cloudflare Vite 插件、Sites打包插件及 `.openai/hosting.json`。数据库、认证、支付和部署管理模块直接导入 `cloudflare:workers`；Node不能把这种原生Worker绑定当作普通模块解析。不能只加Dockerfile然后宣称已兼容AWS。

保留根构建及已发布81/76云闭包、package/lock和W6工作流不变；新增独立配置 `ops/platform-hosting-v1/config.mjs`，使用工程已锁定的 vinext0.0.50/Vite8，而不是升级到网站当前版本。它用编译期服务端alias映射现有绑定导入，复用页面、认证、Neon适配器和既有健康API，不改它们的业务实现。浏览器导入该适配器时构建失败。

vinext官方说明其Node服务与自托管输出可用，但不同部署目标支持程度不同；本项目是否可用必须以实际镜像和HTTP检查为准，不把文档支持当作验收。[官方说明](https://github.com/cloudflare/vinext/blob/main/README.md)；具体API以仓库安装版本的 `VinextOptions` 和 `vinext/server/prod-server` 为准。

## 工程文件与工作流

- `contract.mjs`：构建环境白名单、运行端关闭门禁、端口与参数检查。
- `bindings.mjs`：仅Node候选使用；只允许惰性读取 `DATABASE_URL`/`AUTH_SESSION_DAYS`，没有D1/R2模拟，不暴露Stripe/App/controller凭据。任务登记、worker、apply和controller绑定固定关闭。
- `config.mjs`/`build.mjs`：独立Vite API多环境构建，输出 `dist-platform/`；禁用根配置加载，dotenv目录固定为空。编译发生在白名单环境的子进程；直接调用子模式仍严格拒绝多余环境项。首批构建只在CI/Docker内运行，不覆盖本机既有dist或启动服务。
- `start.mjs`：直接加载锁定的Node production server，不调用会自动发现dotenv的vinext CLI；拒绝未受审控制凭据、Stripe密钥、AWS静态凭据、TLS关闭或代理信任配置；支持SIGTERM/SIGINT限时停止。
- `Dockerfile`：复用租户镜像已采用的准确Node24.18.0/bookworm-slim digest；非root、独立构建层、准确COPY。vinext目前在devDependencies，为避免改旧闭包，首候选保留锁定node_modules，不声称镜像已最小化或通过完整漏洞验收。
- `Dockerfile.dockerignore`：源码白名单，拒绝dotenv、PEM/key、node_modules及git元数据。CI另外用 `git archive HEAD` 创建准确已提交源码上下文；本地未跟踪/忽略的私密文件不会进入Docker上下文。
- `.github/workflows/platform-hosting-candidate.yml`：只有contents:read，无OIDC/环境/Secret/发布/部署权限。编译需下载公开npm/镜像/字体依赖，但容器HTTP验收使用 `--network none --read-only`、64MB临时目录、去除Linux capabilities、no-new-privileges、1GB内存限制；不发布端口。
- `smoke.mjs`：容器内部访问准确loopback的既有健康API、登录页及其全部本地JS/CSS引用（最多40项）、匿名admin跳转、匿名管理API401和静态favicon。不发送认证/业务POST、Cookie或真实凭据；没有数据库URL，不能连接生产Neon。
- `tests/platform-hosting-v1.test.mjs`：26项本机静态/配置/门禁检查，包括隔离子进程中真实Vite/vinext合并后的client输出断言，并计算原云闭包摘要确认不变；真实编译和镜像HTTP结果由CI单独确认。

## 能证明与不能证明

CI通过可证明这份准确源码构建出的Linux/amd64容器能以非root、只读根目录运行，匿名页面/健康/访问保护及静态资源在Node路径可用。不证明真实数据库、登录会话写入、租户隔离、管理业务、支付、公开HTTPS/代理头、并发负载、跨副本Server Actions或平台自动部署控制器已经在AWS验收。

既有 `/api/health` 仍是原响应契约，只表示进程/路由存活，不探测数据库，不等同业务就绪。候选明确拒绝代理信任配置；在真实ALB HTTPS上线前必须按准确域名和代理边界另行接线并测试，不能跳过Secure Cookie/Origin/Host核验。

本候选禁用Stripe及部署控制器是初次托管验收范围，不是删除已实现功能。正常管理端数据库仍复用现有Neon；不把平台DB迁移到租户Aurora。以后接入数据库Secret/正常登录属于真实凭据供给及认证写入范围，需要先审核，不能偷偷复用Source登录或窄controller凭据当平台数据库owner。

首轮云CI39625194760（源码deafb2a）实际构建成功，健康/登录/访问保护通过，但favicon检查404，故整轮失败、未通过验收。日志确认安装版本的App Router忽略`clientOutDir`而写到`dist/client`，候选只复制`dist-platform`，因此漏静态资源。修正为Vite显式client环境输出目录，并扩大页面JS/CSS检查；保留失败记录，不重跑旧run，而由新提交的正常CI验证。没有因此改业务源、依赖或云权限。

## 下一阶段的最小资源方案（提案，不是授权）

优先沿用现有ECR/ECS/Fargate操作经验，工件可以复用，不先引入另一套托管产品/部署适配器。具体资源布局和费用还未核对，**本阶段不生成可执行云清单**。

| 项目 | 首轮候选范围 | 必须先核对 |
| --- | --- | --- |
| 域名 | 建议 `console.sandbox.techlong.cloud`；生产以后考虑 `console.techlong.cloud` | 已委派sandbox区、名称占用、证书与公开CT风险 |
| 镜像 | 独立平台ECR仓库/准确digest；GitHub Actions构建 | 新窄OIDC发布授权，不复用旧一次发布许可 |
| 承载 | 一个独立平台ECS服务、一任务；先按0.5vCPU/1GB评估 | 区域/cluster/VPC/subnet、并发容量、稳定生命周期 |
| 网络/HTTPS | ALB listener/target group、准确入口安全组、ACM、DNS | 可否安全复用持久基础设施；不绑租户Cell的TTL/清理链 |
| 凭据 | 一份平台web专用数据库凭据/Secret，task execution role仅取准确Secret | 现有平台DB真实权限、最小列/表写能力、不能使用窄controller role替代 |
| 运行权限 | 首轮web无AWS任务角色权限，不配App私钥 | hosted controller将来另审，不能移植30分钟loopback许可为长期云许可 |
| 日志 | 独立日志组、短保留、错误脱敏 | 登录/SQL/DSN/请求体不得进入日志；镜像漏洞与依赖收口 |
| 成本 | 50USD/月仍是整个项目目标，不是新增平台的额度 | 既有Cell/Aurora/ALB/IPv4/Secret成本、平台增量和峰值，不能保证硬停费 |

Fargate按请求的CPU/内存等计费，ALB还存在自身的小时/容量等费用；不能只算容器然后承诺低于50USD。[Fargate官方计价](https://aws.amazon.com/fargate/pricing/)，[负载均衡官方计价](https://aws.amazon.com/elasticloadbalancing/pricing/)。实际审批前必须取得ca-central-1准确价格及现有资源只读清单，分别列增量/全项目月估算和短期验收上限；本页没有伪造区域报价。

先确认镜像CI，再只读准备这个最小资源与费用清单。若现有基础设施受租户TTL控制，不直接复用；若新增常驻资源使总成本超过目标，先向用户说明并调整验收时长或资源布局，不静默扩大预算。实际新增IAM、Secret供给、ECR发布及云部署仍按准确资源和fresh SHA分别确认。

## 追溯和保护

W6w旧验收、W6x核心与W6y单次Inspect入口均保留原源锚点和已消费槽；不会因为平台Node构建而重发旧job、迁移平台账本证明或重放旧批准。新代码进入工程，外部目录只保留私密材料/证据/检查点。无本地Docker安装、Sites发布、套餐升级或新分支。
