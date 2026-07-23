import { ModulePlaceholder } from "@/components/foundation/ModulePlaceholder";

export default function PaymentsPage() {
  return <ModulePlaceholder title="付款记录" description="记录首版线下或人工确认的付款结果。" capabilities={["金额与币种", "付款时间", "付款状态", "失败原因与备注"]} />;
}
