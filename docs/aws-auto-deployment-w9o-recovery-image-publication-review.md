# W9o — 新恢复镜像单次 ECR 发布与立即撤权

本轮只准备固定适配代码、受保护工作流及待审清单，不因代码入库安装AWS权限、dispatch或发布镜像。旧发布入口/默认产物和已消费槽保持不变；原97文件云执行闭包、源码绑定与业务状态不改。

## 固定产物与最小资源范围

唯一候选是W9n源码 `5fcbc23ccaccec2c6a0fab8e732728a55b0b7ffc` / producer run `40340097784` / artifact `12658433499`。官方ZIP307800935字节，SHA `d16bc943e4ff7792f1782675717db3df8fd2e9a9c33532756fa60edaa7426745`；archive SHA `e91fd462db78dd3bd28f5b0ae7d313db9f1604d33dc77c0619e6e10a6cce54bb`；image config `sha256:23fbf299930cdd5883579d296adc40ff789d4acc9881587bbeb3a93f87a7ab90`。既有独立字节/扫描证明保留；云端自检重新load同一原始镜像并检查，不重新build或用新源码冒充原产物。

复用账号402010193138、ca-central-1的 `TechlongSandboxPlatformImagePublisherV2`（RoleId `AROAV3GNMXTZID6CJJBA2`）、现有单资源publisher栈及准确ECR仓库 `techlong-sandbox-platform-web`。边界不改，不新建身份、仓库、Secret或Cell。预状态必须为Locked、完整授权/资源/工作流布局匹配，且仓库准确保留两份旧镜像 `81fb8157…`、`ad3cbde8…` 及其原tag；不接受额外对象、分页或新tag已存在。

## 未来单独批准的执行

1. Source最多一次原栈UpdateStack，仅对现有角色安装带日期条件的trust及同仓库inline授权；精确固定新reusable commit、caller、操作源码、actor、environment和产物，不新增boundary权限。最长一小时，从实际执行开始计算；批准清单最长48小时且受原artifact到期限制，最晚提前一小时开始。
2. 单次dispatch新caller，由用户亲自批准该准确run的 `techlong-sandbox-deploy` environment。不可Run/Re-run或批准其他run。受保护reusable先验证自身OIDC revision并checkout该不可变源码，完整复验ZIP/archive/load配置、三项禁网容器smoke和新鲜OS HIGH/CRITICAL零结果，再请求一次900秒AWS会话及一次顶层docker push。
3. 无论Grant、校验、dispatch、运行或审计成功/失败，Source均立即进入一次Revoke尝试及独立Locked回读。先等待已提交CFN更新有界结束，不重复Grant/Revoke、不使用直接IAM补救；审计intent写失败不压制唯一Revoke尝试。成功后准确tag读取原始registry manifest，验证其config链接和manifest SHA，再要求仓库只有两旧加一新镜像。不能将config digest当成registry manifest digest。

独立永久槽 `F:/ChatGPT_workshop/techlong-recovery-image-v1.source.intent.json`，保留所有旧槽。占槽后不自动删除、复位、补齐、回滚或重放；未知ACK/部分结果保存现场。只读Inspect不能写云或修复权限；需要额外恢复动作时另审。

## 完整风险

CFN、IAM、GitHub、ECR与本地主分支非原子，元数据不是跨服务CAS；并发漂移、传播、失效凭据、超时或未知提交可导致部分授权/镜像遗留。Source采用AWS Login自动刷新；刷新失效或进程中断可能阻止及时Revoke，日期条件不等于立即撤销已签发STS/ECR token。Revoke后仍须独立证明Locked；失败不冒称已撤权，也不自动重试。CFN可能维护/清理旧IAM policy version，DisableRollback意味着失败可能保留部分状态。

Source/现有Git凭据只在内存使用，GitHub OIDC/900秒STS/ECR registry认证有提供者、日志和网络暴露风险；临时Docker认证目录会尝试清理，但进程中断或清理失败可能遗留。单次顶层push不是只有一次底层网络请求，Docker/ECR可能内部重试分层上传，不能保证绝对只写一次。新镜像保留将产生存储、扫描和流量费用，50USD/月仍是目标不是硬上限；低成本不等于零费用。不会自动删除镜像或清理旧收费承载。

不读取Secret值、PEM、.env或数据库，不部署/更新ECS、租约、域名或业务任务，不签GitHub App token，不重新构建镜像。原业务基础事实截止 `2026-10-27T18:47:57.695Z` 不延长；镜像发布窗口不自动授权或延长后续业务执行。实际发布必须确认准确新清单SHA和上述范围；本风险文档或准备摘要本身不是执行批准。
