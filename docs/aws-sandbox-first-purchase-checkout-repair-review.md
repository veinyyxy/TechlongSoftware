# Sandbox 首开：Checkout 修正上线与原会话关联

**集中审批草案，尚不可执行。** 本轮只离线固定修复源码、范围、先后顺序和停止条件。未构建或调度、未查 Stripe／Neon／AWS、未替换函数、未部署、未关联或创建 Checkout。下文不是对任何写入的批准。

## 固定目标与当前缺项

- [原技术验收](evidence/sandbox-first-purchase-dahlia-activation-verified.json)证明平台曾运行 revision 15，原 Stripe 测试购买在 Workbench 返回 200，原会话初始为 `open/unpaid`。经已批准的一次只读核对，链接为 `https://checkout.stripe.com`，尾部匹配测试会话 ID，但不具备旧固定路径。**这些是历史事实，不证明原会话当前仍开放或未过期。**
- [机器版草案](evidence/sandbox-first-purchase-checkout-repair.prepared.json)固定源码 `5b89c18`、三文件 overlay 的 blob/SHA、预期源码树、原工作区/订单/Stripe Session 的 SHA 和原平台目标。沿用已上线 Dahlia 的 19 文件合成基底，仅三个运行时文件的字节发生变化；DDL 不进入应用镜像的三文件差异。[支付与 PostgreSQL 回归](https://github.com/veinyyxy/TechlongSoftware/actions/runs/44438551298)通过。
- [通用托管候选](https://github.com/veinyyxy/TechlongSoftware/actions/runs/44438551331)停在历史闭包门禁，没有合格产物；门禁保持不变。原专用候选／发布入口只接受旧 recipe 与旧 artifact。须另审把**这一个固定 recipe**接入既有专用隔离构建，并单次取证；不得用旧 run 重跑、替换历史证据或让旧权限匹配任意产物。本轮尚无新的 build run、artifact、config digest 或最终发布入口绑定，不签发执行 SHA。

## 最终一次批准的拟执行顺序

1. **只接受封存的修正版候选。** 在无 AWS、Stripe 或真实数据库连接的既有隔离路径中验证预期源码树、一次构建、准确产物／哈希／大小、指定架构、离线回归与扫描。最终清单须绑定原 attempt 1、真实产物和哈希、不可变发布入口、准确目标 tag 及执行上限，不以源码 SHA 代替产物或 registry digest。缺证据不开始线上操作。
2. **在写入前核对原会话、订单及平台。** 只用原测试运行密钥对准确原 Session GET 一次，要求同一 Sandbox、`livemode=false`、`mode=payment`、开放未付款、未有关联 PaymentIntent、未到期；订单 ID 同时匹配 Stripe 的 `client_reference_id` 和 metadata，金额／币种与原订单相同，返回链接通过新共享校验。只读确认同一工作区、原 Owner、原订单仍为 `draft`、原付款记录为 `pending` 且两者没有已有会话关联、没有为这笔订单登记首开任务；确认平台仍为原栈、原服务、原镜像、原固定 Secret 及关停 worker 布局。任一条件不符或时间不足，**所有写入均停止**，不创建替代会话。
3. **只发布一次，只更新平台镜像。** 复用原发布器栈及一次性临时授权；只推送新候选到原不可变 ECR 仓库，经用户本人批准同一次 `techlong-sandbox-deploy`。成功、失败或提交不明都按已审机制立即尝试一次撤权，独立证明 Locked 和 registry manifest 与准确候选匹配才继续。原 Hosting 栈仅允许一个 Change Set、一次核对后执行；只变更 Web 容器镜像、对应源码／镜像证据元数据与 Service 的 task definition 引用。保留原 Access 栈、权限、网络、域名、任务数、固定 Secret/版本和关闭的控制器／worker。独立核对新运行镜像、健康与原布局；未通过则不执行数据库步骤，不自动重试、补齐或跨系统回滚。
4. **只替换 `attach` 并关联原单、原会话。** 上一步通过后再对同一 Session 最多 GET 一次，重复校验有效期、未付状态、匹配关系及 URL，保留所需字段只在进程内。极短的单事务内先锁定重核原 `draft`、原 `pending` 及无关联状态，不写业务表直连补丁。只替换 `sandbox_first_purchase.attach(text,text,text,text,bigint)`：在同一事务内按原已审所有者方式临时启用仅供安装者切换到既有 definer 的 SET，执行固定 `CREATE OR REPLACE`，用同一函数**一次**关联原订单 / 原 Session，撤销临时 SET 后才提交。对比全套原函数定义和 ACL：仅 `attach` 正文的 URL 规则改变，OID、所有者、授予及函数搜索路径等属性不变；其余函数、角色、grants 与 schema 不重装。任何不匹配或 `attach` 未明确返回成功，本事务不得提交。提交结果不明停止，只接受另审后的只读回查，不重复调用。
5. **独立回读后再交给用户。** 确认单条原订单变为 `checkout_pending`、保存同一个 Session、原付款仍 `pending` 且未增加购买／会话／首开任务；只展示去敏布尔结果与证据摘要。不输出或直接使用完整 Stripe 链接，不代购。通过后由用户从平台继续原单，后续成功回调及首开登记仍独立验收。

## 风险、时限及不可扩大范围

原 Stripe 响应记载原会话到期为**温尼伯 11 月 19 日 19:16:57**（`2026-11-20T01:16:57Z`）。这不是当前状态或可延长窗口。最终清单应结合新的证据有效期与候选产物有效期，在会话到期前留足发布、滚动更新、回读和关联余量；来不及或状态已变则停止，不试付、不延会话、不创建另一单。正式现场核对、密钥和配置读取次数、准确 AWS 元数据上限及写窗口均待产物绑定后逐项列明。

可能有 CI、ECR 或原承载费用、滚动短时中断、凭据／Stripe 链接在授权进程内的暴露，以及平台更新与数据库事务非原子的风险。批准只涉及一份候选、一次临时发布／撤权、原 Hosting 一次更新、Neon 一次单函数加单订单事务及独立回读。无新的 IAM 范围、新 Secret、Stripe 写、退款、真实付款、其他订单写入、任务领取、worker 启用或租户上线权限。不删除、不复位旧槽、不更改门禁、不回滚或重试未确认的写入；CloudFormation 自有托管回滚不变。
