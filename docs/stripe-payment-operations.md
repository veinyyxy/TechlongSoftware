# Stripe 真实支付一期操作说明

当前实现使用 Stripe 托管 Checkout 的一次性付款模式。付款成功只会更新当前企业工作区的订阅和付款记录；餐饮订单系统实例仍由平台管理员在“应用实例管理”中手动创建和开通。

## 配置

1. 在 Stripe Dashboard 创建或使用测试模式账号。
2. 在本地 `.env.local` 或 Sites 的服务端环境变量中设置：

   ```env
   STRIPE_SECRET_KEY=sk_test_...
   STRIPE_WEBHOOK_SECRET=whsec_...
   ```

   系统只有在两个变量都存在时才向工作区 Owner 显示在线付款按钮；未完成配置时客户会看到明确说明，并可继续使用管理员手动付款流程。

3. 在 Stripe Workbench 的 Webhooks 中注册：

   ```text
   https://<你的私有 Sites 域名>/api/stripe/webhook
   ```

4. 勾选至少以下事件：

   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
   - `payment_intent.payment_failed`
   - `checkout.session.expired`

Webhook 签名密钥只用于对应的环境。Stripe CLI、本地环境和生产 Workbench 端点会各自生成不同的 `whsec_...` 值，不能混用。

## 支付成功测试

1. 用普通企业 Owner 登录，进入“订阅与账单”。
2. 确认至少有一个启用、价格大于零的套餐。
3. 点击“选择套餐并付款”，跳转至 Stripe Checkout。
4. 在 Stripe 测试模式中使用测试卡 `4242 4242 4242 4242`，使用任意未来日期、任意 CVC 和邮编完成付款。
5. Stripe 向 `/api/stripe/webhook` 发送付款成功事件。
6. 回到付款结果页或刷新页面，确认显示“付款已确认”。
7. 在客户 Dashboard 和“订阅与账单”中确认：订阅为 `active`、付款记录为“已付款”、来源为“Stripe 在线支付”。
8. 管理员随后在“应用实例管理”手动创建或恢复实例；系统不会因付款而自动开通实例。

## 支付失败与取消测试

- 在 Stripe Checkout 中点击取消，会回到付款结果页并显示“付款已取消”；对应付款记录状态为 `canceled`，不会自动创建订阅或实例。
- 在 Stripe Dashboard 或 CLI 触发 `payment_intent.payment_failed` 后，付款记录会标记为 `failed`。如果工作区已有有效服务，失败付款不会自动取消现有管理员维护的有效订阅。
- 异步支付方式失败时，`checkout.session.async_payment_failed` 同样会写入失败记录。

## 本地 Webhook 测试

安装 Stripe CLI 后，在应用本地运行时执行：

```bash
stripe listen --events checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,payment_intent.payment_failed,checkout.session.expired --forward-to http://localhost:3000/api/stripe/webhook
```

将 CLI 输出的 `whsec_...` 写入本地 `STRIPE_WEBHOOK_SECRET`。可在 Stripe Dashboard 进行测试付款，或使用 CLI 的事件触发与重投递能力验证接口。对同一事件执行重投递后，只会保留一条 `payment_webhook_events` 记录和一笔对应付款；不会重复延长订阅周期或重复入账。

## 生产前核对

- Sites 环境变量使用生产 Stripe 密钥，并与生产 Workbench Webhook 端点签名密钥匹配。
- Webhook URL 必须是 HTTPS；不要用成功返回页、浏览器参数或前端状态认定付款成功。
- 确认管理员仍可创建手动订阅、录入银行转账等付款记录，并可调整订阅状态。
- 确认两个客户工作区互相请求付款结果和账单 API 时均无法读取对方数据。
- 先使用 Stripe 测试模式完成全流程验收，再切换到生产密钥。

## 本期范围外

- 不创建 Stripe 订阅、不自动续扣、也不处理 Stripe `customer.subscription.deleted`。
- 不自动退款、不做优惠券、复杂发票、自动部署或自动创建餐饮订单系统实例。
