import { ModulePlaceholder } from "@/components/foundation/ModulePlaceholder";

export default function SettingsPage() {
  return (
    <ModulePlaceholder
      title="工作区设置"
      description="管理企业资料、联系人与账单基础信息。"
      capabilities={["公司名称", "联系人与电话", "账单资料", "工作区成员与角色"]}
    />
  );
}
