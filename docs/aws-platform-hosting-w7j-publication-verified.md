# W7j：平台镜像已发布，Source 已独立核验撤权

2026-10-22。用户刷新 Source 后确认准确清单 `d902a5f5bfdb7f1a0f5ae33e729f306c13dfeb4a15832a67539cd53cd9aedc56`，沿用[固定执行范围及完整风险](aws-platform-hosting-w7j-source-review.md)。本次一次性发布已完成，Source 结果为 **PUBLISHED_AND_INDEPENDENTLY_LOCKED**，errors=[]；另一次只读 Inspect 为 **LOCKED_OBSERVED**、imageCount=1。

**完成的是平台镜像 ECR 发布与临时发布权限收回，不是 ECS 部署、真实数据库/管理员登录或平台上线验收。两小时 hosting 窗口尚未启动。**

## 准确镜像及源码

- 运行 main：`c0ced53a699aa1158005d14bf9a685361581b5df`；受审 Source 代码/风险锚点 `5670b88977daeab8168d9b50d62bcd276c391ccf`，Source CI `39698015750`。
- 固定 reusable：`c35dd66e1207181b9591056e1202cfb84ffcf010`；未修改被批准的执行代码、风险、caller 或清单。
- 原镜像 source `4209fcab429b868e253ea2d7263dfe2189187232`；producer `39692352506` / artifact `12388759351`。复用原产物，没有重新构建镜像。
- ECR：`402010193138.dkr.ecr.ca-central-1.amazonaws.com/techlong-sandbox-platform-web`。
- 唯一 tag：`platform-sha4209fcab429b868e253ea2d7263dfe2189187232-r39692352506-a1`。
- **可供后续部署固定的 registry manifest digest：** `sha256:81fb8157fd9dcf834204a3b0c866d3fc8071386a4cbc1ff71f2ccac992ed4612`。
- config digest：`sha256:2338439ea316a6189d50281f5d25a0a1c2a2ca1f4455494253f20bcbd8f6f9ae`；10 layers。config、archive、ZIP 摘要不是 registry manifest digest，不可混用。

后续部署镜像引用应固定为：

```text
402010193138.dkr.ecr.ca-central-1.amazonaws.com/techlong-sandbox-platform-web@sha256:81fb8157fd9dcf834204a3b0c866d3fc8071386a4cbc1ff71f2ccac992ed4612
```

## 实际执行与时间线

所有时间为 2026-10-22；温尼伯为 America/Winnipeg、CDT（UTC−05:00）。

| 事件 | UTC | 温尼伯 |
| --- | --- | --- |
| fresh Source/资源只读前置完成 | 15:06:38.802 | 10:06:38.802 |
| 内层窗口开始、永久槽排他消费 | 15:06:42.736 | 10:06:42.736 |
| Grant UpdateStack 提交 | 15:06:42.804 | 10:06:42.804 |
| Grant 独立回读通过 | 15:07:15.422 | 10:07:15.422 |
| 云端字节/self-check/扫描通过 | 15:14:00 | 10:14:00 |
| ECR 实际 imagePushedAt | 15:14:39.902 | 10:14:39.902 |
| Revoke UpdateStack 提交 | 15:15:05.631 | 10:15:05.631 |
| Revoke 独立回读通过 | 15:15:38.149 | 10:15:38.149 |
| Source 最终 manifest/引用回读完成 | 15:15:39.763 | 10:15:39.763 |
| 额外只读 Inspect 完成 | 15:16:17.039 | 10:16:17.039 |

内层 SHA：`3314cdb7119b14a56b4c41aa5301e70242945c16e4fee3603aef6c4455186008`，nonce=`e3a23b0d1364d86549414bf01c34c60b`。原窗口截止 16:06:42.736Z / 11:06:42.736 CDT，实际提前进入撤权；没有延长或重新生成窗口。

顶层控制流只有两次准确 V2 栈 UpdateStack（Grant/Revoke，两个 ACK 的 attempts 均为1）、一次 GitHub workflow dispatch、一次900秒 WebIdentity角色会话、一次顶层 Docker push。没有应用层写重试。两次 UpdateStack 不等于 AWS 内部只有两次 IAM/ECR HTTP 操作；本次没有用 CloudTrail 枚举全部提供者内部请求。

- Grant requestId：`4d1eaabf-c19b-406a-816b-e1b592b8acd7`。
- Revoke requestId：`21351438-36ff-48c0-b546-81396e6982a3`。
- 没有直接 IAM 写、CreateStack/Change Set、ECS/Cell 部署、AWS Secret 值/PEM/私密包读取、SQL 连接或资源删除；Source 仅使用现有 AWS Login 和一次现有 Git credential helper 加载。

## GitHub 与云端证据

