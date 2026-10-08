# F3a2：新 prepared root 双镜像已发布，立即撤权与独立核验完成

2026-10-07 Winnipeg / 2026-10-08 UTC。按用户新批准清单 `1ab97e7b380947662e54920a3150e4c314fd8d8f8a29c320a74f7abe46b51c6a`，唯一执行已成功完成：更新既有 publisher 的两项 IAM 资源、GitHub Actions 单次发布两镜像、成功后立即 Source Revoke，独立核验 **Locked/v6、UPDATE_COMPLETE**。原始云端回执与独立 ECR manifest/config 字节及扫描结果完全一致。

**这只完成镜像发布，不是 F3 整体完成或付费部署授权。** 未部署 ECS/Cell、上传 baseline、安装 TaskRole/authority/DNS/证书/Janitor/Budget 权限、启动 Worker，未写 Neon 或源 PostgreSQL。沿用 50 USD/月目标，AWS 读取和 ECR 存储/扫描仍非绝对零费用。

## 实际发布结果

[发布工作流 37714817734](https://github.com/veinyyxy/SpeedFeast_Backend_main/actions/runs/37714817734) 为 `workflow_dispatch`、attempt 1、success；执行器 head `91cbf44d26d72688875ae6d11ce04dafbd0ce6ad`。严格使用原[候选 run 37702693753](https://github.com/veinyyxy/SpeedFeast_Backend_main/actions/runs/37702693753)、attempt 1、source `19cc3e096df4d37be0a6570ce3116d47c472ace2`，没有本地 Docker 安装或重新构建。

仓库：`402010193138.dkr.ecr.ca-central-1.amazonaws.com/techlong-sandbox-speedfeast`，IMMUTABLE/BASIC。

| 镜像 | 固定 tag | Registry manifest digest | 实际 config digest |
| --- | --- | --- | --- |
| app | `app-sha19cc3e096df4d37be0a6570ce3116d47c472ace2-r37702693753-a1` | `sha256:2af648ae122dad46dcba313481797a49766744c4de167d33642dba124908df07` | `sha256:75140a5e88550b04f458e2aa2c1b6b7b4326dc1225e11d8491dc2f440ac63206` |
| lifecycle | `lifecycle-sha19cc3e096df4d37be0a6570ce3116d47c472ace2-r37702693753-a1` | `sha256:2ab7017dcebd64083e7804001685272a3a5461faa4b7a4bec37adab059980bb4` | `sha256:8cd975a2f73c11e4363ef5fbf298416323f2723a24a68738e72dfdf273342d9e` |

两份 BASIC scan 均 `COMPLETE`，`findingSeverityCounts={}`，未报告 HIGH/CRITICAL。Source 独立读取精确 tag 对应 manifest，对原始 manifest 字节计算 SHA；随后下载实际 config bytes 并核对 config SHA，不把 artifact/config digest 冒充 registry digest。原始 GHA 回执中的两组 tag/config/registry pins 与独立结果准确一致。

两 config 均 linux/amd64、`65532:65532`、source label 为 19cc。lifecycle ENTRYPOINT 为 `/usr/local/bin/node db/tenant_lifecycle_prepared.js`，默认 CMD `--check-bundle`，声明 `/tmp/tenant-lifecycle` volume。这里只证明镜像配置，不证明真实 Fargate metadata/临时凭据/卷初始化或数据库准入通过。

## 立即撤权、保留与真实副作用

准确 stack `techlong-sandbox-github-image-publication` / `62c806e0-c27e-11f1-88a8-0e6ce3fed11f` 原两资源仍为 `PublisherBoundary`、`PublisherRole`，没有创建/替换。原 role 为 `TechlongSandboxGitHubImagePublisherRole`，boundary 为 `arn:aws:iam::402010193138:policy/TechlongSandboxGitHubImagePublisherBoundary`。

工作流 01:50:39Z 已显示 success，控制器 01:50:52Z 记录并立即提交 Revoke。boundary v6 于 01:50:57Z 创建。独立 Inspect 核对栈 UPDATE_COMPLETE、boundary/sole inline Deny-all、trust Deny、attached0、准确两资源 inventory；中断恢复后在原 03:00Z 权限截止之后，再次只读证明 Locked/v6。撤权不是仅等待权限自然过期。

CloudFormation **实际删除了旧 policy versions v3/v4**，这是本次已明确批准的更新副作用，不应被“resourcesDeleted=false”掩盖：

- 01:48:26Z 删除 v3，CloudTrail request ID `603c1232-283a-44dd-b73d-46b4f66d2d90`。
- 01:50:57Z 删除 v4，CloudTrail request ID `df545569-bb21-4c9a-bf49-845d2a756c96`。

us-east-1 的两条准确事件均绑定上述 policy ARN、Source user `arn:aws:iam::402010193138:user/techlong-sandbox-dev`、userAgent `cloudformation.amazonaws.com`。当前版本仅 v5/v6，默认 v6。写前保存的 `boundary-pregrant-v3.json` / `boundary-pregrant-v4.json` 保留内容，但**同一云版本 ID 不可恢复**。没有另行 DeleteRole/DeletePolicy/DeleteImage，role/policy 本体与八份镜像仍在；六份旧镜像及 tag 全部只读确认保留。历史清单、模板、本地永久 slots 和旧记录不删除。

恢复只处理原 GitHub receipt 的只读下载：PowerShell 302 停止方式改为不自动跳转的 HttpClient，再无认证头 GET 受限 HTTPS blob host；token/签名 URL 仅内存使用、不记日志。没有重跑 Grant、dispatch 或发布。后续准确 `cell-sandbox-1` ECS cluster 回读仍 MISSING。

## 可复核证据

原始私有材料不提交 Git；以下 SHA 为实际文件字节，不是重新序列化的等价对象：

- 永久执行目录 `F:/ChatGPT_workshop/techlong-reviewed-ecr-republish-1ab97e7b3809`；execution-summary SHA `ee71cd83a907844a57ec52d6bb8d0bbdf36adad0bca6a7bdd7356bf15b3ac4a3`，locked-readback SHA `ea422bcb6ea01b35956a45121219aa34189a3a551375fed61c5f2c81ff1124e7`。
- 原 GitHub receipt artifact `11523545862` / `reviewed-ecr-receipt-37714817734-1`，原 ZIP SHA `1d9ab197e95df836ec0c916e187f6d7f653dd4eec10a5cee2e5a441cc5434858`，receipt SHA `a304540fe1a729c6ca8a80a69af27467cfa0feb24ebf2838293d0a2f79e6bb50`；目录 `F:/ChatGPT_workshop/techlong-f3-cloud-receipt-37714817734`。
- 独立 raw manifest/config/scan 目录 `F:/ChatGPT_workshop/techlong-f3-publication-readback-1ab97e7b-a1`，independent-readback SHA `a62b3f2791f9586fe9123e8cfebb282b72510e506da6b1e70550499b7dd0d032`。
- 中断后独立 Locked、八镜像库存、Cell 缺失、版本清单和 CloudTrail 原件目录 `F:/ChatGPT_workshop/techlong-f3-closure-1ab97e7b-a1`，closure-verification SHA `6f35d0027363a5e179205976a3c265c88c1e8e3bc2545c6510b89cc47c2182b3`，outcome `PUBLICATION_CLOSED_LOCKED_V6_OLD_IMAGES_RETAINED_CELL_ABSENT`。

9 项 publisher 范围/历史/日期 transport 回归再次通过。[执行器完整 Backend CI 37714234982](https://github.com/veinyyxy/SpeedFeast_Backend_main/actions/runs/37714234982) 此前已 success，实际发布工作流已 success；本次收尾不改生产代码、manifest 或已批准执行器，也不重复构建大镜像。

## 下一阶段

发布 slot 已永久消费，原 installBy02:00Z / expires03:00Z 窗口已过期。**不要执行 RunReviewed、复用本批准、自动重置 slot 或重新 dispatch。** 云验证只用 Inspect；下一项云变更必须另有准确 fresh 范围及 SHA。

下一代码切片优先补 **精确 owned-resource 可执行 TTL / 失败清理**，保留 cleanup ownership/epoch/零租户围栏及 immutable evidence，不能只开启当前 PLAN_ONLY Janitor 或依赖手动 babysit。随后准备专属 TaskRole boundary、baseline 审批/发布、authority 读 cap、线上 50 USD Budget、Sandbox wildcard/mTLS/DNS 的独立变更清单，付费 Cell 最后批准。实际 Fargate/RDS session/卷/lease/cleanup、PUBLIC CONNECT 隔离、mTLS/control/HTTP ready 均仍待在线验收，Worker 默认 disabled。

既有 Aurora/价格/权限缺口见 [F3a 集中只读核验](./aws-auto-deployment-fast-track-f3a-readonly-preflight.md)；808 无写入失败及修复保留在 [F3a1 历史记录](./aws-auto-deployment-fast-track-f3a1-timestamp-preflight-fix.md)。
