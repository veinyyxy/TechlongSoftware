# W7g：原镜像真实云端自检与发布/撤权候选

2026-10-21。用户要求继续，当前仅准备与验证。**本页不是IAM安装、workflow dispatch、AssumeRole或ECR发布许可**；尚无可执行的发布批准清单。旧失败栈、旧未执行Change Set及全部创建槽不再操作，V2身份保持锁定，不扩展F3c9/数据库支线。

## 当前只读事实

候选仍是原No-AWS run39656845292 / source `e06498436dab7022f6fb6ab4f450689fd3c6722e`，push/attempt1、准确workflow391864582、completed/success。准确artifact12371098858仍expired=false，329772909字节，官方ZIP摘要 `sha256:3b7764998422bfe07381a758d75e3463cf3ab91770a25dd75d8b98faac182855`，到期2026-10-24T18:55:49Z。不能把产物元数据核对称作实际镜像字节/容器验收。

20:08:17.708Z通过当前仓库的现存Git凭据助手仅认证GET读取OIDC及环境元数据（连接器不支持这些端点）；凭据留在内存，只发送api.github.com，不输出、不读取App PEM、不修改设置：

- use_default=true、use_immutable_subject=true；sub前缀为 `repo:veinyyxy@14145707/TechlongSoftware@1323312747`。
- 仅一个既有环境techlong-sandbox-deploy；required reviewer为veinyyxy、can_admins_bypass=false、prevent_self_review=false；准确main branch policy一条。将来复用该环境须人工批准，不新增环境或改保护。
- 新拟用subject为上述前缀加`:environment:techlong-sandbox-deploy`，不使用旧name-only subject或改变仓库OIDC格式。

20:10:31.552Z仅AWS元数据核对：Source准确，V2栈CREATE_COMPLETE，实际RoleId=`AROAV3GNMXTZID6CJJBA2`及no-Allow trust保持；原boundary为v1/usage1，inline原ECR-only，仓库零镜像、无repository policy，registry BASIC/rules=[]。现有OIDC provider URL正确且aud包含sts.amazonaws.com。没有读取Secret/PEM/.env或申请角色会话。

证据：

- `F:/ChatGPT_workshop/techlong-platform-image-publication-w7g.github-metadata-20261021.json`，SHA=`93245d39447a770f62bff4757ee3cfb5cceb6cbe303d9cd20cf5cdf1e4ab700c`。
- `F:/ChatGPT_workshop/techlong-platform-image-publication-w7g.aws-metadata-20261021.json`，SHA=`12c2fb4e46ae947ea126c51bfc4499700cf3eccf47093986cecbf6edbd7adc71`。

## 工程实现：先证明同一份真实镜像，后谈授权

新目录 `ops/platform-image-publication-v1/` 与No-AWS工作流 `.github/workflows/platform-image-publication-candidate.yml`：

1. 重新读取准确producer run及artifact；限定source/run/workflow/attempt/官方ZIP digest/大小/期限，不用重跑旧构建或自签receipt代替来源。
2. GitHub token仅具contents/actions read，交给官方artifact API；重定向后只接受Azure Blob HTTPS存储、不转发GitHub认证、不打印临时签名URL。流式校验准确329772909字节及官方ZIP摘要，再处理ZIP。
3. ZIP仅允许三个准确普通文件，拒绝目录、重复条目、symlink、路径穿越、加密或超限条目；排他创建新临时目录/文件。校验原archive SHA、receipt和SHA256SUMS。
4. 云端docker load**同一份**压缩镜像，不重建；直接inspect准确config digest `sha256:98591bc59ab26105f6d60c1b2b3d70c853fd56846109b09f9561c3acd53610a3`，复用原镜像non-root/命令/env/Volumes/OnBuild检查。
5. 同一image ID重跑anonymous GET及固定HTTPS Origin两个容器自检，--network none、read-only、无DB/Stripe/AWS凭据；不是实际HTTPS/TLS/管理员登录验收。
6. 校验Trivy0.75.0官方发布资产摘要 `c6e65abddb348e25f10549df887045629cf28cc72453cd1c63acb717316b3f3f`，使用job内新DB和空ignore，从空目录/清空继承环境运行OS扫描；不忽略未修复HIGH/CRITICAL。要求准确image ID、支持的Debian12/13、至少10个OS包、DB不超过48小时；发现高危即失败，不触碰IAM。

