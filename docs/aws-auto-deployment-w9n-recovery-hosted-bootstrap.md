# W9n — 恢复控制器托管启动与新镜像准备

## 本轮最小变化

W9m 已发布恢复源码绑定，但 Node 托管启动器原先仍只用旧 `INSTALLED_BINDING_V6.platform` 校验租约。新恢复 release 的正确租约会在应用装载前被启动器拒绝；不能直接把旧镜像配上新租约投入验收。

本轮在原 `ops/platform-hosting-v1/control-runtime.mjs` 中复用准确的源码选择规则：恢复描述为 PUBLISHED 时，先调用既有 `assertRecoveryPublication` 完整检查描述，再用其 release 校验公开租约；否则保持原 V6 分支。不存在环境变量、清单、URL 或 CLI 的协议/发布对象覆盖入口。已发布 binding、release、包引用和97文件云执行闭包不改。

启动顺序仍是公开入口/源码绑定/租约/来源核验成功，才建立惰性私密能力；错误、过期、未来时间、时钟回退或来源不匹配均不能提前读取控制数据库地址或私钥。30分钟上限和到期不可重新开启的语义不变。默认容器命令仍为关闭控制能力的普通 Web 启动，只有另行受审的显式托管参数及匹配租约可开启控制入口。

最终容器额外复制两份公开模块：恢复 `binding.mjs` 和其引用的 `platform-cloud-v6/contract.mjs`，不复制完整源码、配置文件、私钥或安装工具。CI 的25秒合成租约改为使用同一源码选择器，避免启动器和应用各认一个 release；原健康检查、未认证401及到期后健康200/私密能力null检查保留。镜像构建路径增加这两个源码依赖的触发规则。

## 验证与当前边界

本地72项托管/承载/旧流程兼容测试通过，零跳过；定向 lint 和 typecheck 通过。首次本地 HTTP 测试在沙箱内因临时127.0.0.1端口 EACCES 失败，随后仅对同一组无凭据测试使用允许回环访问的环境验证通过；没有启动真实平台入口或读取私密值。

代码推送后沿用现有 `platform-hosting-candidate.yml` 云端构建，不安装本地 Docker。该工作流只有 contents-read、没有 environment/OIDC/AWS身份或部署能力，运行非root、只读文件系统、禁网容器的三项冒烟检查，封存原始镜像 archive/receipt，并执行现有 OS HIGH/CRITICAL 门禁。只有实际成功产物的准确摘要和版本才能进入后续发布清单；不将草案、旧artifact或仅API元数据当成镜像字节核验。

本轮不读 `.env`、Secret 值或 PEM，不连 Neon/Aurora，不创建或更新 AWS/IAM，不供给运行时租约、不续租、不发布平台计划、不签发 App token、不调度 Review/RunOnce/Inspect、不发布 ECR 或部署 ECS。不重放 W9k/W9l/W9m 或旧承载/清理的永久槽。普通代码/测试入库不表示云端上线获批。

## 最短后续路径

1. 等待准确源码的上述无AWS镜像CI成功，核对其原始镜像字节与 receipt；失败仅处理直接阻塞项，不扩展支线。
2. 用该不可变产物准备既有发布角色的短时 Grant、单次 ECR 发布、成功或失败后立即 Revoke 及独立 Locked 核验清单。保留原发布槽，任何实际权限安装或发布须新 SHA 审批；不重新安装数据库或 GitHub App。
3. 绑定实际 ECR digest、现有固定 Secret 版本及准确承载栈，准备一次短租约/服务更新；尽可能复用现有资源，不新建 IAM。变更清单须说明 ECS 托管 Secret 重注入、可能的 TaskDefinition 替换/旧版本清理、服务中断、非原子/传播/并发和失败收费遗留风险，随后单独批准。
4. 用户已在线并确认可以配合后，再发布新 Review；后续 RunOnce 和独立 Inspect 仍分别审批，不提前开始短运行窗口。

50 USD/月仍是预算目标而非硬限制；没有在本轮新增 AWS 计费资源，未核查实际账单或运行task。原基础事实截止 `2026-10-27T18:47:57.695Z`（温尼伯10月27日13:47:57）不延长；到期前无法完成时停止并保留记录，不自动换任务、重新登记、刷新业务事实或延长 TTL。F3c9 与窄屏 UI 修复不进入本轮。

## 本轮实际回读

