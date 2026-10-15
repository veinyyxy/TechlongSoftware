# C5c：首次认领接线及默认店铺初始化候选

2026-10-15 America/Winnipeg。继续同一条[Express 单租户交付主线](./aws-auto-deployment-aurora-dual-mode-c5c-delivery-root.md)，不是新支线。本阶段完成：真实控制面只读核对、新部署身份/准确队列范围、绑定新 owner 候选的准备入口，以及默认店铺 seed 候选。**尚未认领 owner、激活 epoch、插入店铺、创建 job 或部署资源；当前没有可执行的审批清单。**

## 实际状态与 owner 含义

UTC2026-10-15 08:59:52.701–08:59:54.698，独立只读入口确认准确 Source account/ARN/UserId，通过两次强一致 GetItem 读准确 key，并通过 Neon HTTPS 一条只读 SELECT 在同一数据库快照内核对目标记录：

- `tenant:a0da1748…`、`tenant:aurora-v2:a0da1748…` 均不存在。
- 当前目标 app 的 deployment/job 为0；按 app、stable identity、DB/role/Secret 碰撞坐标检查的 resource/operation 为0。
- 原 app/template/configuration、active 订阅与 workspace、50 USD 环境策略均匹配；apply仍0，admission仍open/epoch0/无Stack。

这是**控制面首次认领候选**，不是 Aurora 的当前目录、业务空库、SQL登录或 ownership/epoch 证明。两次 DDB 强一致读与 Neon 快照也不是跨服务 CAS，实际写入前必须重读并使用条件写/事务，任何既有记录均不得自动接管或覆盖。

代码核对纠正了上阶段尚未证实的假设：C3 bootstrap comment 的 `express-bootstrap-owner/v3` 绑定 stable identity/generation/target hash/nonce，**没有 deployment ID**；物理库仍由postgres持有。旧 D001 `dep_9f0a6951c7e2d244de4fec29` 只是旧镜像/旧plan推导的 futureScope，不是已经安装的租户 deployment owner，也不是可直接重用的 ownership 证据。

新镜像及显式修订 plan 使用与 `management.ts` 完全相同的 idempotency/stableId 公式，实际候选为：

- deployment：`dep_7c99bd249470184852f0dc74`。
- idempotency：`d698b243122c648349145523ff6339b68b9f9bf6fd4f9d5ac56c1475efdde9de`。
- plan SHA：`8690c22f5b4dbf80d49bcee3cdff717dd8ae14957eedb7606b9829b533e49dc8`；配置及两份已发布镜像保持。

这是准备**首次登记复用现有物理库**，不改变postgres数据库 owner、不重新恢复/迁移、不隐式转移已存在的 generation。旧 futureScope、原件和全部已消费槽保留。

## 已实现的接线

`express-deployment-scope-v1.ts` 提供独立、clone/freeze、进程内登记的六字段准确范围。Neon repository仅为这个显式新范围增加入口；原 Full validator、原CLI固定镜像及原无scope入口保持。Express 原始 JSON/局部/undefined/null 范围不能退化为全局队列。三个 claim/maintenance CTE 的原参数化范围谓词、租约、loadContext 检查完整复用，未调用 claimNext 或其他写方法。

`createPreparedExpressFirstDeploymentRuntimeV1` 用新 ID 同时绑定独立 Express delivery/control/password owner 和真实 scoped repository。构造只验证、创建lazy客户端，不连接数据库或启动 worker，不调用旧 Full prepared-v2 生命周期，不伪造其 receipt。当前只是准备入口；实际首次认领、外部 epoch、业务初始化、CloudFormation apply 和 ready 原子回写仍未接通为完整 live root。

## 默认店铺 seed 候选

现有已发布 app 的 provision 不会建店。候选复用该镜像，先计划一条**参数绑定 INSERT stores**，再通过原 mTLS provision 更新名称/主题/entitlements/首位管理员；没有修改/重建服务端镜像。

