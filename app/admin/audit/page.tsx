import { ModulePlaceholder } from "@/components/foundation/ModulePlaceholder";

export default function AuditPage() {
  return <ModulePlaceholder title="操作日志" description="审计管理员与工作区关键操作。" capabilities={["操作人", "动作与对象", "发生时间", "安全元数据"]} />;
}
