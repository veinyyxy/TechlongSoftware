import { ModulePlaceholder } from "@/components/foundation/ModulePlaceholder";

export default function PlansPage() {
  return <ModulePlaceholder title="套餐管理" description="配置可销售的餐饮订单系统套餐。" capabilities={["套餐名称", "价格与周期", "功能和额度", "启用状态"]} />;
}
