# F3b3：已安装 Neon 只读探针的单次调用清单，未执行

> 本文保留准备时状态。2026-10-11 批准后已一次调用，真实 Neon 只读/保护预检与两次独立日志核验通过；sourceGate=ADMISSION_NOT_DRAINING、业务 runtime 仍关闭。新 slot 已消费，禁止重放。当前结果见[实际只读验收与下一阶段](./aws-auto-deployment-fast-track-f3b3-neon-readonly-verified.md)。以下不是新的执行授权。

2026-10-11 Winnipeg。上次一次代码更新后，候选已就绪，但更新响应 RevisionId 与完成态不同，旧协议停止且未 Invoke。本阶段独立 invoke-only core/入口复用现有候选和读回工具，**不改旧 17 文件 binding、旧门禁、已消费槽位或 Lambda 代码**。当前仅本地实现、定向验证和 AWS 只读 Review，调用=0、Secret 值读取=0、Neon 连接=0。

## 唯一拟执行动作

准确函数 **arn:aws:lambda:ca-central-1:402010193138:function:techlong-sandbox-cell-ttl-executor-v3** 一次新的同步 RequestResponse Invoke，独立分页云日志核验。**代码/配置/标签更新=0，IAM/Key/Secret/业务数据写=0，Cell/ECS/Schedule 或业务 runtime 安装=0**。正常调用允许写自身现有 7 天保留日志组的日志流/日志；不创建或改日志组配置。

复用已有 `TechlongSandboxCellTtlExecutorRole` / `techlong_cell_cleanup_reader`、自身准确 Secret 初始 UUID `3f8047d4-e357-4d32-ae87-861fda5f8253` + AWSCURRENT。在 Lambda 内存校验 URL、完整密封证书和 pin，随后一个 Neon HTTPS/TLS 十 SELECT 的只读 Serializable Deferrable 批次，回读服务端事务设置/受限角色/完整原件/保护 catalog/关联。不增加 drain 写、DeleteStack、权限或数据库角色/密码/schema/业务/admission/authority 修改；Source 不 GetSecretValue。

原已安装探针事件协议与 SQL 不改；新随机 nonce 与上次未执行事件不同。admission=open 只报告 `ADMISSION_NOT_DRAINING`，不伪造 certified ownership 或改成 draining。完整 v3 source 通过也不等于授权删除、业务 drain 或自动部署上线。[既有探针只读合同](./aws-auto-deployment-fast-track-f3b3-neon-readonly-probe.md)、[真实安装与上次停止](./aws-auto-deployment-fast-track-f3b3-neon-readonly-installed.md)。

## 完成态和全量前序绑定

- 已安装候选 ZIP **0f2330afbef3e801faf3645f96610d293349705743ae0748de22198391a25533 / 277794 bytes**，既有私有 p1 ZIP/source pins 复核，不重建/上传。
- 完成态 RevisionId **80270648-9f62-488b-a99c-4d6a86558302**；不再比较已过渡的更新响应 09c85932...，旧比较门禁与失败记录仍保留，不修改或重放。
- full anchor **33a5f0257d699b689fa0ec4aa4d852ca5f67aba1e19fdc130d5d893fc3280301**，包含 TTL 代码、RevisionId、LastModified、runtime version 与完整配置/标签/IAM/Key/Secret 元数据；stable anchor **3d373a6602d2bbcc111b8879ffa37385ef5a7ce74d9bbad1f7390dbe18d5689a** 同时匹配，不仅凭 ZIP/状态采用对象。
- 前序批准 c3635097...、失败回执 99647753...、两次独立 Inspect 1750fbd0.../5ebd0746...、更新 confirmed 96cd7624... 的完整 SHA 均绑定，旧 slot 必须不存在 Invoke attempt/response。新入口不能当作重试未知调用；前序已经证明本地 Invoke=0。
- 原 17 文件 code SHA **d7919f4aa2827b89276198d731c2e2f444d88b4165a7c52a81c3e58d6c172aba**、原安装 10 文件 binding、p1 源/ZIP/lock 不改。新 20 文件绑定包括三个 invoke-only 生产文件。

Source 仍仅 `techlong-sandbox-user` / `arn:aws:iam::402010193138:user/techlong-sandbox-dev`，同一批当前凭据校验 STS，SDK maxAttempts=1。只模拟准确函数的 `lambda:InvokeFunction`；不以 UpdateFunctionCode 权限作为前置，不新增权限。