准确实现源码为 `5fcbc23ccaccec2c6a0fab8e732728a55b0b7ffc`。托管镜像 CI [40340097784](https://github.com/veinyyxy/TechlongSoftware/actions/runs/40340097784)（job121632196928、18步）与云执行兼容 CI [40340097748](https://github.com/veinyyxy/TechlongSoftware/actions/runs/40340097748)（job121632225191、26步）均为 push/attempt1、completed/success，所有步骤成功，准确 head/path 和分页完整性均已核对。镜像 artifact `12658433499`，官方 ZIP 长度307800935字节、摘要 `sha256:d16bc943e4ff7792f1782675717db3df8fd2e9a9c33532756fa60edaa7426745`；到期 `2026-10-29T14:32:46Z`。此处仅先记录元数据，独立字节核验结果须另有真实证据才可宣称通过。

用户另行允许的有限元数据核对于 `2026-10-26T14:34:49.100Z` 完成：Source STS1、AWS元数据37（上限45）、写0/私密值读取0/SQL0/槽消费0。最初准备命令因根依赖未安装 ECR SDK 在模块加载阶段退出，AWS调用0；随后使用既有 cloud-worker SDK 完成核对，未安装新依赖。原始文件为 `F:/ChatGPT_workshop/techlong-w9n-hosted-preparation-20261026-a/inventory.json`。

- 发布角色 ID `AROAV3GNMXTZID6CJJBA2`：trust 无 Allow、inline 显式 Deny `ecr:*`、无 managed attachment，boundary默认v1；原单资源发布栈 UPDATE_COMPLETE、无待审 Change Set。这里只记录读取到的 Locked 关键事实，不冒充完整新发布预检。
- Web执行角色 ID `AROAV3GNMXTZJ45S2ANZ7`、boundary默认v2、原两资源 access栈 UPDATE_COMPLETE；现有 inline 已含控制器/App固定版本读取条件。三个现有 Secret 均只有一个版本，准确 Web版本 `6ea2ca59-9a24-4f3e-b16f-ec824f32bc5f`、控制器版本 `3574f24e-ecb3-476c-8f71-baa501fd129e`、App版本 `0aee41e2-c4c3-4d4d-afca-9e68f66cd379` 均存在，未读其值。策略/版本元数据不证明凭据实际有效或可以签名。
- ECR仍仅两份旧镜像（registry digest `ad3cbde8…` 和 `81fb8157…`），不存在本轮发布；新镜像的 registry manifest digest 仍未知，不得用 image config digest 代替。
- 既有承载栈 UUID `c4bf36b0-cf13-11f1-b94e-06ffda9fc5c7`，UPDATE_COMPLETE、11资源、TaskDefinition `techlong-sandbox-platform-web-v1:8`。其控制租约在 `2026-10-25T15:11:07.370Z` 已到期；本轮未续租，也未查询运行task/健康或执行清理。**栈仍保留，承载可能持续计费**；不能把控制能力到期说成服务自动销毁。

下一份发布/更新清单优先复用这些实际资源和固定版本，不重新创建 Secret、重设密码或安装角色；仍须执行前新预检，快照不是跨服务 CAS 或未来授权。现有承载和镜像不会被本轮自动删除。

## 独立镜像字节核验完成

从上述准确成功 run 下载镜像 ZIP 和安全摘要 ZIP，均与 GitHub 的原始长度/摘要一致；使用既有三文件 allowlist 解包器，只接受 `image.tar.gz`、`image-receipt.json`、`SHA256SUMS`，不安装本地 Docker。再用原有 image-artifact 校验器完整读取307799937字节镜像 archive，确认：

- archive SHA256：`e91fd462db78dd3bd28f5b0ae7d313db9f1604d33dc77c0619e6e10a6cce54bb`；receipt源码/runId及两行 SHA256SUMS 全部匹配。
- image config digest：`sha256:23fbf299930cdd5883579d296adc40ff789d4acc9881587bbeb3a93f87a7ab90`。这是镜像配置摘要，**不是 ECR registry manifest digest**。
- 独立下载的安全摘要绑定同一源码/run/config digest，`OS_HIGH_CRITICAL_ZERO`，HIGH0/CRITICAL0、18项OS包；不允许忽略 unfixed 或 finding。完整报告和构建门禁来自准确成功CI，并非本机重复扫描或应用无漏洞保证。
- 97文件云执行闭包再次纯本地核对仍为 `30a7cdf74b50563afbc73f4a6b62661962d83127c3e409b627d11e5b3b91e374`；W9m已发布绑定未改。

结果 `CANDIDATE_ZIP_ARCHIVE_RECEIPT_AND_SCAN_INDEPENDENTLY_VERIFIED_NOT_ECR` 保存于 `F:/ChatGPT_workshop/techlong-w9n-hosted-preparation-20261026-a/image-readback.json`。公开准备摘要 `ops/aws-sandbox/reviews/platform-recovery-hosted-bootstrap-v1.prepared.json` 记录8项原始证据（包括ZIP/archive）的长度与SHA，保留W9m父记录。原始镜像保存在该本地证据目录，不提交GitHub。

**本小阶段完成，尚无可执行云写清单。** 唯一下一步是针对本不可变产物适配既有单次发布入口，保留两份旧镜像和旧槽，准备新的必要工作流绑定/临时Grant→单次发布→立即Revoke清单；不重新构建候选或把旧发布批准转用于新镜像。ECR发布、运行时供给/服务更新及后续业务操作仍各自批准。