Trivy版本/资产SHA本轮独立读取官方GitHubrelease确认。小型摘要会保存image/source/ZIP/DB/report digest和最多200条HIGH/CRITICAL的CVE、包及修复版本；不上传原330MB镜像、完整包清单或任何凭据。证据保留3天，可能占用少量GitHub Actions存储/执行额度，不升级plan。原产物到期不变。该扫描仅OS范围，不代表所有npm依赖、应用逻辑或完整供应链绝对安全；ECR最终manifest digest及服务端扫描仍未发生。[Trivy官方发布](https://github.com/aquasecurity/trivy/releases/tag/v0.75.0)、[ECR Basic扫描范围](https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-scanning-basic.html)。

本地8项新Node测试＋14项相邻恢复/身份测试共22项通过；Python三项真实合成ZIP测试通过，覆盖正常排他解包、路径/重复/额外文件和symlink拒绝。类型/scoped lint通过。Windows商店Python alias不可执行，沙箱又限制临时文件；最后使用已安装bundled Python在正常临时目录完成测试，没有安装新软件。云端实际bytes/load/smoke/scan结果另行记录，不能拿这些合成测试当作云验证通过。

## 授权与收尾候选（只有纯模板，没有执行入口）

`plan.mjs` 已实现 `grantTemplate()` / `revokeTemplate()`；当前都只是返回模板对象，不带客户端，不安装权限。将来只有在真实镜像自检通过后，才接线固定源码的受审发布workflow与本机收尾，并生成具体批准清单：

- Grant仅改V2角色trust及同一个inline的时间条件，boundary/角色名/其他资源不变。OIDC限定准确provider/aud/immutable sub/repository ID/owner ID/actor ID14145707/main/environment及准确可复用workflow完整commit，不用分支或通配workflow引用。最多一小时，同时在身份ECR Allow上加相同DateGreaterThanEquals/DateLessThan。
- 未来唯一目标tag为 `platform-shae06498436dab7022f6fb6ab4f450689fd3c6722e-r39656845292-a1`，准备用同一config ID推入准确现有仓库。IAM仍是仓库级，不假称已经限制到单个tag。
- Revoke关闭trust全部Allow，**同时把该inline替换成显式Deny ecr:* / Resource=*，而不是恢复原ECR Allow**；这是比当前初始锁定状态更强的新配置，须明确批准。原managed boundary不改默认版本，避免引入旧版本清理问题。

仅关闭trust不会终止所有已签发会话，ECR授权token通常有效12小时；显式Deny/时间条件仍有传播与在途请求风险，不能保证瞬间使所有凭据失效。未来仍须承诺成功/失败后立即尝试Source收尾并独立核验配置；Source自动刷新失效、程序中断或AWS错误可能留下Grant，不能承诺自动回滚。不可用“配了截止时间”替代真正收尾。[ECR认证token](https://docs.aws.amazon.com/AmazonECR/latest/userguide/registry_auth.html)、[AWS当前支持的GitHub条件键](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_iam-condition-keys.html)。

AWS当前官方列有actor_id、job_workflow_ref、repository_id等GitHub条件键；GitHub旧教程仍写custom claims unavailable，本方案以AWS当前条件键文档和后续实际受审身份验收为准，不修改仓库subject定制或擅自放宽失败条件。

**本阶段还没有真实publish runner、reusable workflow发布、IAM执行器或获批执行清单。** 如果镜像扫描失败，先报告证据并修复候选，不先安装Grant；即使No-AWS全部成功，仍需完成实际发布/失败收尾接线后再请求新SHA。现有权限始终保持初始no-Allow状态，不运行旧grant/role/worker/job脚本、不删除资源。

50USD/月目标不变；镜像上传将新增ECR存储等费用，后续托管和清理仍分审。两小时hosting窗口未开始，本轮不连接Neon、不创建Secret/Cell/ECS/ALB/DNS。
