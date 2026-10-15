# D002 C5b：Express 首轮交付接线

2026-10-14 America/Winnipeg。接续 [C5a](./aws-auto-deployment-aurora-dual-mode-c5a-readiness-wiring.md)，只补主线必需接线，不扩展 F3c9、Grant、恢复或 SQL 诊断。预算目标 50 USD/月，不是硬费用上限。不安装本地 Docker，候选镜像仍由 GitHub Actions 构建。

当前状态：编码、本地验证及准确服务端源码 `8753546772476b018d33b96ab66db4837abde186` 的 CI/双候选镜像验证均完成。[机器可读证据](../ops/aws-sandbox/reviews/aurora-dual-mode-c5b-cloud-validation.json)。本轮没有 AWS 账号 API、真实 Secret 值读取、Aurora/Neon SQL、初始化、ECR 发布或 ECS/Cell 部署。测试中的 SDK/SQL/HTTP响应为 stub，不能成为真实运行证据。部分既有服务端测试会由 dotenv 读取本地开发配置，但不输出值、不连接其数据库；不能把这一点写成所有私密本地文件读取为零。

## 已补齐的三个接口

1. **受认证 bootstrap 与最终 readiness。** 真实 `app.js` 将原 readiness 对象放入 app.locals，`saas_control.js` 在既有 mTLS/JWT middleware 后挂 `/api/saas/bootstrap`、`/api/saas/readiness`。新模块仅允许严格 Express、准确 instance claim 与 control scope；分别调用 C5a bootstrap / initialized 检查。返回 mode/profile/instance、binding SHA、DB/role OID、desired hash、immutable image，无 Secret/SQL/provider错误；no-store。bootstrap 明确 `initialization_verified=false`、`external_epoch_claimed=false`，不把请求 header 回显为数据库已提交 epoch，也不依赖业务表的未初始化 external_instance_id。
2. **独立 Express workload render。** 新入口复用旧七资源隔离转换及 ownership/Secret/epoch/hostname/account/region/preflight 校验。绑定稳定身份、准确数据库/角色与 generation；注入 v2 binding、C5a 五字段和四键固定 Secret version，加原 control public key。ECS HealthCheck 和 ALB target 均明确 `/bootstrap-ready`；task role 参数只允许绑定中的 applicationRoleArn。单 FARGATE task、没有旧 TTL schedule/新 IAM/数据库资源；不生成旧 worker 的可信 render brand 或 ApplyReady。旧 Full 入口仍固定原 image、五键、`/ready`，不扩大其镜像准入。
3. **四键首位密码来源。** 新独立 v2 source 实现原 FirstOwnerPasswordSource 接口，适配既有 compiler，不放宽五键 Full source。构造只做本地校验；未来调用 lease 才进行只读 fence/STS/Secret 访问。只接受准确 Source 用户 ARN/受审 UserId、当前 scope/generation/DB、v2 exact ARN/name、五个准确 tag、唯一固定 AWSCURRENT version、默认 AWS-managed KMS/无轮换复制，以及四键 JSON（拒绝 database_url/token/第五键）。先后两次独立 metadata 与 fence 读取检测变化；HMAC 的 256-bit 输入通过原 HKDF 域分离协议生成稳定 43 字符密码，lease dispose/失败清零 Buffer，provider错误脱敏，无额外 Secret/文件/旋转/写入。

### 控制面顺序与最终条件

新 `MtlsSaaSControlClient` 仅在显式 `expressReadiness` policy 时使用新路径，旧 Full 参数与行为保持；构造复制并校验无密钥期望，不发 token/请求。

```
ECS/ALB bootstrap health
  → private :8443 + mTLS/JWT /api/saas/bootstrap（运行时身份，不是 persisted epoch）
  → 原 immutable compiler + /api/saas/provision（原 idempotency / epoch CAS）
  → private /api/saas/readiness（完整 initialized check）
  → 原 /api/saas/control（持久 epoch + active instance + image + desired hash）
    + 逐项比对实际八 entitlement / 唯一默认店铺名 / 双主题
    + 按原 effective snapshot 协议重新计算实际 configuration_hash
  → 既有 worker 最终 reconciliation / markReady 条件
```

desired hash 是平台 template 配置的 hash，**不是**服务端 effective snapshot hash；两者不能直接比较相等。本实现既比较受审 desired hash，也核对 authenticated readback 的实际值和其独立重算 SHA。店铺 UUID 由真实读回供快照计算，不把请求/metadata 自称的 desired hash 当作已应用配置。provision 发出前还检查 payload 与受审 business expectation 的 entitlements/店铺/主题/owner username、metadata image/hash；receipt 的 owner 必须是准确用户名、active owner。失败同样沿用 finally 清除明文密码。

