import { ModulePlaceholder } from "@/components/foundation/ModulePlaceholder";

export default function AppsPage() {
  return (
    <ModulePlaceholder
      title="我的应用"
      description="查看企业工作区已购买和已开通的餐饮订单系统。"
      capabilities={["应用实例列表", "运行、暂停与未开通状态", "安全的后台访问入口", "最近更新时间"]}
    />
  );
}
