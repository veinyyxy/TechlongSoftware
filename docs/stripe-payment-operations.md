# Stripe 真实支付与待开通实例操作说明

当前实现使用 Stripe 托管 Checkout 的一次性预付费模式。企业 Owner 可以自行选择平台维护的共享套餐、配置实例参数并付款；系统不会为客户复制套餐。新购在付款前只创建购买订单，不创建有效订阅；已验证付款成功后才创建订阅。续费会延长原订阅周期。如果工作区尚无对应产品实例，系统会创建一条 `pending` 待开通记录；已有实例则通过产品权益记录复用。随后系统会生成受控的 AWS Sandbox 目标计划和幂等部署任务；S3 Worker 目前仍由 `applyRuntimeReady=false` 与未配置 Adapter 硬阻断，不会创建 AWS 资源。平台管理员仍保留应急手工流程。

## 配置

1. 在 Stripe Dashboard 创建或使用测试模式账号。
2. 在本地 `.env.local` 或目标托管平台的服务端 secret 中设置：

   ```env
   STRIPE_SECRET_KEY=sk_test_...
   STRIPE_WEBHOOK_SECRET=whsec_...
   ```

   系统只有在两个变量都存在时才允许工作区 Owner 创建在线购买订单；未完成配置时客户会看到明确说明。管理员手动订阅和付款只作为特殊客户或故障恢复的应急兜底。

   可选的部署计划标签使用非敏感变量：

   ```env
   AWS_REGION=ca-central-1
   AWS_DEFAULT_CELL_KEY=cell-demo-1
   ```

   当前版本是 plan-only，不需要也不得为了本流程配置 AWS Access Key；这些值不会触发 AWS 调用。

3. 在 Stripe Workbench 的 Webhooks 中注册：

   ```text
   https://<你的正式域名>/api/stripe/webhook
   ```

4. 勾选至少以下事件：

   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
   - `payment_intent.payment_failed`
   - `checkout.session.expired`

Webhook 签名密钥只用于对应的环境。Stripe CLI、本地环境和生产 Workbench 端点会各自生成不同的 `whsec_...` 值，不能混用。

## 支付成功测试

1. 用普通企业 Owner 登录，进入“选择套餐”。
2. 选择平台管理员已启用、价格大于零且绑定已发布模板版本的套餐。
3. 填写店铺名称、主题等模板允许的客户参数；访问人数等套餐限制只能查看，不能覆盖。
4. 点击确认后进入 Stripe Checkout。浏览器只提交 `planId`、可选续费订阅 ID 和实例参数，不提交价格或付款状态。
5. 在 Stripe 测试模式中使用测试卡 `4242 4242 4242 4242`，使用任意未来日期、任意 CVC 和邮编完成付款。
6. Stripe 向 `/api/stripe/webhook` 发送付款成功事件。服务端核对订单、金额、币种和事件签名后创建或续期订阅。
7. 回到付款结果页或刷新页面，确认显示“付款已确认”。
8. 在客户 Dashboard 和“订阅与账单”中确认：订阅为 `active`、付款记录为“已付款”、来源为“Stripe 在线支付”。
9. 管理员在“购买订单”确认订单为“已付款”，再到“应用实例管理”筛选“等待开通”。实例详情应显示套餐固定的部署资源档位和 `plan_only` AWS Cell 计划；这不表示任何 AWS 资源已经创建。
10. 管理员填写有效入口并标记为已开通后，客户才会看到“进入餐饮订单系统”按钮。

管理员预先创建的 `manual_pending` 订阅仍保留原有 Stripe 付款入口，用于人工报价、特殊客户或故障恢复，不作为普通客户的主要购买路径。

## 支付失败与取消测试

- 在 Stripe Checkout 中点击取消后，平台会先调用 Stripe 使该 Checkout Session 失效，确认未付款后才把本地订单和付款记录标记为 `canceled`，不会创建订阅或应用实例。如果 Stripe 已经确认收款，则不能按未付款取消，系统会记录实际付款状态。
- 在 Stripe Dashboard 或 CLI 触发 `payment_intent.payment_failed` 后，付款记录会标记为 `failed`，订单仍保留为可继续付款状态，客户可重试或显式取消；旧 Stripe 链接不会因一次失败就被静默释放。如果工作区已有有效服务，失败付款不会自动取消现有有效订阅。
- 极端竞态下若 Stripe 在本地订单已取消或过期后才确认收款，系统会照实记录为已付款并标记需人工核对，但不会自动创建订阅或实例。
- 异步支付方式失败时，`checkout.session.async_payment_failed` 同样会写入失败记录。

## 本地 Webhook 测试

安装 Stripe CLI 后，在应用本地运行时执行：

```bash
stripe listen --events checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,payment_intent.payment_failed,checkout.session.expired --forward-to http://localhost:3000/api/stripe/webhook
```

将 CLI 输出的 `whsec_...` 写入本地 `STRIPE_WEBHOOK_SECRET`。可在 Stripe Dashboard 进行测试付款，或使用 CLI 的事件触发与重投递能力验证接口。对同一事件执行重投递后，只会保留一条 `payment_webhook_events` 记录、一笔对应付款、一条对应产品实例和一条相同配置的部署计划；不会重复延长订阅周期、重复入账、重复创建实例或重复排期。Checkout 和 Webhook 均使用精确的购买订单及订阅关联，不会误更新该工作区其他产品的订阅。

## 生产前核对

- 目标托管平台的 secret 使用生产 Stripe 密钥，并与生产 Workbench Webhook 端点签名密钥匹配。
- Webhook URL 必须是 HTTPS；不要用成功返回页、浏览器参数或前端状态认定付款成功。
- 确认管理员应急情况下仍可创建手动订阅、录入银行转账等付款记录，并可调整订阅状态；普通客户主流程不依赖这些操作。
- 确认两个客户工作区互相请求付款结果和账单 API 时均无法读取对方数据。
- 先使用 Stripe 测试模式完成全流程验收，再切换到生产密钥。

## 本期范围外

- 不创建 Stripe 订阅、不自动续扣、也不处理 Stripe `customer.subscription.deleted`。本期续费是客户再次确认的一次性预付费 Checkout。
- 不提供即时取消、升级、降级、按比例计费或 Stripe Customer Portal；客户只能设置当前周期结束后取消，并可在周期结束前撤销。
- 不自动退款、不做优惠券、复杂发票或自动部署；自动创建的只是待开通实例记录和不可执行的目标计划，绝不自动创建云资源、生成 ARN、Secret 值、真实域名或把实例标记为已开通。

AWS Cell 目标计划、资源档位和下一阶段 Worker 边界见 [AWS ECS Cell 部署计划 DEMO](./aws-ecs-cell-deployment-demo.md)。
