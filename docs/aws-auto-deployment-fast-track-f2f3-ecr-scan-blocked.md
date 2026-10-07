# F2f 第三批：受批 ECR 发布、扫描阻断与 Locked 收尾

2026-10-07 用户明确批准清单 `ce32e46450cd18f382d67de843eeaf208be9421beed80dc7cb94ed6d335abc10`。本批实际创建专用 IAM 资源并发布两份原始 checked 镜像，lifecycle 的 BASIC 扫描有 HIGH/CRITICAL，故整体发布门禁失败；**没有部署 ECS**。Source 已立即撤权，独立只读核验完整 Locked。

## 一次性执行事实

- 执行前准确 Source `arn:aws:iam::402010193138:user/techlong-sandbox-dev`、原清单/执行器/模板 SHA 与期限通过；新 stack/role/boundary absent，两个目标 tag absent，原候选 run success/artifacts 未过期。AWS validate-template 接受 Grant/Revoke。
- Source 直接创建 `techlong-sandbox-github-image-publication`，disable-rollback，不使用历史执行角色。准确栈 ARN：`arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-github-image-publication/62c806e0-c27e-11f1-88a8-0e6ce3fed11f`。
- CREATE_COMPLETE 后独立 Source 核对只有 `TechlongSandboxGitHubImagePublisherRole` 和 `TechlongSandboxGitHubImagePublisherBoundary` 两项、原 exact-repository/region/date 权限、main OIDC trust、零 attached policy 和唯一 inline policy，全部匹配受批模板。
- 仅一次 GitHub dispatch；[运行 37668582570](https://github.com/veinyyxy/SpeedFeast_Backend_main/actions/runs/37668582570)，publisher main `9520858b0331c4e43017f27258293618c79d83e2`，attempt=1。准确 candidate run/artifact ZIP/checksum/receipt/image load 校验实际通过；OIDC 短时登录实际通过。
- 无 rebuild、覆盖/删除旧 tag 或镜像，没有第二次 dispatch/Grant/Push 重试。

## 实际 ECR readback

仓库保持 `402010193138.dkr.ecr.ca-central-1.amazonaws.com/techlong-sandbox-speedfeast`、IMMUTABLE/scanOnPush/BASIC。两镜像均已写入；发布 job 与另起 Source BatchGetImage 均确认原 approved image config digest，以及原始 registry manifest bytes SHA 与 ECR 返回 digest 一致。

| kind | 实际 registry manifest digest | BASIC 扫描终态 |
| --- | --- | --- |
| app | `sha256:1c60a09f37c84cc45979e218bd5c221b60cd51200fea7cfd2b0701d334dfb610` | COMPLETE，findingSeverityCounts={} |
| lifecycle | `sha256:c24f2c8847ffd5e95faf815a39d7ac7387334e5602f61be94c7774159c5d1014` | COMPLETE，CRITICAL=6、HIGH=19、MEDIUM=12、LOW=5 |

完整 tags 与原 config pins 保持 [第二批清单](./aws-auto-deployment-fast-track-f2f2-cloud-images.md) 原值。registry manifest digest 不是 image config digest，两者没有混用。

这不是 MFA、Source 过期或权限错误。lifecycle 阻断来自系统包 `gcc-12`、`pcre2`、`perl`、`python3.11`、`util-linux`、`zlib`；当前 runtime 是 pinned Node bookworm-slim 加 apt 工具依赖。npm audit 0 不覆盖这些系统包。ECR 结果不等于逐项确认实际可利用性；未因部分 CVE 的调用条件/平台限制而豁免 strict HIGH/CRITICAL 门禁，也不把 app 此刻扫描空结果称作永远无漏洞。

job 错误：`High/critical ECR findings; ECS remains blocked, images retained`。云端小收据 outcome=`PUBLICATION_INCOMPLETE`，app scanVerified=true、lifecycle=false、两者 pushAttempted=true。这表示部署门禁未完成，不表示镜像都没写入。

## 立即撤权与独立证据

单次执行 wrapper 的 finally 在观察 job failure 后立即 Source update-stack，使用原 Revoke 模板，未重新授予权限。栈 UPDATE_COMPLETE；Source 回读确认：

- managed boundary default version **v2**：Deny `*`/`*`。
- 唯一 inline `ExactSandboxEcrPublication`：Deny `*`/`*`；attached policies=0。
- OIDC trust：Deny AssumeRoleWithWebIdentity；准确 role 仍绑定该 boundary。
- 栈仍为准确原两个资源，没有 replacement/deletion。两个镜像、原 policy/template/执行记录保留。
- 另起 Source 请求再确认 boundary v2/inline/trust；sandbox `cell-sandbox-1` 仍 MISSING。

执行脚本最终非零：`Publication failed, but Source Locked is verified. No write retry.`。这是扫描门禁失败后的正确安全收尾，不能重跑旧清单或把非零当作撤权失败。

私有完整证据：`F:/ChatGPT_workshop/techlong-reviewed-ecr-publication-ce32e464-20261007`；一次性脚本 `F:/ChatGPT_workshop/Run-ReviewedEcrPublication-ce32e464.ps1`。原目录永久占用，不复位。没有凭据落盘；完整 scanner findings 与执行审计不公开提交，只公开下列状态/证据 pins：

- `locked-iam-readback.json` SHA：`254edf45b0b4879c299ea7af81fea8fafc741eee2b2f15baa8f1a4a9bda696a3`。
- `execution-summary.json` SHA：`38d7bc3f8982bc53377fde4c1825007ca7d2440d4ac2acafaad9fb52a58ed58b`。
- `publication-receipt.json` bytes SHA：`e62be0f857e9db13fd66a23a662b73e9b718f910b82fd853a1588369817e9829`；[GitHub artifact 11503902846](https://github.com/veinyyxy/SpeedFeast_Backend_main/actions/runs/37668582570/artifacts/11503902846)，ZIP SHA `abf81c6ede9413eabdd37ff8a39792cf98379002415b81ce265d0788fcec42f7`，保留至2026-10-14T18:41:29Z，已下载/核验到私有目录。
- 独立 Source image readback v2 SHA：`86cab6560c75c90abed4d8ea1d60eab87c65844dcb315f84774ca5020b4c7ba9`。首个本地索引误将 hash-format 写到 approvedManifestSha 字段，原件保留，新索引只纠正元数据并绑定原件 SHA，镜像观察未变；不修改云端收据。
- Source app/lifecycle 完整 scan SHA：`c99f3423d5739ce71108f5eeefdba1ed6d266bf522bf540180af7997c82cda2c` / `74dbcf65fc4652f3b4f1108d52d92f5c84a11307c1973caffdb231e0c99a3274`。
- 执行冻结的 Grant/Revoke bytes SHA 分别仍是原批准的 `f5ba5a89fa48b6a409ea9bbb4961196a62b66ed5a2b5f7f4905bfb071a73744a` / `5ef0c95edfc88901c74e62366de6127cc28b2bc7c65eb3c96044efe74bfc5ebe`。

## 下一步边界

先更新或精简 lifecycle 运行层的系统工具依赖，保留 Node/PG/compiler/bundle 的准确自检；由 Actions 重新构建验证。新镜像必须使用新 source/config/artifact/tag pins 与新发布清单，原 grant 已撤销，不自动恢复或重试。不能直接降低扫描门槛、跳过扫描或重放已消费的创建/发布批准。

修复后仍须 fresh 具体范围批准，再使用现有 Locked IAM 栈的显式更新路线（不重新创建同名角色）。后续 ECS/Cell、baseline 上传、生产 CLI root/authority 和数据库硬化另行确认；当前没有 paid Cell、源 PG15/Neon 写入或 Secret/baseline 公开上传，Worker 未启用。两镜像和 Locked IAM 资源保留，ECR 存储仍可能计费，沿用50 USD/月目标。
