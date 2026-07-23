import { apiSuccess } from "@/lib/api/response";

export async function GET() {
  return Response.json(
    apiSuccess({
      status: "ok",
      service: "saas-platform",
      phase: "foundation",
      timestamp: new Date().toISOString(),
    }),
    { headers: { "cache-control": "no-store" } },
  );
}
