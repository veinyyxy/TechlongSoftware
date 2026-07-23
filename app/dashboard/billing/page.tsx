import { ModulePlaceholder } from "@/components/foundation/ModulePlaceholder";

export default function BillingPage() {
  return (
    <ModulePlaceholder
      title="订阅与账单"
      description="查看当前套餐、订阅周期与管理员记录的付款状态。"
      capabilities={["当前套餐", "订阅状态", "付款记录", "续费与到期信息"]}
    />
  );
}
