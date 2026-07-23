import { ModulePlaceholder } from "@/components/foundation/ModulePlaceholder";

export default function CustomersPage() {
  return <ModulePlaceholder title="客户管理" description="管理企业工作区与负责人。" capabilities={["客户列表", "企业资料", "负责人", "服务状态"]} />;
}
