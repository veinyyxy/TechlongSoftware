# Sandbox 首开：Checkout 修正上线与原会话关联

**一份合并待批范围，尚不可直接执行。** [机器清单](evidence/sandbox-first-purchase-checkout-repair-rollout.review.json)是本轮唯一合并材料。专用无 AWS 候选已成功构建并核验封签。未查 Stripe／Neon／AWS、未发布镜像、未更新平台、未替换函数、未关联或创建 Checkout。

## 固定目标与当前缺项

- [原技术验收](evidence/sandbox-first-purchase-dahlia-activation-verified.json)证明平台曾运行 revision 15，原 Stripe 测试购买在 Workbench 返回 200，原会话初始为 `open/unpaid`。经已批准的一次只读核对，链接为 `https://checkout.stripe.com`，尾部匹配测试会话 ID，但不具备旧固定路径。**这些是历史事实，不证明原会话当前仍开放或未过期。**
- [机器版草案](evidence/sandbox-first-purchase-checkout-repair.prepared.json)固定源码 `5b89c18`、三文件 overlay 的 blob/SHA、预期源码树、原工作区/订单/Stripe Session 的 SHA 和原平台目标。沿用已上线 Dahlia 的 19 文件合成基底，仅三个运行时文件的字节发生变化；DDL 不进入应用镜像的三文件差异。[支付与 PostgreSQL 回归](https://github.com/veinyyxy/TechlongSoftware/actions/runs/44438551298)通过。
- [专用构建 44442817443](https://github.com/veinyyxy/TechlongSoftware/actions/runs/44442817443) 原 attempt 1 成功，唯一 artifact `14491468132`。核对了 GitHub 产物元数据与准确 job 封签：源码树、ZIP 与镜像压缩包的精确大小和 SHA、镜像 config digest、禁网与闭控 smoke、合成 Stripe 回调和 HIGH/CRITICAL OS 扫描。未下载 ZIP；镜像 config digest 不是 ECR manifest digest。旧的[通用托管门禁](https://github.com/veinyyxy/TechlongSoftware/actions/runs/44438551331)保持不变。
- **开工前的离线门槛：** 现有发布器不接受这个新 artifact，现有启用入口也会走完整安装，不能直接用于单函数替换。仅允许为这一个固定产物做精确的不可变发布接线，并为下文单事务准备和离线核验窄执行入口；复用现有工作流和 CloudFormation 校验，不新增通用入口、不改旧规则、不重建镜像。先固定接线提交、CI 及实际命令，再开执行窗；缺任何一项时，不读取线上数据、不调度受保护发布、不执行写入。机器清单的 SHA 绑定的是本合并范围，不是已生成的部署执行入口。

## 最终一次批准的拟执行顺序

1. **只接受封存的修正版候选。** 在无 AWS、Stripe 或真实数据库连接的既有隔离路径中验证预期源码树、一次构建、准确产物／哈希／大小、指定架构、离线回归与扫描。最终清单须绑定原 attempt 1、真实产物和哈希、不可变发布入口、准确目标 tag 及执行上限，不以源码 SHA 代替产物或 registry digest。缺证据不开始线上操作。
2. **在写入前核对原会话、订单及平台。** 只能读取已保存的 `sandbox-first-purchase-stripe-test.json` 一次（整份进内存，仅使用原 runtime 测试键），对准确原 Session GET 一次，要求同一 Sandbox、`livemode=false`、`mode=payment`、开放未付款、未有关联 PaymentIntent、未到期；订单 ID 同时匹配 Stripe 的 `client_reference_id` 和 metadata，金额／币种与原订单相同，返回链接通过新共享校验。只读确认同一工作区、原 Owner、原订单仍为 `draft`、原付款记录为 `pending` 且两者没有已有会话关联、没有为这笔订单登记首开任务；确认平台仍为原栈、原服务、原镜像、原固定 Secret 及关停 worker 布局。任一条件不符或时间不足，**所有写入均停止**，不创建替代会话。
3. **只发布一次，只更新平台镜像。** 复用原发布器栈及一次性临时授权；只推送新候选到原不可变 ECR 仓库，经用户本人批准同一次 `techlong-sandbox-deploy`。成功、失败或提交不明都按已审机制立即尝试一次撤权，独立证明 Locked 和 registry manifest 与准确候选匹配才继续。原 Hosting 栈仅允许一个 Change Set、一次核对后执行；只变更 Web 容器镜像、对应源码／镜像证据元数据与 Service 的 task definition 引用。保留原 Access 栈、权限、网络、域名、任务数、固定 Secret/版本和关闭的控制器／worker。独立核对新运行镜像、健康与原布局；未通过则不执行数据库步骤，不自动重试、补齐或跨系统回滚。
4. **只替换 `attach` 并关联原单、原会话。** 上一步通过后再对同一 Session 最多 GET 一次，重复校验有效期、未付状态、匹配关系及 URL，保留所需字段只在进程内。极短的单事务内先锁定重核原 `draft`、原 `pending` 及无关联状态，不写业务表直连补丁。只替换 `sandbox_first_purchase.attach(text,text,text,text,bigint)`：在同一事务内按原已审所有者方式临时启用仅供安装者切换到既有 definer 的 SET，执行固定 `CREATE OR REPLACE`，用同一函数**一次**关联原订单 / 原 Session，撤销临时 SET、恢复原成员记录后才提交。对比全套原函数定义和 ACL：仅 `attach` 正文的 URL 规则改变，OID、所有者、授予及函数搜索路径等属性不变；其余函数、角色、grants 与 schema 不重装。任何不匹配或 `attach` 未明确返回成功，本事务不得提交。提交结果不明停止，只接受另审后的只读回查，不重复调用。
5. **独立回读后再交给用户。** 确认单条原订单变为 `checkout_pending`、保存同一个 Session，原付款仍 `pending` 且 reference 对应同一 Session，无新增购买／会话／首开任务；只记录去敏布尔结果与证据摘要。不输出或直接使用完整 Stripe 链接，不代购。通过后由用户从平台继续原单，后续成功回调及首开登记仍独立验收。

## 本轮拟授权上限

- 既有 Source：最多 8 次 STS、260 次 AWS 元数据读取（含有界等待）；仅原 publisher、ECR 仓库及镜像、原 Access／Hosting、目标服务及任务、固定 Secret 版本元数据、现有 DNS、证书与健康，不读取 AWS Secret 正文。允许一次 Grant、一次 Revoke、一次原 Hosting Change Set 创建、一次严格核对后的执行；不更新 Access 栈。技术 HTTPS GET 最多 2 次，只访问原平台 `/api/health` 与 `/register`。
- GitHub：既有 Git 凭据只进内存，helper 最多 1 次、只读 API GET 最多 120 次（含准确工作流／门禁／候选／本次运行、日志和有界等待），受保护调度一次、顶层 ECR push 一次、只认原 attempt 1。工作流内仅下载本清单准确原 ZIP 一次，核对全部原封签，最多 3 次 GitHub API GET、1 次 OIDC 角色会话、3 次显式 ECR 元数据读取，镜像分层传输包含于单次顶层 push。用户只需亲自批准这一个发布 run 的 environment。
- Stripe 既有测试配置文件最多读取 1 次、准确原 Session 认证 GET 最多 2 次；不读签名文件、不查账户／回调端点、不发事件；不进行 Stripe 写入或付款。Neon `.env.local` 最多读取 1 次（整文件只进内存），验证 TLS 连接最多 3 条（前置只读、单写事务、独立只读），SQL 最多 60 次（含事务控制）。不查业务正文、不输出原 Session ID、链接、凭据或签名 URL。不连接 Aurora。

## 风险、时限及不可扩大范围

原 Stripe 响应记载原会话到期为**温尼伯 11 月 19 日 19:16:57**（`2026-11-20T01:16:57Z`）。这不是当前状态或可延长窗口。原样留出 20 分钟给用户，拟定最晚开窗 **11 月 19 日 17:21:57**、正常操作硬截止 **18:56:57**，最长 95 分钟；前置事实在开窗后最多 10 分钟内核完才允许首写，Grant 仍不超过 60 分钟且须为撤权留出余量。实际会话、扫描、产物期限或凭据更早时从严，来不及即停止；只有一次撤权及其独立回读可越过正常操作截止。产物到期不等于会话可用期限。

可能有 CI、ECR 或原承载费用、滚动短时中断、宽权限 Neon 安装者、短时行／函数锁、凭据或 Stripe 链接进内存及服务商日志风险。平台更新与数据库事务非原子；若会话在中间变化，可能已上线镜像，但不关联订单，不自动回滚或清理。批准只涉及一份候选、一次临时发布授权及撤权、原 Hosting 一次更新、Neon 一次单函数加单订单事务及独立回读。无新的 IAM 范围、新 Secret、Stripe 写、退款、付款、其他订单写入、任务领取、worker 启用或租户上线权限。不删除、不复位旧槽、不绕过门禁、不回滚或重试未确认的写入；CloudFormation 自有托管回滚不变。
