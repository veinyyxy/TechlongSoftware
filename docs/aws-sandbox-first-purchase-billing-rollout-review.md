# Sandbox 账单页修复：数据库只读函数与平台上线合并审批

**待审，未推送、未调度、未上线。** [机器清单](evidence/sandbox-first-purchase-billing-rollout.review.json)合并候选构建、限权发布、数据库只读函数安装及原平台换镜像。当前固定了源码树和 SQL，尚无候选镜像封签或不可变发布入口。它们必须按下文绑定并验证后才可开线上窗口；否则不得调用云端写操作。

## 哪些内容发生变化

revision 16 已完成原订单 Checkout 关联，但登录后账单页仍调用通用订单列表。Sandbox Web 角色无订单表 SELECT；在隔离库使用原 schema、角色与实际查询复现 `42501`。源码 `c58e5b1` 只在 Sandbox 的登录后账单页读取单笔订单，普通账单路径、创建会话、回调和首开均不改。

账单页在任何通用订单或对账查询前进入 Sandbox 分支。只使用登录会话里的工作区和用户 ID；非 Owner 或平台管理员不查询。数据库仍依赖既有 `read_order` 校验已绑定的范围、订单、当前 Owner 和原创建者。只在订单和匹配付款都待付款、已存的测试 Session 和链接匹配且未到期时显示现有链接。页面没有创建、取消或重新购买按钮。旧 `read_order`、付款结果 API、其余四函数和原角色不变。

本地隔离 PostgreSQL 18.3 + 登录身份 fixture 已实际渲染新页面：原 Owner 看见且只看见原链接；匿名前置拒绝、非 Owner/跨工作区/错误订单拒绝，过期、已付款、不同会话或坏链接均无按钮；Web 整表 SELECT 仍报 `42501`，webhook role 无新函数 EXECUTE。五函数 ACL／定义和业务行在页面读取前后未改。另有 21 项通过、2 项外置库测试在本机跳过，TypeScript、定向 lint 通过；这不是线上登录验证。

## 同一份批准的顺序与停止点

1. **先绑定一个准确候选。** 以 revision 16 的已验证 19 文件 overlay 为基底，只覆盖账单路由和 Sandbox runtime 两个固定 blob；离线已验证新树 `8ff7f4974fe1212b101aba308809cd226cf7a373`。复用现有专用无 AWS 构建、扫描和封签门禁，仅允许为该固定 recipe 做最小的候选／受保护发布接线。准备并验证准确 workflow refs 和本次无 AWS CI；对新 recipe 单次 dispatch，绑定由它产生的唯一原 attempt 1 产物 ID、镜像与 ZIP 的 SHA／大小、扫描和过期时间。现有旧 artifact、旧批准和通用门禁不可重用或放宽。缺项即停止，不开线上窗口；GitHub environment 仍由用户本人批准。
2. **写入前核对原环境与原单。** 只复核原不可变 ECR 仓库与精确目标 tag 空位、原发布器严格 Revoke 模板、GitHub 的原门禁、原 Hosting/Access 栈与 revision 16 的镜像和绑定。Neon 只读核对原工作区／订单／会话、原五函数及角色、新函数尚未存在；记录去敏布尔结果，不保存链接或配置。只需原 Stripe 测试运行键读取同一个测试 Session 一次，要求开放未付、未到期、同订单同金额，且有足够时间；无任何 Stripe 写入。若不匹配或过期，不开始部署，不改业务状态。
3. **复用一次受保护 ECR 发布。** 原 publisher 栈仅一次临时 Grant、本人审批精确 run、单次 ECR push。成败或不明均按已审入口立即尝试唯一一次 Revoke；独立确认 Locked、历史镜像保留、真实 manifest/config digest 与候选一致，才继续。不得更改 OIDC 或既有环境审批。
4. **先装数据库只读函数，再更新平台。** 在原 Neon PostgreSQL 一次事务中，仅用经审的临时 SET 切换既有 definer，执行固定的 `CREATE FUNCTION sandbox_first_purchase.read_billing_order(text,text)`、`REVOKE PUBLIC` 和仅 Web 角色的 `EXECUTE`，恢复成员关系后提交。不新建角色，不改已有五函数、表 ACL、表结构或任何业务行。独立只读回查签名、owner、ACL、函数定义、旧 routine 和 Web 无整表 SELECT 均匹配后，才在同一原 Hosting 栈创建并严格核对一个镜像变更集，执行一次；只改 Web image、镜像证明元数据与 Service 任务引用。Access、网络、域名、固定 Secret、worker 和控制器保持原状。
5. **只验技术，不代购。** 核验新 ECS 任务确实使用新 digest 并健康、原固定布局未变；技术 GET 限 `/api/health` 与 `/register`。最后由原 Owner 打开账单页确认按钮，不要求点付款，不走其他业务写入口；未看到登录后页面时不能宣称页面已经线上验收。没有新会话、重复下单、续费、取消、付款或首开放行。

## 边界、窗口及风险

原 Stripe 会话记录的到期时间为温尼伯 **11 月 19 日 19:16:57**；历史记录不是新的有效性证明。不延长原边界：全部候选材料齐备后的线上窗口最长 95 分钟，最晚 **17:21:57** 启动、常规硬截止 **18:56:57**。预留构建与封签时间后，来不及则不开始。仅必要的单次 Revoke 及其核验可越过常规截止。初次写前必做新鲜核对；创建结果或 DDL 提交结果不明均停止，不重放、不主动回滚或清理。

实际预算见机器清单：候选构建和受保护发布各一次，Source STS 8／AWS 元数据 260（含有界等待），GitHub GET 合计 160／认证 helper 1；原测试键文件一次／准确 Stripe GET 一次，`.env.local` 一次、验证 TLS 的 Neon 连接三条、SQL 最多 60；一次数据库 DDL 事务、一次 ECR push、一次 Hosting Change Set Create 和 Execute、无 AWS Secret 值读取或业务写。配置只进内存、不保存密钥、业务正文或 URL。原授权组合中的网络、日志、宽权限安装者、短锁、跨服务非原子、滚动中断和费用风险不变；如果数据库已安装而部署失败，只读函数可能保留，不能宣称整轮成功。旧 Checkout 流程不受它影响。