business expectation 必须来自当前不可变模板的完整编译结果：八项 entitlement、完整规范化双主题（六位大写色值）、店铺名和 owner username，不能采用租户响应自选的期望值。接口只接受这几个无密钥字段；不保存 password/hash/key。新 renderer 接受某个合法 ECR digest 仅用于构造候选，**不是**宣布任意 digest 已批准或已发布。

## 兼容与尚未证明的事实

- 旧 Full workload/queue 的固定旧镜像准入、五键 first-owner source、原 worker、原 prepared/live root 不改。新 Express render 不被旧 finalized-stack/ApplyReady 入口接受，不伪装已安装 Scheduler，也不依赖 ALB unhealthy fail-open。
- **当前尚未把新 Express render/四键来源装进真实执行 composition root。** 旧 live root 仍不能部署这个 Express candidate。下一步必须在同一首轮交付入口绑定当前镜像、v2 binding、当前 deployment/epoch、fresh cleanup/权限事实、真实配置与受审具体操作范围；不能仅翻 enabled flag 或调用旧 Full root。此处是已实现的适配接口，不是完成自动部署的宣称。
- 新 source 的 lease 会读取真实 Secret，现有 IAM 是否允许准确版本尚待具体授权后的事实核验；不在本轮获取或增加权限。允许 Source 读四键只是候选能力，不是本轮执行授权。JavaScript 字符串/SDK内部副本不能保证法证级内存擦除。
- 两次 metadata/fence 读取不等于跨服务 CAS，返回后仍可能并发变化。bootstrap/readiness/control 是不同事务/请求，不是全局原子快照，暂时缓存或并发变化可能拒绝本应最终收敛的部署；不能据此自动放宽/绕过。
- receipt 的 active owner/username 与严格 ready 的 owner 存在，不证明该密码能够登录（同名既存 owner 尤其不能据此推断密码相同）。后续真实商户认证验收另计；不读取 password hash 充当登录成功。
- actual ECS task role/Secret version 注入/网络、KMS/SCP、真实 SQL ready/业务初始化及公开 HTTPS 均未验证；GitHub 自检通过也不替代这些事实。Secret/API/健康检查/ALB/Fargate 等运行有非零费用，预算不是 cap；自动清理尚未安装，仍需受审监督清理。

## 验证与唯一继续位置

平台 9 新测试（控制4、四键来源3、workload2）加 24 相邻共33项通过，另有3项 supervised worker/finalized SDK 集成回归通过（合计36），涵盖启动前 handshake、每项 pin/flag、实际配置 drift、epoch/image、owner receipt、错误 payload 密码清除、版本/fence race、Full保留/旧 brand拒绝。服务端3新加62相邻共65项、双方 typecheck、完整 build、服务端 syntax、平台定向 lint 及本机两种 final-image-check 入口通过。

准确源码 `8753546` 的 [CI 38680847326](https://github.com/veinyyxy/SpeedFeast_Backend_main/actions/runs/38680847326) check116244816674/docker116244816360 所有 steps success；[双候选镜像 38680847373](https://github.com/veinyyxy/SpeedFeast_Backend_main/actions/runs/38680847373) app116244816773/lifecycle116244816521 所有 steps success，UTC2026-10-15 04:20:21完成（Winnipeg10月14日23:20:21 CDT）。包含新增 readiness 模块加载/真实 app wiring、自原有 dual/V4/V5/V6 到实际容器及归档工具链检查、production dependency 和 OS HIGH/CRITICAL门禁。没有 OIDC/AWS 凭据或发布步骤。

checked app artifact11947876415（72,647,672 bytes，ZIP SHA `4a487b44ee657b2add524892d0f8dc64947d1ab96ba634256f7c8ec645418c08`）、lifecycle11947134411（85,235,583 bytes，ZIP SHA `987efb24a3f649a96b83a4cf798a5730ad97d82c1f5fe0f22c88a180bec12664`），分别UTC2026-10-16 04:20:12/15到期（Winnipeg10月15日23:20:12/15 CDT）。只核对元数据、不下载大镜像；artifact ZIP digest 不等于 Docker config 或 ECR manifest，registryManifestDigest 仍 null。过期后按受审准确源码重建/重新核验，不能借用旧 C5a 或其它镜像证据。审计 capsule 保存双方各9个明确源文件的 LF-normalized SHA 及所有云门禁状态，不包含私密文件或任何执行批准。

下一 C5c 合并准备**一次当前租户受审发布→部署→初始化验收**的完整执行根和材料，复用本阶段组件，不再增加并行诊断支线。先核对准确候选源码/CI与待发布 image，再绑定 current scope、私密 source 及权限/监督清理范围。真实 Secret 值读取、业务初始化/Neon deployment/job 写入、任何 IAM 变化、ECR 发布、Cell/ECS/ALB 创建更新仍按资源与具体变更 fresh SHA 单独确认。历史 C4h 及所有已消费槽不可重放；代码 push 授权不等于这些操作的授权。