[准确发布运行 39801811721](https://github.com/veinyyxy/TechlongSoftware/actions/runs/39801811721)，workflow `392305101`，main/attempt1，完整 head=`c0ced53a699aa1158005d14bf9a685361581b5df`。job `119904258886` 的全部 **12 项报告步骤均 completed/success**；引用的 reusable SHA 精确匹配上述 R。

排队初期接口短暂显示 queued、pending_deployments=[]、approvals=[]，当时页面确实没有 Review deployments 按钮。15:11:13Z 后出现准确 environment 门禁；最终 approvals 独立回读确认 userId=14145707、state=approved、environmentId=24613410405。没有改环境设置、代替人类批准、重新调度或 Re-run。

发布前在云端再次验证原 ZIP/archive/config、Docker load、两种 smoke 和 fresh OS 扫描。扫描为 Alpine3.24.1、18 packages、0 HIGH/0 CRITICAL，无 ignore-unfixed/忽略发现；scanner=0.75.0，DB UpdatedAt=`2026-10-22T13:15:26.425424764Z`，扫描收据时间15:13:59.312Z。它不证明 npm/应用层无漏洞、真实 TLS 或数据库登录成功。

官方小型证据 artifact `12435359935`，`platform-publication-v2-39801811721`，2401字节；官方 ZIP SHA 与下载原始字节一致：`53783b044565b6968046fbbab4096a7fa8bccf4a016c5913be77d03908dc21cc`。ZIP 只含四个预期 JSON，无归档镜像或认证材料：

| ZIP 内文件 | SHA256 |
| --- | --- |
| publication-result.json | b63cd4416c49f9cc6882ffe70ccc10ae092f229137a3dbbb33979b326d700234 |
| publication.intent.json | 98a623cf36ca3f560f49dda79aa235e11649e80c3196d7cde441edda288bfa7d |
| verified-artifact.json | c6682de5edbac030ad9851d256d4e977b4639fe49f4479f1b798a9f99241da8d |
| verified-preflight.json | 0b110cfa1f39409d3808a6534aa0fe670c205ab805b80ff13c91448c56221d7a |

云端结果刻意为 IMAGE_PUBLISHED_REVOKE_NOT_YET_PROVED / iamRevokeProved=false，因为发布角色本身无撤权能力；最终 Locked 结论来自下述独立 Source 观测，不能把云端报告单独当作撤权证明。

结果文档写入后，本机重新运行 Source/pub-v2/pub-v1 共30项 Node 回归测试，全部通过；没有通过重新调度发布或重建镜像来验证文档。此次工程变更仅 README、结果文档与机器证据摘要，受审执行模块不变。

## 撤权与保留状态

独立 Source clients 的直接回读已确认：

- 准确栈 `arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-platform-image-publisher-v2/701257e0-cd89-11f1-be5e-02452f6c634b` 为 UPDATE_COMPLETE，仍只有原一个 IAM Role，DisableRollback=true。
- 角色 `TechlongSandboxPlatformImagePublisherV2`，真实 RoleId=`AROAV3GNMXTZID6CJJBA2` 未变；trust 无任何 Allow，唯一 inline 的 LockedDenyAllEcr 显式 Deny `ecr:* / *`，无附加 managed policy。
- 原 boundary PolicyId=`ANPAV3GNMXTZP2F37SEFP`、默认v1、正文及usage=1不变。原 repository CreatedAt、IMMUTABLE/AES256/scanOnPush、registry BASIC/rules[]、无 repository policy 均匹配；角色及栈标签与执行前一致。
- ECR 恰有一份准确 tag/image，registry 报告271259127字节，Source 读取原始 manifest 的 digest/config 与云端报告逐项相同。
- 额外 Inspect 再确认 LOCKED_OBSERVED、imageCount=1、cloudWrites=0；不是将一次写响应当作独立观测。

这些是准确时刻的非原子资源策略观测，不是对已颁发 session/ECR token、授权缓存、传播延迟或在途请求即时失效的绝对保证。原[风险说明](aws-platform-hosting-w7j-source-review.md)继续适用。镜像保留并可能收费；50USD/月仍是目标，不是硬停费上限。

## 不可重放与可追溯材料

[项目机器摘要及完整证据索引](../ops/aws-sandbox/reviews/platform-publication-w7j.verified.json)记录全部16份 Source 文件摘要、四份额外文件及 ZIP entry 摘要。原清单、代码与风险未覆盖。

- 永久槽 `F:/ChatGPT_workshop/techlong-platform-publication-v2.source.intent.json` **已消费，不得复位/删除/重放**，SHA=`a95dc5c045879257f72ae6c91c49e7f9228996fbdc41659c0358ca8597eb3c26`；内层原始 JSON 与 SHA 均保存在槽中。
- 执行目录 `F:/ChatGPT_workshop/techlong-platform-source-v2-e3a23b0d1364d86549414bf01c34c60b`。
- 目录内 result.json SHA=`ef86fe127b8a0f42a5bb203ad2509cd875ecb3d45ec4ce4d0f34bde281488eeb`。
- 目录内 independent-registry-manifest.json SHA=`9198c4f16d8da80477de25cf138961ee60eb8e58a15b83efa05db721a7031b43`。
- 独立 Inspect：`F:/ChatGPT_workshop/techlong-platform-source-v2-inspect-1792682177043.json`，SHA=`f4fd394d466e266bc42e719e8b83e057ca847c32480682cf60430f720cf03706`。
- GitHub API 独立读回投影：`F:/ChatGPT_workshop/techlong-platform-source-v2-github-39801811721.json`，SHA=`d03ec3d414e75b5e796fbb0481b86552acb16d96700676794df6e6c1a3b2e3ed`。
- 官方证据 ZIP：`F:/ChatGPT_workshop/platform-publication-v2-12435359935.zip`。远程artifact在2026-10-25T15:14:40Z到期不影响已经发布的ECR镜像；本地证据保留。

## 下一主线，尚未执行

回到既定[两小时 HTTPS 平台验收方案](aws-platform-hosting-w7c-two-hour-https.md)：下一准备最小权限平台 web 数据库身份及固定 Secret 版本接线，再将准确镜像 manifest digest、execution role/IAM差异、完整 hosting 逻辑资源及清理保留项绑定到部署待审清单。不能把镜像发布成功视为数据库身份或 Secret 已就绪。

数据库/Secret/IAM 写入、实际 hosting 部署和之后准确资源清理仍分别审批。无运行中 Source 进程或待处理 GitHub job；不继续旧 CREATE_FAILED 栈/AVAILABLE Change Set、F3c9、租户恢复或其他权限支线。
