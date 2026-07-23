import { ModulePlaceholder } from "@/components/foundation/ModulePlaceholder";

export default function SubscriptionsPage() {
  return <ModulePlaceholder title="订阅管理" description="为企业工作区手动设置订阅状态。" capabilities={["客户与套餐关联", "订阅周期", "状态调整", "到期时间"]} />;
}