- 固定 UUIDv8：`add89a8c-f43e-81b9-8287-0cb6c5c54f87`，由稳定身份/generation/domain确定；不是UUIDv5。
- code `TECHLONG_SANDBOX`、slug `first-acceptance`、Winnipeg/CAD、active/default；名称和主题仍由受认证provision写。
- 不使用ON CONFLICT/upsert，不更新旧店，不写owner/权限/Secret/authority/Neon；seed不等于ready。
- 计划要求新受审的单次TLS/IAM会话、准确 DB/role OID/原comment、完整C4h active目录/ACL及技术9seed/空业务核对，排除未知stores列/trigger/rule副作用；SERIALIZABLE事务与准确表锁，写后逐项核对和独立只读回读。冲突、响应丢失、COMMIT不确定均不自动重试、删除、补偿或复位槽。

`express-default-store-seed-v1.ts` 是**纯候选编译器**，`executionRootAvailable=false`。`5e433c2b…` 是候选program hash，不是批准SHA；本轮不请求执行它。实际Source/TLS/IAM会话执行器、fresh具体风险/时限/代码绑定和永久槽必须补齐后，才能请求一次初始化批准；不另申请SQL诊断或重放C4工具。

## 证据与复现

完整的观察摘要与候选在 `F:/ChatGPT_workshop/techlong-express-control-plane-c5c-20261015-r1.observed.json` 和 `F:/ChatGPT_workshop/techlong-express-default-store-c5c-20261015-r1.prepared.json`；[本阶段capsule](../ops/aws-sandbox/reviews/aurora-dual-mode-c5c-first-claim.prepared.json)记录hash/状态。观察文件是CLI结构化结果转录，省略AWS SDK传输metadata，不伪称保存了原stdout字节；实际读取后收紧了source字段输出投影，并增加纯本地scope/seed校验，资源读取操作未变、未重跑；当前源码pins记录测试版本，不倒填为原运行字节证明。

```powershell
# 有网络的只读核对：现有Source、两准确DDB key、现有Neon。
node --experimental-strip-types --env-file-if-exists=.env.local ops/aws-sandbox/scripts/inspect-express-delivery-control-plane.ts `
  --review F:/ChatGPT_workshop/techlong-express-delivery-c5c-20261015-r1.review.json

# 无网络的候选编译：不加载.env、不连接SQL或消费槽。
node --experimental-strip-types ops/aws-sandbox/scripts/prepare-express-default-store-seed.ts `
  --review F:/ChatGPT_workshop/techlong-express-delivery-c5c-20261015-r1.review.json `
  --control-plane F:/ChatGPT_workshop/techlong-express-control-plane-c5c-20261015-r1.observed.json
```

本轮 AWS 资源读取共2次STS（含开始时CLI核对）和2次DDB GetItem；Neon一条只读SELECT，使用已有`.env.local`连接且只发往现有Neon HTTPS端点，不输出凭据。Aurora SQL连接、AWS Secret值/`private-material.json`读取、IAM/authority/Neon业务写、云部署及执行槽消费均0。底层凭据获取HTTP不算上述资源API次数。79项定向tests（新增10项）、types、lint及生产构建通过；fixture测试不是真实 ready。

## 唯一下一步

直接补齐**首次认领与初始化的实际受审执行器及一个清晰执行包**：fresh Aurora目录/空业务核对、准确控制面条件认领/epoch、默认店铺单次写及独立回读；不重新运行旧C4诊断/权限安装或镜像发布。当前候选不允许立即执行。

随后在相同主线准备旧失败Stack准确UUID退役、新16计算层/7workload/DNS、准确私密来源绑定与provision/reconcile/ready。上阶段计算模板的旧deadline不能续用；新付费资源创建、删除、权限、私密读取和业务写仍按具体范围与fresh SHA确认。50 USD/月只是目标、没有自动销毁；旧Full、旧记录、旧槽与F3c9保持。
