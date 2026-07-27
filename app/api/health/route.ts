import { apiSuccess } from "@/lib/api/response";
import { platformConfig } from "@/config/platform";

export async function GET() {
  return Response.json(
    apiSuccess({
      status: "ok",
      service: "saas-platform",
      phase: platformConfig.phase,
      timestamp: new Date().toISOString(),
    }),
    { headers: { "cache-control": "no-store" } },
  );
}
