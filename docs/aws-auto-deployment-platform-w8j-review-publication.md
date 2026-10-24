# W8j：准确heldjob的Review计划发布准备

## 前置事实与目标

W8i的`job_6e2e115c80301595512f11fb`已单次登记、独立核验，本机入口已关闭。它仍是pending/attempt0/max1/审核挂起，无lease或云执行授权。本轮不再创建任务，不复活旧canceled任务，不重放旧W6m发布。

准备沿用现有trusted publisher、窄`publish_plan`函数、来源身份和证据桶，为该job发布一个Review计划。**计划、operator及新控制租约必须绑定最终受审的同一main/CI**；镜像产物源码仍为`f3cea2da7d26dfc09726c4cbc52cab40217340c6`，固定摘要不变。新兼容证据逐一证明应用/控制器/托管运行时代码及81项云闭包文件相对于产物源码未变；只允许operator、测试、文档和明确列出的候选/发布工作流差异，不重建镜像或放宽main门禁。

### W8k发现的源码绑定纠正（旧清单不可执行）

前一版把计划源码固定成镜像产物f3，忽略了既有GitHub适配器的`head.object.sha === plan.sourceCommit`及`ref:main`要求，因此会被`CONTROL_MAIN_DRIFT`拒绝。已生成但**未执行**的`e0043a11b496f9b93284c34a526305d48ae1d981c399db19c103698558413f98`清单保留作历史，现已被替代；不得发布。无旧计划、写调用或槽消费需要补偿。

修正后分别记录`imageSourceCommit`（产物出处）和`runtimeSourceCommit/sourceCommit`（受审执行源码）。W8k拟仅更新容器一个公开环境变量与ControllerLease，使租约、计划、main匹配；镜像标签/摘要及Metadata.ImageSource仍诚实保留f3。原运行时验证的是该公开绑定与租约相等，并未把它当作不可变OCI标签。详情及独立更新授权见[W8k](aws-auto-deployment-platform-w8k-hosted-window-review.md)。

**最终两份清单准备后，直到本job的Review→RunOnce→Inspect结束冻结main**。计划发布、窗口更新和后续验收证据只记F盘及本地检查点，不在中间提交新证据；完成后一起提交。任何必要代码修改都必须停下、保留旧记录并重新审核，不绕过main校验或把旧批准平移到新源码。

## 本轮实际只读准备

复核本地W6w准确manifest、安装引用、第一段lineage及独立Inspect缓存；仅缺失的上一代`provider-after.json`通过原Source身份一次STS核对、一次S3准确版本GET补齐。没有读取Secret值、PEM、原私密控制包、本机认证文件或Neon。补齐原件`F:/ChatGPT_workshop/techlong-platform-w8j-provider-predecessor-20261023.json`，SHA `a5dfb9f6919906fd333c0a3584dd5a6409531ee8a0b599083a40ea7a55a331b7`。

两段沿革从原W4c锚点，经W5r成功及独立验收，再到最近W6w成功job `job_c6cb047ac3ff30ed51ba9f34`。复用原`continueCloudContextV5`逐段核对完整manifest、成功回执、provider投影和独立Inspect，未伪造或重盖时间。该事实是**历史证据，不是当前资源健康或已退役证明**。

本地准备数据`F:/ChatGPT_workshop/techlong-platform-w8j-lineage-prepared-20261023.json`，文件SHA `67cadcb955b379d478338018c438f997e9dc415ce289919c21373bc0cfe300b9`；两段lineage内容SHA `7ad860d750474ab8e3a9eb50539e736cab5c4e1d67da0ee390caecc836b406c1`。业务/历史快照留在本机及既有私有证据桶，不复制到Git。

## 拟议单次执行范围——尚未批准