## 一次性与不能消除的风险

新永久槽位 **techlong-f3b3-readonly-neon-sealed-invoke-v1-consumed** 当前为空，不复用或 reset 旧 slot。Run 必须 fresh SHA/完整 code binding/前序回执/对象全 anchor 匹配，先持久批准和 intent，再最多一次调用。HTTP 签名请求只同步 Invoke、LogType=None、固定 AWS endpoint、不重定向/SDK调用重试；原始响应在内存经闭合校验后才保存，云日志 functionArn/requestId/nonce/完整响应 SHA 独立匹配。

消费后仅 Inspect，任何负面/超时/失响应/marker 失败都不补调、自动回滚/撤权/删除/补齐/复位或重试。回执 `invocationAttempts` 是已保留的调用尝试数，失响应时不能据此认定一定执行或一定未执行。

调用前完整快照核对与最后一次代码/RevisionId读回不能成为 Invoke 服务端 CAS。AWS Invoke API没有 RevisionId 比较参数；在读回与执行之间仍可能并发更新，外部已授权主体亦可额外调用，不能宣称全局 exactly-once。[AWS Invoke API](https://docs.aws.amazon.com/lambda/latest/api/API_Invoke.html)。本次不创建发布版本/别名以改变已确定范围，风险须明确接受。

URL/密码仅在 Lambda 内存及加密 HTTPS 请求中传至 Neon，不落本地/Git/原始日志；不能保证 JS 清零或提供者日志绝不记录。HTTP 中止不保证已提交的远端只读查询立即取消。请求/计算唤醒/Lambda/Secret/KMS/日志可能计费；**50 USD/月仍是目标，不是硬上限，低成本非绝对零费用**。

## 本阶段验证与当前待批 SHA

8 项新定向 + 10 项既有 probe 回归共 **18 项通过**，覆盖期限/SHA、已消费slot、Revision/full anchor/权限漂移、intent失写、失响应/期限变化和无代码更新端口。typecheck/lint/两脚本语法通过；既有 wire/Neon 网络测试明确 mock，不是实机证明。不重复 Docker/PG/GHA/镜像演练。

r1 只读 inventory 起点 **2026-10-11 16:26:46.045 UTC / Winnipeg 11:26:46.045 CDT**，完整集合 12.251 秒内结束；代码/Revision/full+stable anchor/配置/IAM/Key/Secret 均与完成态一致，准确 Invoke 模拟 allowed，仅预检。没有云更新、调用、Secret 值读取、Neon 连接或业务数据写。

清单：`F:/ChatGPT_workshop/techlong-f3b3-neon-sealed-invoke-20261011-r1/review-manifest.json`。

- manifest SHA：**76cadd00835f523d4cd63e2052ccd08badfe25af299dff7bb77b62b7bab76b1f**。
- 文件 SHA：`dee930d02ecb69d8ea7ec74e3fa0fa8fb1d69534115124737a610b94159793a6`。
- 新 20 文件 code SHA：`c120e4c6ac87ee80289088fba9f98316eae0641ff003ba55eb4cd6414beff7e3`。
- inventory 文件 SHA：`ad6798a7bdc0ea6c3d89036fbc00c3dd9a9feba1cf4206740108a6c926f273c4`。
- 截止：**2026-10-11 17:26:58.296 UTC / Winnipeg 10月11日 12:26:58.296 CDT**。过期仅只读 Review 后另确认新 SHA；消费/未知结果不得刷新重放。

> 我确认按清单 76cadd00835f523d4cd63e2052ccd08badfe25af299dff7bb77b62b7bab76b1f，仅一次同步调用已安装 TTL 只读探针，使用自身固定 Secret 的 reader，经 Neon HTTPS/TLS 提交一个十 SELECT 的只读 Serializable Deferrable 批次，允许既有自身日志并独立核验；不更新代码/配置/IAM/Key/Secret，不改 Neon schema/业务数据/admission/authority，不创建 Cell/ECS 或启用业务 runtime。接受调用无服务端 RevisionId CAS、外部并发/额外调用、提供者日志/远端只读请求可能继续风险，永久新槽位不自动回滚/撤权/删除/补齐/复位或调用重试，以及低成本非零费用。

确认后只 Run 一次，再新进程 Inspect。成功仅证明具体只读/保护门禁；如 admission 尚未 draining，继续保留原条件，不能据 preflight 自动开启业务或生成 authority。
