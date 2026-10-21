# W7c：两小时受控平台验收准备与 HTTPS 边界

2026-10-21。用户已选择“先准备2小时受控验收方案，部署及后续清理分别审核”。这只批准准备方向，不是创建、删除、发布镜像、读取私密值或变更权限的许可。`executionReady=false`；本阶段没有可批准 AWS 写入的新清单 SHA。

## 本轮范围与结果

在现有 `ops/platform-hosting-v1/` Node 候选内补齐固定 Origin 的入口；没有修改业务认证、数据库、原 Workers/Sites 构建、package/lock、旧部署工作流或81项云端执行闭包。原闭包 SHA 仍为 `828491ecbb72054fd3098ebba837331bb587e5e4620bcbf9096bf25b4df63b2a`。部署/controller/worker/支付绑定继续固定关闭，不能用本候选恢复旧租户或运行旧 job。

新 `ingress.mjs` 校验入口，`start.mjs` 接入，`https-smoke.mjs` 验证实际编译出的应用。未开启模式时最终只监听 `127.0.0.1`，不向容器网络开放管理页面。未来 HTTPS 模式需同时设置以下**非敏感**运行时配置，不能只设置泛化的代理信任开关：

```text
TECHLONG_PLATFORM_INGRESS=alb-https-v1
TECHLONG_PLATFORM_PUBLIC_ORIGIN=https://console.sandbox.techlong.cloud
```

只允许这一对准确值，拒绝其他域名、路径、协议或不完整配置，以及与 `--loopback` 混用。调用者设置 `VINEXT_TRUST_PROXY` / `VINEXT_TRUSTED_HOSTS` 仍被拒绝；通过校验后启动程序才从固定域名派生 vinext 所需的单主机信任。构建子进程不会继承这些运行时配置或任何真实数据库/云凭据。

安装的 vinext API 会立即监听，因此先在容器 loopback 的随机端口加载应用，关闭后替换**唯一** request handler，最后才打开服务端口。不是 `prependListener`：拒绝后不会继续执行原业务 handler。当前锁定 vinext 的真实 URL 转换有独立测试；其版本/监听器结构变化必须重新验证，不自动兼容多个监听器或升级协议。

## 入口契约

| 请求 | 处理 |
| --- | --- |
| 正常 ALB 页面/资源 | Host 仅 `console.sandbox.techlong.cloud` 或其 `:443`；必须单值 X-Forwarded-Proto=https、X-Forwarded-Port=443 |
| X-Forwarded-Host | 可缺省；若存在只能是上述准确主机，不用它来选择任意外部 Origin |
| 重复/混合字段 | 从原始 rawHeaders 检查 Host、Origin、转发 host/proto/port 和 Sec-Fetch-Site；重复或逗号混合值拒绝，不依赖 Node 合并后的第一项 |
| RFC Forwarded | HTTPS模式拒绝；其他 X-Forwarded-* / X-Real-IP 清除，再生成固定的 host/proto/port；不将来源 IP 头作为身份依据 |
| 写请求 | POST/PUT/PATCH/DELETE 必须精确 Origin；缺失、null、兄弟域名、跨域拒绝；Sec-Fetch-Site 如存在仅 same-origin/none |
| GET/HEAD/OPTIONS | 有 Origin 时也必须精确匹配；不新增 CORS 放行。TRACE/其他方法拒绝，绝对 URL、反斜线、双斜线 authority 等非正常路径拒绝 |
| ALB/容器 liveness | 仅无转发/Origin/Cookie/Authorization/action上下文的准确 GET/HEAD `/api/health` 可使用 target-IP Host；清除全部调用者头后转入原健康路由。无查询参数、写请求或业务页面豁免 |
| Cookie / 重定向 | 应用看到固定 HTTPS URL；沿用原 HttpOnly、SameSite=Lax、Path=/、无 Domain 的 Secure Cookie。短 HSTS max-age=300，不 includeSubDomains/preload；无动态信任外部重定向主机 |

**这些头不是代理身份认证。** 安装时必须独立验证 task:3000 只接受本栈 ALB 安全组，不能向公网/VPC任意来源开放。否则能直达任务的攻击者也能构造这些头。本地/CI模拟不能证明 AWS 网络或 TLS 正确。

未来 ALB 提案还必须固定：443 使用已核对的 sandbox 证书、准确主机规则，其他主机默认拒绝；80 只在 ALB 重定向至固定 HTTPS 域名、不转入应用；保留 Host、拒绝非法字段和严格 desync 处理。ALB 将客户端协议写入 X-Forwarded-Proto，但不因此信任其他客户端可控转发头。[AWS 转发头说明](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/x-forwarded-headers.html)、[Host 保留属性](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/edit-load-balancer-attributes.html)。这些是未来基础设施审查条件，本轮没有安装 ALB 或安全组。

所有写接口统一要求 Origin，包括目前关闭的 webhook；本候选不支持公开 Stripe webhook 或托管部署控制器。将来开启属于独立范围，不能临时添加无 Origin 写入豁免来绕过门禁。

## 两小时方案（未执行，非自动停费）

资源候选引用 [W7b 只读盘点](aws-platform-hosting-w7b-inventory-and-cost.md)，不是未来执行时的事实保证：ca-central-1 默认 VPC 的 a/b 公共子网、既有 sandbox wildcard 证书和委派区；**不复用旧 Cell 的 VPC/ALB/集群，不恢复已删除租户**。

