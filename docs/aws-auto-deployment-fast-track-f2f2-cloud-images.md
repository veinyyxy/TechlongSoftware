# F2f 第二批：GitHub Actions 真实镜像构建与受审 ECR 发布准备

后续：2026-10-07 原清单已获批准并单次实际执行，两镜像均已进入ECR，但lifecycle扫描有HIGH/CRITICAL，整体门禁失败；Source已立即撤权并独立证明Locked。见 [实际执行与安全收尾](./aws-auto-deployment-fast-track-f2f3-ecr-scan-blocked.md)。下文保留批准前状态，不再作为新的创建/发布授权或重试入口。

2026-10-07：按用户选择，不安装本地 Docker Desktop/WSL，改用 GitHub Actions 标准云端 runner。应用与 lifecycle 的 linux/amd64 镜像均已真实构建、自检成功；ECR 发布工具与精确清单准备完毕，**尚未安装 AWS 权限、推送 ECR 或运行 ECS**。

## 实际通过的运行

- 候选源提交：`acc8ae648119e8ad5cca98b8af1907eef09bf213`。
- [两类候选构建与隔离自检 37662382372](https://github.com/veinyyxy/SpeedFeast_Backend_main/actions/runs/37662382372)：两个 job 均 success。
- [同源完整 Backend CI 37662382268](https://github.com/veinyyxy/SpeedFeast_Backend_main/actions/runs/37662382268)：success。
- 应用：非 root/Node24.18.0/linux/amd64，容器 network none；health=200，数据库不可用时 ready=503。后者是拒绝误报 ready 的证据，不是可用租户证明。
- lifecycle：非 root/read-only/network none，固定 CA/SQL bundle；真实 PG16.14 合成五表空结构 dump/TOC/render/严格 profile compiler 在容器内通过，Python 和 libpq 动态库可用。合成结构不读取或批准私有 73 表 baseline；真实 verify CLI 仍以 `TENANT_PREPARED_STANDALONE_DISABLED` 拒绝。
- Debian `16.14-1.pgdg12+1` 包装版本现按精确 PG16.14 解析；不接受 PG15、16.15 或任意后缀。前两次失败运行保留，未创建下一代 IAM Grant。
- 修复现有依赖范围内的六项 npm 生产依赖 advisory，package.json 不变；新版 lock 的 npm audit 报告 0，完整 CI 与容器 smoke 通过。这不是操作系统 CVE 或 ECR 扫描结果。

工作流 `backend-image-candidate.yml` 只有 contents:read，没有 OIDC/AWS Secret/registry write；固定 action commit、25 分钟/job。导出精确 checked image 与三份小校验文件，只保留一天，不上传数据库目录、私有 schema/archive、Secret 或构建 cache。

## 精确候选

以下是 **image config digest**，不是 registry manifest digest：

| kind | GitHub artifact ID | image config digest | receipt bytes SHA |
| --- | --- | --- | --- |
| app | 11500584446 | `sha256:8a9638e792f0a8b4446ddf34c9c7f9e64bf9d246610a424055f6110e579c7d22` | `1e54047dff34ab5253b675d4f92ae3762b4fd93920aebdbd02b018abee99940b` |
| lifecycle | 11501637024 | `sha256:0e5667f5d6dc02eebb16f32af205f16f00c92cf30f99d4e767f28876299b2ea3` | `dbb5cd13a77e26a383229c0d7b36d1b58590488b40eee78c9f5ec1af97dd2cd2` |

ZIP 原始 digest、准确名称、有效期和不可变目标 tag 均已绑定服务端 `deployment/reviewed-ecr-publication.json`。最终只读 REST 回读证明原 run success、两个 artifact 未过期且 pins 相同；未把这次回读称作 artifact 下载/加载或 ECR 验证。

## AWS 只读现状

Source 已刷新，准确账号 `402010193138`，IAM User `techlong-sandbox-dev`。它当前属于 Administrators/AdministratorAccess，没有 user boundary；新权限可由明确批准的 Source 直接 CloudFormation 安装路径处理，不修改历史 Provisioner/Manager/execution boundaries。仍需执行前重验会话、名称和具体变更；这是现状，不是新增权限批准。

- ca-central-1 现有仓库 `techlong-sandbox-speedfeast`：IMMUTABLE、scanOnPush=true、AES256；registry BASIC。设置不更改。
- GitHub OIDC provider 已存在，不重建或更新。
- 原 `SpeedFeastBackendDeployRole` 绑定 production environment，仅授权另一个 `speedfeast-backend` 仓库；不扩权或复用。
- 新专用 publisher role、managed boundary、新栈 `techlong-sandbox-github-image-publication` 均 absent。
- sandbox `cell-sandbox-1` MISSING；不能因本账户有其他生产部署而误判 sandbox 已可部署。

## 待确认的唯一 ECR 变更范围

清单 SHA（UTF-8、CRLF 规范成 LF 后 SHA256）：

`ce32e46450cd18f382d67de843eeaf208be9421beed80dc7cb94ed6d335abc10`

截止：**2026-10-08 17:40:00 UTC**。此截止早于两个候选的实际 artifact expiry；失效后不延长旧政策、不自动重放，需重新构建并重新批准。

批准这一清单意味着：

1. Source 在准确新栈中创建仅两个 IAM 资源：`TechlongSandboxGitHubImagePublisherRole` 和 `TechlongSandboxGitHubImagePublisherBoundary`；不传历史 execution RoleARN，初次创建 disable-rollback，两个资源均 Retain。失败保留已出现的对象并准确核验/撤权，不自动清栈。
2. OIDC trust 只允许本仓 main ref、aud=sts.amazonaws.com；这是 main 全 ref 的信任，不声称 AWS 按 workflow 或 manifest SHA 隔离。权限与 boundary 双重限制为 ca-central-1、准确现有仓库上传和只读扫描；仅 GetAuthorizationToken/registry扫描配置读取需要 Resource:*。无 IAM/Secrets/S3/ECS/CloudFormation/Delete/CreateRepository 权限，policy 与 trust 固定截止。workflow session 30 分钟。
3. 只 dispatch 新手动 `backend-reviewed-ecr-publish.yml`，输入完整清单 SHA。先核对批准/实现和 IAM 模板 SHA、准确成功 run/artifact metadata、ZIP digest、安全四文件解压、checksums/receipt，再 docker load/核对 image ID；之后才获取 AWS 短时凭据。
4. 仅将已检验两镜像写入现有仓库的清单固定 tag；不重新构建、使用 latest、覆盖/删除旧镜像或创建仓库。同 tag 若存在只读取精确 config digest；外来碰撞拒绝，部分失败不自动重试。
5. BatchGetImage 独立核对实际 registry manifest SHA 与已检验 config digest；只读等待自动 BASIC 扫描，HIGH/CRITICAL 或未完成时 fail closed，不启动 ECS、不自动删除镜像。成功/部分失败 small receipt 保留 7 天。
6. workflow 成功或失败后立即由 **Source** 应用已绑定的 Revoke 模板：boundary/inline DenyAll、OIDC trust Deny，独立只读核验三个对象及 CloudFormation 终态。GitHub publisher 自身不能修改 IAM，所以撤权不是 workflow 内自撤权；后续执行必须编排这一外部收尾，不把“job结束”当作 Locked。role/boundary/images 均保留，不删除旧记录。

Grant 模板文本 SHA：`f5ba5a89fa48b6a409ea9bbb4961196a62b66ed5a2b5f7f4905bfb071a73744a`。

Revoke 模板文本 SHA：`5ef0c95edfc88901c74e62366de6127cc28b2bc7c65eb3c96044efe74bfc5ebe`。

发布实现 8 项必要 Node 门禁测试、JS/Python 语法与本地无云 `verify` 通过；ECR 发布工作流仍未获得云执行批准，不能声称它已实际发布成功。代码和文档提交/推送沿用用户默认授权，无需再次批准 Git。

## 费用与接下来的 ECS 工作

沿用 **50 USD/月目标**，不是 AWS 强制上限。此次仅 ECR 镜像存储，不创建 Cell/ALB/Fargate/Aurora。两 ZIP 合计约186MB，ZIP 大小不等于实际 ECR layer 计费量；按1GB存储、公开0.10 USD/GB-month示例预留约0.10 USD/月，实际region计费与税另计，不承诺绝对零费用。[ECR 定价](https://aws.amazon.com/ecr/pricing/)

公开仓库标准 GitHub hosted runner 计算分钟免费，但 artifact storage 有独立账务规则；使用短保留期，不引入 larger runner 或付费 CodeBuild。[GitHub Actions 账务](https://docs.github.com/en/billing/concepts/product-billing/github-actions)

ECR 成功后仍需补齐 lifecycle 的生产 admission/authority/env/deadline/准确 artifact source/commands root，再以真实 image@digest 编制首个 Cell 的 IAM/网络/数据库/ALB/Fargate/日志/TTL 和费用清单。实际云安装、baseline 上传、数据库硬化和 ECS 运行各按具体范围确认。旧 Worker/standalone CLI 不因环境 flag 或镜像发布自动启用，源 PG15 和 Neon 未写入。

官方设计依据：[GitHub AWS OIDC](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws)、[ECR 不可变标签](https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-tag-mutability.html)、[BASIC 扫描](https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-scanning-basic.html)。
