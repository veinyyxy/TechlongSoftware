# F2f 第五批：修复镜像 ECR 发布审阅

2026-10-07，本阶段完成代码、真实产物校验和 AWS 只读审阅，**尚未更新 IAM 或发布镜像**。沿用每月50 USD目标、Actions云端构建、不装本地Docker、旧记录保留和实际云变更按fresh SHA确认的边界。

## 本次准确清单

服务端文件：`deployment/reviewed-ecr-publication.json`，schema2，UTF-8 LF规范化文本SHA：

```text
c9fa6086f28c8e599f40baf1d1f20ef937d2fcb9d2346bdd5376cc1d2a1c4790
```

它绑定第四批源 `40b1ce6e487dc4c1187da3014a89b9379d50d578`、[成功候选run37674970489](https://github.com/veinyyxy/SpeedFeast_Backend_main/actions/runs/37674970489)、attempt1、两份准确ZIP/receipt/config/OS scan、手动workflow和全部执行器/模板原文SHA。不是重新构建，也不复用旧已消费批准 `ce32e464...`。

| kind | checked artifact ID | 新固定 immutable tag |
| --- | --- | --- |
| app | 11506991818 | `app-sha40b1ce6e487dc4c1187da3014a89b9379d50d578-r37674970489-a1` |
| lifecycle | 11506102380 | `lifecycle-sha40b1ce6e487dc4c1187da3014a89b9379d50d578-r37674970489-a1` |

app ZIP SHA `e3213b870c3a6ef6aac79d05826c2cc4e8f87756e18a5d9b69de0c419839b928`；lifecycle ZIP SHA `df93125d87f76800d816927d5185fbdc3ef30649b2699a6a3e8cae869553bf01`。二者本地config digest仍分别为 `sha256:f82596ef5dae6229a629a07b37cfce5b0ece9b99fc63d939af997fbde9c40f49` 和 `sha256:cc342bcc242b9c3ae9d61d9b94c27053e7e8c8a2bc32347f54368848d76ea5af`，**不是尚未产生的ECR registry manifest digest**。

## 待确认的云变更范围

仅在account `402010193138`、region `ca-central-1`：

1. Source更新现有准确栈 `arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-github-image-publication/62c806e0-c27e-11f1-88a8-0e6ce3fed11f`。初态须UPDATE_COMPLETE/Locked/default v2；只有原 `TechlongSandboxGitHubImagePublisherRole` 和 `TechlongSandboxGitHubImagePublisherBoundary` 两资源，无CloudFormation service role绑定。**不创建或替换栈/role/boundary**，不改现有OIDC provider。
2. 新Regrant模板短时更新boundary、同名唯一inline policy与OIDC trust；Publisher只能在ca-central-1读取registry auth/scanning，向准确现有 `techlong-sandbox-speedfeast` 仓库上传layer/PutImage及读取镜像/扫描。没有IAM、ECS、Secrets、S3、CloudFormation或删除能力。Source自身既有权限不扩展。
3. OIDC aud为sts.amazonaws.com，sub固定此仓库main ref；这不是AWS按workflow隔离。manual-only workflow先校验准确artifact及全部bytes、前置扫描和loaded image，再获取30分钟OIDC凭据，至多发布这两个新固定tag。不覆盖旧tag、删除旧镜像、改repository/scanning设置或重建镜像。
4. 独立读取每个registry manifest原始SHA/config digest及BASIC scan；HIGH/CRITICAL均须0。前置Trivy通过不取代ECR门禁，不承诺两个scanner/feed会得出同样结果。
5. 成功或失败都立即独立Source应用原Locked Revoke，再核验完整boundary/inline/trust、零attached policies与两原资源。任何写响应不确定、工作流失败或槽位占用都不自动重试；需要只读Inspect，缺少Locked证明时禁止继续新的Grant。

新 `ecr-publisher.regrant-20261007.template.json` 文本SHA `464484615d9298e65f6d4f80ecbbe74db943d6d021ac5f992bacc1c78a497fb3`；原Revoke SHA仍 `5ef0c95edfc88901c74e62366de6127cc28b2bc7c65eb3c96044efe74bfc5ebe`。原Grant/Revoke和已消费清单原文均未变，旧清单归档为 `deployment/history/reviewed-ecr-publication-ce32e464.json`。

## 已完成的实际验证

- 两个原始ZIP已实际下载（app70,652,726 bytes、lifecycle83,265,053 bytes）；完整ZIP原始SHA、四成员准确集合、每成员流式SHA和三条checksum都匹配。没有解包大型镜像到本地Docker，没有重build。
- 两份原始receipt和self-check通过新admission：Node24.18.0/uid65532/linux-amd64；app health200/ready503/network none；lifecycle PG16.14/Python3.14.8、最小层与准确metadata、fixture-only/runtime-disabled。前置scan准确匹配受审image、Trivy固定二进制、48h内DB和HIGH0/CRITICAL0。
- Source只读核对当前IAM Locked/v2、原两资源和零attached policy。新控制器真实ReviewOnly再次验证，`mutationPerformed=false`；另起进程Inspect再次Locked/v2，GetTemplate完整内容与原Revoke深比较一致，两个新ECR tag仍未占用。repo IMMUTABLE/scanOnPush、registry BASIC。
- AWS ValidateTemplate两份模板均通过，仅返回CAPABILITY_NAMED_IAM；这不是创建Change Set或批准Update。
- 16项发布/镜像/扫描相邻测试及JS/PowerShell语法通过。旧SHA归档和原模板保留测试通过。服务端main `9bd3560e5e1c576b543aea30bd35a33e3feda50f` 已推送，[完整Backend CI37679845919](https://github.com/veinyyxy/SpeedFeast_Backend_main/actions/runs/37679845919)实际success，check与Docker构建/inspect/smoke两job全部通过；没有触发手动publisher，也不能把CI通过当成实际ECR发布验证。

私有索引 `F:/ChatGPT_workshop/techlong-reviewed-ecr-republish-f2f5-20261007/review-index.json` SHA `b91491f367ffdfa220299fd57b9f12b49a64c3908975f37fc3aaaf476319b399`；原ZIP、raw receipt/self-check/SHA256SUMS和新只读输出保留，不提交这些私有产物。第四批成功构建/扫描记录见 [F2f4](./aws-auto-deployment-fast-track-f2f4-minimal-runtime.md)。

## 执行入口与截止

`scripts/publication/run-reviewed-ecr-republish.ps1` 默认 `ReviewOnly`，不会获取GitHub写token、占执行槽位或做AWS写入。`RunReviewed`必须给出本清单准确SHA；在写入前检查Source临时会话至少剩余一小时、本地/远端main一致、候选成功和artifact仍有效、Locked/v2无漂移、新tag未占用。模板按批准SHA冻结到永久新槽位，Source Update和workflow dispatch各至多一次；finally立即Source Revoke。`Inspect`过期后仍只读核验Locked，不重开Grant或发布。

温尼伯时间（CDT，UTC−5）：

- **最迟开始安装：2026-10-08 13:00**，即18:00Z。
- 权限/发布截止：2026-10-08 13:45，即18:45Z；不是允许到这个时间才开始安装。
- app artifact最早失效：2026-10-08 14:30:55，即19:30:55Z。

当前Source会话不足一小时，真正执行前需 `aws login --profile techlong-sandbox-user` 并回复“Source已刷新”。清单过期不自动刷新、延长或重放，必须重新只读核对并确认新SHA。

## 费用和不包含的事项

两份压缩ZIP合计约154MB，实际ECR layer存储计费另算。以保守新增1GB存储、公开0.10 USD/GB月示例估算约0.10 USD/月存储量级，不是实际账单承诺；旧镜像保留、Actions账户用量、传输、税和其他既有AWS资源另算。[ECR官方计费说明](https://aws.amazon.com/ecr/pricing/)

本清单不授权ECS/付费Cell、ALB/Aurora、数据库/Neon/源PG15写入、生产73表baseline发布、Secrets安装、Worker/CLI root启用或任何云资源删除。50USD/月是目标，不是实时扣费断路器。镜像成功发布后，才能继续生产admission/CLI/root及后续独立受审ECS部署，不能声称自动部署已完成。

确认语句：

> 我确认按清单 c9fa6086f28c8e599f40baf1d1f20ef937d2fcb9d2346bdd5376cc1d2a1c4790 更新现有Locked发布IAM资源，单次发布两份修复镜像，并在成功或失败后立即Source撤权和独立核验Locked；不部署ECS、不删除资源，接受低成本但非绝对零费用。
