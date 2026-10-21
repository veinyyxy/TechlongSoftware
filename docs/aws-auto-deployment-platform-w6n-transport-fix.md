# W6n：页面传输兼容修复与旧计划停止使用

2026-10-20，America/Winnipeg。用户明确同意保留旧清单、不再执行，解除 main 冻结，仅进行两处传输兼容修复、回归测试及文档/代码发布。不新增权限、不重开入口、不部署。

## 原事件及核验事实

W6m 已发布 Review 计划 `dd73b7177f08b9105ee39b5960975c6ae6a0e2c69bc42f6bfcf652e7d3827487`，绑定源码 `15f142b64cfc81ee65592fb11163bc6a6ddfc49d` 及 held job `job_fc0309dabebc09367f64153f`。原计划截止 2026-10-21T01:48:33.419Z（10月20日20:48:33.419 CDT）；不改截止、不重新发布或重放。

W6n 窗口按 `14fac00e6fe50ce365abd817df77a1db9710672a1c9d57476c18aa6b049d973b` 单次开启。用户确认错误出现在进入实例页、尚未点击调度时：`CONTROL_LEDGER_REQUIRES_READBACK`。原进程已停止；00:13:23.972Z 独立核对原 PID 退出、3100 关闭，Start/Inspect 槽均已消费。00:14:19.885Z 的独立 GitHub 查询未见该源码/工作流的 dispatch run；这是当时可见结果，不是完整提供者审计或全局并发排除。

另获一次固定版本 Secret 读取和两个 SELECT 的诊断许可。00:37:43.308Z–00:37:46.171Z，独立 Node 读取 `load_plan(准确SHA)` / `status()` 均成功：计划绑定匹配、`attempt=null`、唯一准确计划为 `AWAITING_APPROVAL`。这只证明该次观察的准确账本状态，不代表页面运行时正常或整个部署成功。没有读取 App 私钥或认证文件、重开入口、真实 token/dispatch 或数据库/云写。

随后使用无凭据、无监听 socket、无网络服务的 workerd `test` 复现：相同固定版本的 workerd 2026-05-15 不接受 `redirect: 'error'`；Node v22.19.0 接受。实际 Neon 1.1.0 + 原账本代码产生同样的通用账本错误，底层为 `Invalid redirect value` TypeError。原页面底层日志未保存，因此不宣称这是原现场唯一原因。

公开本机证据（原件保留，不收入 Git）：

- `F:/ChatGPT_workshop/techlong-w6n-review-window-20261020-a/stopped.json` 与 `clarification.json`：先前停止记录及用户后续澄清。
- `F:/ChatGPT_workshop/techlong-w6n-ledger-readback-20261020-a/result.json`，raw SHA256 `50fdcca17cadb847db8e0075fce4159c708b1af58add73c64d56d58f37b229b3`。
- `F:/ChatGPT_workshop/techlong-w6n-runtime-difference-20261020.json`，raw SHA256 `dba54b27bb29b14e8d1f6c4c5f094fc7db90f2d18fc79b32c8dc4914748d0198`。

## 旧计划处置（仅文档，不执行数据库撤销）

旧 dd73b717… 计划及其旧启动清单自本次同意起**停止使用**。保留数据库原行、固定对象版本、receipt、Start/Inspect/诊断尝试记录和永久槽；不删除、不改状态、不延期、不复位、不借用旧权限或重新读取私密材料。这里不是新增数据库取消 API，也不声称已服务器端撤销；原准确源码/截止/入口门禁仍保留。代码前进后，旧 sourceCommit 不能批准新源码。

## 最小修复

- `controller-v6/ledger.ts`：请求改为 `redirect: 'manual'`，不自动跟随 Location；保留 Neon 非 2xx 拒绝、固定目标/TLS、专用凭据、全局传输 guard、超时及统一脱敏错误。
- `controller-v6/github.ts`：共用请求改为 `manual`，保留原 GET/POST/DELETE 准确状态码检查，所有 3xx 均失败；不把 JWT、token 或请求正文转发到 Location。原 intent/ACK/UNKNOWN、单次提交及 finally 一次撤权语义不变。
- 旧认证审计适配器同步要求 `manual`（仅同一选项守卫；其准确端点、顺序、次数和只读 token 限制不变）。原已用认证批准 JSON **不重写**；回归测试明确验证旧 SHA 对改变后的源码必须 `CONTROL_AUTH_DRIFT`，不伪造一次新批准或重跑认证。
- 不改 UI 吞掉未知账本错误，不放开批准/观察按钮；不改 SQL、IAM、Secret、工作流部署权限、绑定、依赖、81/76 云闭包或承载资源。

## 验证与后续唯一方向

提交前本机：124 项相关回归通过、TypeScript 零错误、定向 ESLint 零警告。新增 Node 用例覆盖五类 GitHub 阶段及九种 3xx；原 ACK 和一次撤销行为保持。新增实际 workerd 回归包含 6 个账本场景、21 个 GitHub 场景，成功路径及301/302/303/307/308均验证。使用内存一次性测试 RSA 和虚构响应，不加载原密钥/凭据；没有真实令牌、GitHub 调度或生产 SQL。测试仅在独立临时目录替换准确虚构 URL 校验接缝，原生产传输 guard 保留；模拟的 internet Worker 明确替换默认网络出口，配置无 sockets。

两项现有 No AWS CI 已接入该测试，发布后以本次提交关联的 Checks 为准；不把提交前本机结果当作云 CI 已完成。真实 PG、构建及 Linux 工具链由现有 CI 验证，本机不为构建额外读取 `.env.local`。本次没有真实页面验收。

下一步只在准确发布源码 CI 通过后，准备新的受审计划/运行窗口范围。不得复用 dd73b717…、已消费槽或旧 Secret/PEM/认证文件读取批准；新私密读取、计划写入、Review 调度与环境批准仍单独明确。50 USD/月为目标不是硬 cap，已有资源费用可能继续。仍不扩 F3c9、Sites 或本地 Docker 支线，整套平台 AWS 上线放在自动部署验收之后。
