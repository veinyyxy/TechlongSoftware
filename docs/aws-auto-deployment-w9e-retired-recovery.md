# W9e：已退役、未完成独立验收的恢复候选内核

状态：用户已同意**仅实现本地代码、测试与文档**。本模块是未激活的候选，`productionEntryInstalled=false`；不是部署批准，不安装IAM、不改Neon、不调度。旧任务依然succeeded，其历史回执和原始失败/过期记录不改写。

## 实现范围

工程内 `ops/platform-recovery-v1/` 集中保存以下实现，不把可复用代码放在临时workshop目录：

- `basis.mjs`：重建并验证完整旧RunOnce内容、固定版本对象、准确成功回执和原provider观察；核对W9d完整业务/任务/账本/保护摘要以及准确UUID的七项已删除资源。公开基准始终标记 `executionSucceeded=true / independentAcceptance=false / retired=true / acceptedLineageAppend=false`。
- `request.mjs`：复用已有待审请求编译器，仅提出一条新held任务INSERT。SERIALIZABLE事务先锁控制历史、admission业务行和全部旧任务，前后重读完整状态；只允许一次永久槽声明、一次INSERT和一次COMMIT。提交不明只返回待独立核验，不自动重试或补偿。
- `worker.mjs`：独立类型的恢复Review envelope，调用既有V5内核，但保留真正accepted predecessor单独字段。每模式先经过外部明确批准端口及30秒内准确退役读回；原V5继续执行命名空间、外部authority、claim、completion、两次认证GET和独立Inspect检查。恢复基准不能作为旧accepted lineage输入，也不能由任意JSON反序列化后直接启用。
- `saved.mjs`：仅有 `PrepareSaved`，读取固定、逐份摘要校验的本地证据。没有网络、.env、PEM、连接、RunReviewed、执行、profile覆盖或安装端口。输出是候选，不能将其中SHA当成当前可执行清单。

业务写事务与候选worker都只接受代码显式注入的能力；模块导入不会创建客户端、发现凭据或连接服务。生产固定profile与测试合成profile分离，未来真实入口不得从manifest或命令行选择profile。

## 固定范围与保留项

恢复基准绑定旧任务 `job_9db8466fd95cef0c23ad6bfc`、RunOnce `40204548444`、源码fbad7cb、旧栈UUID `53f32460-d084-11f1-ad5b-0ee0206d8b5f`、原manifest与固定版本结果/描述符、准确回执和七项物理资源。当前事实来自W9d；其48小时事实期限不因再次Prepare延长。

待审的新请求固定为：

```text
clientRequestId  2afc13c3-1ce8-4ce2-9c71-5b9fded1404f
requestId        6fcf8b8da439ddac097d44fd529ebee0f0eea2644be718f31866243f8fd7b57b
jobId            job_9b57b43a6b88f37202b29170
```

**该任务尚未创建。** 如后续获得准确写清单批准，它将是reconcile/pending/attempt0/max1、available_at=9007199254740991、无lease、reviewRequired=true、cloudExecutionAuthorized=false。永久槽路径仅声明在代码中，本阶段没有创建、占用或复位它。

旧九条任务、全部成功回执、控制账本、订阅和客户权益保持原样；不取消旧成功、不重新初始化商户、不改资源generation/外部epoch、不恢复旧job的执行资格。不做Neon现状对账或F3c9，不关闭Janitor或延长旧TTL。

## 为什么不用旧Inspect补历史

已删除的旧承载无法补出期限内的规范验收。这里记录的是“有成功执行证据，且后来退役”，不是“当时或现在通过了独立验收”。旧81项发布闭包、accepted lineage规则、原TTL门禁和现有部署工作流保持不变。

候选worker的新envelope与现有V6发布/调度桥尚未安装接线；现有workflow不会因这些文件合入main而自动采用它。W9c跟进器也不能直接向旧发布桥塞入这个新envelope。后续需要显式完成并审查新桥/闭包绑定和必要trust pin变更，再准备一次新周期，才能让该周期RunOnce→Inspect闭环实跑。不能把本模块测试通过表述成AWS自动恢复已上线。

## 保存材料入口

```powershell
node --experimental-strip-types ops/platform-recovery-v1/saved.mjs --mode PrepareSaved --output F:/ChatGPT_workshop/techlong-w9e-recovery-candidate-20261025-a
```

只有clean main及完整原件才会输出候选基准。初版缺失的旧 `execution-reference-40204548444-v1.json` 原件，已在 2026-10-25 获单独限定许可后读回；固定 key/version/SHA、AES256 和长度均已核验，真实保存候选重建成功。原失败与缺失记录保留，不用推导对象冒充 S3 原件，也不重复该已完成的 GET。

本地证据池中的完整数据库快照不会写入Git或候选输出；只输出准确引用、摘要和不授予权限的状态。原始材料保存在工程外的受保护目录，旧闭包和永久槽不覆盖。

## 验证及后续边界

新增单元/接线测试覆盖完整证据、错误身份/版本/SHA/UUID/资源、已过期/未来事实、旧记录漂移、插入后逐行保留、不明claim/COMMIT、无重试、授权与陈旧退役前置拦截、真实V5 Review及原命名空间检查、envelope绑定和纯保存入口限制。

既有No-AWS CI加入该测试集和ESLint，并在原一次性PostgreSQL验证程序中增加三种实际SQL场景：成功单行插入、插入失败不留变更、COMMIT确认丢失后的独立读回。它仅连接GitHub job提供的localhost临时PostgreSQL，不读取本机.env或生产URL，不涉及AWS。

后续最小接线、准确范围和完整风险见 [W9f 恢复请求入口与发布桥](aws-auto-deployment-w9f-recovery-entry-bridge.md)。本文件描述的 W9e 内核仍不是部署批准；W9f 新入口另有 source/CI/pins/TLS 身份及 operator SHA 门禁。实际新held行登记、云代码发布/精确trust更新、Review/RunOnce/Inspect及私密材料读取，仍各按具体资源和新SHA批准。