- 准确新job及九行/六旧job摘要绑定W8i独立回读；SQL前重新核对，不修改任何业务行或任务状态。
- 最多两次读取本机`.env.local`提取现有owner连接信息，发布和独立回读各一次；最多八个显式只读事务、两次Source STS读取及七次S3准确版本GET（发布最多6、独立回读1）。不使用GitHub token或App私钥。
- 最多一次条件S3 Put：既有桶`techlong-sandbox-cloud-worker-evidence-402010193138`，准确key `worker-v5/app_e897a4377bce498b9c5ee9e64509dcad/lineage/w8j-job_6e2e115c80301595512f11fb-v1.json`，`If-None-Match:*`、AES256及内容校验；不覆盖旧对象。
- 最多一次现有`deployment_control_v6.publish_plan`调用，插入一个准确Review计划。仅计划记录，不创建批准、调度attempt、任务lease或工作负载。
- 另进程独立读取准确plan，核对计划/动作/风险SHA、lineage版本、heldjob保持及计划1/批准0/attempt0。结果只表示“计划已发布”，不表示Review或部署成功。
- 新永久槽`F:/ChatGPT_workshop/techlong-w8j-review-plan.intent.json`及`.../techlong-w8j-review-plan-inspect.intent.json`，均独立于全部旧槽；消费后不自动复位、补齐或重试。

operator清单有效48小时，最晚启动留2分钟执行预留；实际发布时才新建原有两小时Review计划，不延长任何旧计划。**这里不启动或续期云控制窗口**。如还未备齐下一托管窗口的执行/验收材料，建议先保持本清单未执行，避免两小时计划在等待中到期。

## 完整风险

本机配置整文件读取可能使其他配置短暂进入进程内存，owner连接权限较宽；代码约束不等于数据库沙箱。存在本机、网络、TLS及提供者日志暴露风险，不能输出或提交密码、配置内容、Cookie、Secret、私钥或签名URL。

S3与数据库之间不具备原子性：S3对象可能保存而SQL失败，SQL提交可能成功而ACK/本地回执失败；独立回读也可能失败或计划已到期。固定永久槽可能在读取/写入失败时已消费。旧资源、部分证据对象和计划记录都不自动删除或补偿；任何失败/结果不明停止，不自动重试、回滚、复位或换槽。

源码、IAM/目录校验、空计划计数和旧行摘要是点时检查，不是跨服务CAS，不能消除并发竞争。两次heldjob读取及原publisher的admission不能保证之后云状态不变；实际Review仍会重新检查。Source自动刷新或临时凭据可能失败，IAM/S3/Neon可用性不保证。本次代码对SDK写入配置maxAttempts=1，不绕过审批或自动扩大权限。

S3版本和私有历史快照可能持续保留并计费，本轮接受低成本但非绝对零费用。**原2026-10-23 15:58:42 CDT承载意图已过期，仅为标签，不自动停止Fargate/ALB等收费；50USD/月目标不是硬上限。** 本清单不延长该标签或控制租约，不批准现有资源继续验收或清理，准确栈清理仍需另审。

## 工程入口及后续

`node --experimental-strip-types ops/platform-review-v6/followup-local.mjs`，模式`Prepare|Publish|Inspect`。Prepare仅核对public本地证据、元数据、准确main/CI并生成待审清单；不读取私密内容、连SQL或访问AWS。命令实现保存在工程，F盘只保存数据。

Prepare：`--mode Prepare --output F:/ChatGPT_workshop/techlong-w8j-review-plan-<标签> --ci-run <准确CI ID>`。Publish/Inspect需原`manifest.json`、`--approved-sha <manifestSha256>`及各自新的`-run`/`-inspect`目录，最终SHA未获批不得执行。先前a261清单仅授权请求登记，不能转移到本发布。

后续新托管控制窗口涉及更新现有ECS任务、再次注入三个固定Secret；真实App调度涉及签名/token/一次dispatch及用户GitHub环境审批。这些材料和授权仍需具体准备，不在本清单中。不得把本计划发布当作AWS自动部署已经完成，也不重做镜像/IAM/壳或扩F3c9。
