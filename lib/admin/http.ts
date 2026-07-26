import { apiError } from "@/lib/api/response";
import { ManagementError } from "./management";

export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ManagementError(
      "INVALID_JSON",
      "请求内容不是有效的 JSON。",
      400,
    );
  }
}

export function managementErrorResponse(error: unknown): Response {
  if (error instanceof ManagementError) {
    return Response.json(apiError(error.code, error.message), {
      status: error.status,
    });
  }

  return Response.json(
    apiError("INTERNAL_ERROR", "操作没有完成，请稍后重试。"),
    { status: 500 },
  );
}
