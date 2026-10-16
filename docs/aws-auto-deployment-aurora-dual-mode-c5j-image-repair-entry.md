# C5j：仅修复原 workload 的应用镜像（固定执行边界 / v1）

> **2026-10-16 00:29 UTC 已停止 / 不可批准执行。**真实只读发现准确旧栈已由旧 Janitor 删除；本轮未生成有效执行 SHA、未更新服务、未消费槽。以下是已实现但被预检拦截的原镜像更新设计，保留用于追溯，不是当前恢复方案。不要运行 Run 或重建同名栈来绕过准确旧 UUID。见 [删除事实与主线恢复边界](aws-auto-deployment-aurora-dual-mode-c5j-deleted-workload.md)。

本文件是新批准绑定的完整风险文件，不是执行批准。C5i 已发布修复镜像并独立验证 Locked/v10；不得重放旧发布或 C5h 的17槽。F3c9 等支线仍封存。

## 唯一变更

Source 对准确旧栈 `techlong-sandbox-tenant-9c5ee9e64509dcad/863828e0-c8d6-11f1-bd9d-06fff5ad0437` 提交**最多一次 UpdateStack**，复用既有 `TechlongSandboxCloudFormationExecutionRole`，不安装权限，不创建 Change Set。

- `ImageUri` 从 `sha256:5e42b2de7e0cc81b1c83a8abb21c866eeedc8801ddf50e686d116a5837caa004` 切至 C5i 实际 ECR digest `sha256:0dc34eda11fba65ca217aaa589ea527d88402991864b8bfbac6da00f4496f15e`，应用源码为 `10fe3c41b97941f5c7755bdcd9f43aee2d5a0ea2` 的 UUIDv8 修复。
- 模板仅改同一容器的 `APP_IMAGE_REVISION` 字面量为相同新 digest。其余模板、19项参数（包括两项 NoEcho）全部沿用；不重新装载值。完整原 tags 保留，不延长 ExpiresAt。
- 原七资源中，CFN 会登记替代 task definition，并更新原 ECS Service、调度替换任务。其余六个逻辑资源物理身份必须保持。不是“云端零创建/零删除”：CFN 可清理旧 revision、ECS 会停止旧 task 并创建新 task/ENI/日志流。
- 保持 Fargate 512 CPU / 1024 MiB、desired=1、公网IP、listener/DNS、五项固定 Secret 版本、角色、数据库绑定/配置hash、owner/generation/epoch不变。不更新 lifecycle 镜像。

## 新窗口及检查

新清单接纳窗口为生成后两小时，独立于**已经过期**的旧 workload/父 Cell ExpiresAt 和旧 job lease。批准明确接受这些旧标签原样保留；本次不续租、不清理或改写它们。窗口仅约束提交，不是服务运行TTL或费用截止。Run 先重新读取当前身份、CFN/task两类角色及 boundary、原栈/模板/参数/七资源、服务/实际任务、ECR manifest/扫描、DDB两个namespace、target健康和DNS。与审核快照及源码不符就停止。

只读检查最后补查栈，整组不超过180秒、提交距核对完成不超过30秒。这仍不是跨服务 CAS，也不能防止特权方并发改 IAM、DNS、数据或资源。NoEcho掩码不能证明其明文内容；本次用 `UsePreviousValue`，并核对实际 task 的固定版本引用/spec摘要，不读取 Secret 值。

固定永久槽为 `F:/ChatGPT_workshop/techlong-express-c5j-image-update-v1.permanent-slot.json`，在提交前独占创建并 fsync；换输出目录或 SHA 不增加尝试次数。每个 AWS SDK/CLI 显式调用 maxAttempts=1；客户端令牌用于归因及提供者幂等，不授予自动重试。槽一经占用，响应丢失、拒绝、文件失败或超时也**不自动重试、复位、补齐、删除或调用补偿**。Inspect 是新进程独立只读，不重放写入。Review/Inspect 不消费云写槽。

## 必须接受的完整风险

1. **非原子和并发**：IAM、CFN、ECS、DDB、DNS和提供者只读不是同一事务，无跨服务锁。预检和物理ID检查不能完全消除竞态；部分更新/状态未知可遗留运行/收费资源。
2. **中断/回滚/可用性**：本次 `DisableRollback=false`，保留原 ECS circuit breaker rollback。CFN/ECS 提供者可自行回滚或清理旧 task definition，脚本不调用回滚。MinimumHealthy=0/Maximum=100 的单副本替换可能先停旧任务，造成服务中断；新任务失败、回滚失败或超时须只读核对，不能盲重试。UpdateStack响应仅表示开始，最长30分钟轮询不等于平台部署成功。[AWS UpdateStack](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_UpdateStack.html)、[task definition replacement](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ecs-taskdefinition.html)。
3. **权限及私密暴露**：不新增 IAM，不由操作器读取 Secret 值或原私密包。但是新 ECS task 会用原执行角色读取同样固定版本 Secret 并在容器内注入；应用仍持有既有数据库连接能力。重启/bootstrap/健康检查可能触发应用正常数据库活动，不能宣称整个 AWS 系统零 Secret 读取/零数据库连接。提供者/服务日志仍有元数据与运行时暴露风险；本入口不采集业务日志。
4. **费用**：50 USD/月仅目标，非硬上限；既有 Fargate、ALB、网络、Aurora、ECR、Secrets、日志继续收费，新任务/ENI/镜像下载/扫描也可能收费，旧过期标签不自动停费。重启可能恢复 Aurora 并产生 ACU/I/O费用。没有安装自动停止/清理器，不能保证总成本低于目标。
5. **来源与供应链**：复用 C5i 固定 ECR manifest/config digest 和扫描 COMPLETE/HIGH0/CRITICAL0；扫描时点与无高危发现不保证绝对安全。仅单容器/实际运行 digest、模板和完整 task spec比对通过才算镜像更新已证实。
6. **初始化与业务状态**：上次 provision HTTP500，事务回滚尚未独立证明；不重复 POST、不调用私密控制接口、不连接 Neon/Aurora、不读取原私密包、不改租户数据/Schema/Secret/DDB/DNS/平台 job/lease/ready。旧 job lease 已过期，不能借本次镜像更新续租或把平台标 ready。成功只称“原服务修复镜像运行且 bootstrap healthy”，不称 initialized 或端到端自动部署完成。
7. **后续恢复仍需新批准**：镜像成功后先设计单独受审的应用/SQL只读状态核验；根据是否已初始化决定是否需要单次 provision 恢复及平台引用/lease协调。不得重跑旧计划、自动更换 owner/epoch、重建 Cell/数据库、restore/seed或扩展已封存支线。

## 使用

在平台仓库根目录用 Node22 运行 `ops/aws-sandbox/scripts/review-express-image-repair-v1.mjs`。`Review` 只读生成清单；`Run` 必须指定该清单和人类确认的准确 SHA；`Inspect` 同样校验绑定但不要求窗口仍有效。每次输出目录必须是新的 `F:/ChatGPT_workshop/techlong-express-c5j-*` 直属目录。源码/风险文件/历史证据变化后旧 SHA 失效，不能伪造新批准。

本文件固定，不把实际执行结果回写进本风险文件；审核/执行证据分别另存，旧记录保留。