1. **镜像/权限准备，另审后执行。** 新独立 `techlong-sandbox-platform-web` ECR 仓库、准确源码和 digest、窄发布身份。不得解锁旧 Publisher grant。发布费用及保留物独立列出。
2. **业务数据库接线，另审后执行。** 先核对最小权限的平台 web 数据库身份，才准备 `techlong/sandbox/platform-web/neon-v1` Secret 和准确版本引用。不复用 controller 窄凭据，不给 web owner 权限，不把凭据写入镜像或浏览器。若必须新增数据库角色/授权，其变更另审。
3. **部署材料。** 固定独立 `techlong-sandbox-platform-hosting-v1` 栈、cluster/service/task definition、日志、ALB/listener/host rule/target group、两安全组、准确 console DNS；单个 x86 Fargate 0.5vCPU/1GB，task 不配置业务 AWS task role，execution role 只负责所需镜像/日志/固定 Secret。最终完整逻辑资源表、IAM差异、镜像 digest、Secret版本和清理保留项齐全后才生成 fresh SHA；不提前发空白批准。
4. **时限与验收。** 待审清单应同时列出绝对 UTC 和温尼伯时间。两小时从该次已批准部署的首个资源创建调用提交时开始，启动/等待也占时间；页面可用时间不会自动补足两小时。过期不再新建/扩容/自动延长。准备时给审批充足时间，但不能靠延长审批顺带延长原运行窗口。验收包括准确资源数/镜像、真实 DNS/TLS/网络边界、本人现有管理员登录、只读管理页、跨域拒绝、服务稳定；不点击创建业务请求、部署、支付或恢复旧 job。
5. **清理材料与批准分离。** 部署前准备清理模板和资源归属规则；创建后只读绑定准确 StackId/资源 ARN，用户再批准实际删除。届时明确 DNS、ALB、service/task、日志等处理，以及 ECR/镜像、IAM、Secret、日志哪些保留；不得将 retained 资源称为已经清理。无该批准不执行删除；删除失败/状态不明不自动重试或扩大范围。已有 VPC/子网/IGW/证书/公共区、数据库和旧项目资源永不列入本次栈清理范围。

两小时是操作计划，**不是硬计费上限或自动销毁机制**。本阶段不增加 Janitor/定时权限支线。若无人及时批准或清理失败，资源继续收费；部署批准不等于删除批准。未来部署评审需明确此风险及人工清理衔接，不能等到截止时才第一次准备清理范围。

按 W7b 的区域价格快照，两小时小时型核心示例约 **0.13555 USD**，不含部署/清理耗时、现有资源、ECR/日志/流量/请求/税费，单 Secret 若保留整月另约0.40USD。不是完整报价或费用承诺，执行前再核对。原全项目50USD/月仍是目标，不是 AWS 硬上限；没有批准约49.88USD/月的平台常驻方案。

## 验证与可追溯边界

本地33项 hosting测试通过（包括临时 loopback 真实 HTTP 重复头拒绝和安装版 vinext URL转换）、TypeScript和 scoped lint通过。受限沙箱首次 loopback 客户端 EACCES，获准同一合成测试后33项全部通过，未改为跳过。原 app health/auth/session 源码保持不变。

No-AWS CI 使用同一真实镜像运行两个独立 non-root/read-only/network-none 容器：默认本机匿名 GET；固定 HTTPS 模式的 ALB 头模拟。后者检查真实登录页/浏览器资源/管理页跳转，恶意 Host/Origin 拒绝，空登录参数在数据库前失败，以及**无 Cookie 的真实 logout 路由**生成 Secure 清除 Cookie（不删除数据库 session）。不以合成令牌冒充真实管理员，不提交密码或调用真实登录数据库。TLS、真实账号登录和 AWS 部署仍未验收。

**最终镜像验证通过：** [No-AWS CI 39653327466](https://github.com/veinyyxy/TechlongSoftware/actions/runs/39653327466)，准确源码 `b563d5e8e154cee845e03a3ac02723f15f96efe2`、push/attempt1、workflow391864582、repository1323312747。独立回读 run 与 job119407047708 均 completed/success，13项报告步骤全部成功。日志在2026-10-21T18:31:58.8197749Z记录匿名 smoke 通过，18:32:02.4004463Z记录 HTTPS 边界 smoke 通过，各核对18项页面浏览器资源；Host/CSRF拒绝与Secure清除Cookie=true，realDatabaseConfigured/realAuthenticationProved/realTlsProved=false、cloudWrites=0。CI本地镜像ID `sha256:4dbc8a9ac42a45055a84841faa0b7f2e4789328165e91def4830c511ab9c7f44` 不是已发布ECR manifest digest，不用于冒充未来部署镜像。未重跑任何旧 workflow；本段后续仅文档更新，不改变已验收代码锚点。

工程内入口和工作流可复用；外部历史脚本/证据/永久槽保持不动。本轮没有 AWS、Neon、Stripe、私密包/Secret/PEM 读取或云端写入；仅代码/文档提交推送及无 AWS 身份的候选 CI。下一步是准确的独立 ECR/窄发布权限和数据库身份准备，不是直接部署。
