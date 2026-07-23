import { ModulePlaceholder } from "@/components/foundation/ModulePlaceholder";

export default function InstancesPage() {
  return <ModulePlaceholder title="应用实例" description="管理客户对应的餐饮订单系统实例。" capabilities={["所属工作区", "租户标识", "访问地址", "开通、暂停与恢复"]} />;
}
