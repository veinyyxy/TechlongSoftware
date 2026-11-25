import { apiError, apiSuccess } from "../api/response.ts";
import { isFirstOpenDispatchLookupId, type FirstOpenAdminStore, type FirstOpenApprovalOptions } from "./first-open-admin-store.ts";

export interface FirstOpenAdminActor {
  id: string;
  isPlatformAdmin: boolean;
  status: "active" | "disabled";
}

type Authorization =
  | { account: { user: FirstOpenAdminActor }; response: null }
  | { account: null; response: Response };

type Context = { params: Promise<{ instanceId: string }> };

export function isFirstOpenAdmin(actor: FirstOpenAdminActor) {
  return actor.status === "active" && actor.isPlatformAdmin === true;
}

const json = (body: unknown, status = 200) => Response.json(body, {
  status,
  headers: { "cache-control": "no-store" },
});

const notFound = () => json(apiError("APP_INSTANCE_NOT_FOUND", "没有找到该应用实例。"), 404);

export function createFirstOpenAdminHandlers(input: {
  authorize: () => Promise<Authorization>;
  store: () => Pick<FirstOpenAdminStore, "read" | "approve">;
  approvalOptions?: () => FirstOpenApprovalOptions | undefined;
}) {
  async function handle(request: Request, context: Context, approve: boolean) {
    if (approve) {
      const origin = request.headers.get("origin");
      if (!origin || origin !== new URL(request.url).origin) {
        return json(apiError("ORIGIN_FORBIDDEN", "请求来源不受信任。"), 403);
      }
      if (request.body !== null) {
        return json(apiError("FIRST_OPEN_UNEXPECTED_BODY", "开通审批只接受路径中的实例编号。"), 400);
      }
    }

    try {
      const authorization = await input.authorize();
      if (authorization.response) {
        const headers = new Headers(authorization.response.headers);
        headers.set("cache-control", "no-store");
        return new Response(authorization.response.body, { status: authorization.response.status, headers });
      }
      const actor = authorization.account.user;
      if (!isFirstOpenAdmin(actor)) {
        return json(apiError("PLATFORM_ADMIN_REQUIRED", "当前账号没有管理开通的权限。"), 403);
      }
      const { instanceId } = await context.params;
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/.test(instanceId)) return notFound();

      if (approve) {
        const execution = await input.store().approve(instanceId, actor.id, input.approvalOptions?.());
        return execution ? json(apiSuccess(execution)) :
          json(apiError("FIRST_OPEN_NOT_ELIGIBLE", "该实例目前无法批准开通。请刷新后核对付款和任务状态。"), 409);
      }

      const ids = new URL(request.url).searchParams.getAll("executionId");
      if (ids.length > 1 || (ids.length === 1 && !isFirstOpenDispatchLookupId(ids[0]))) {
        return json(apiError("FIRST_OPEN_EXECUTION_ID_INVALID", "只读核对需要准确的开通执行编号。"), 400);
      }
      const view = await input.store().read(instanceId, actor.id, ids[0]);
      return view ? json(apiSuccess(view)) : notFound();
    } catch {
      return approve ?
        json(apiError("FIRST_OPEN_APPROVAL_UNCONFIRMED", "审批结果未确认。请刷新或查看本实例的开通日志。"), 503) :
        json(apiError("FIRST_OPEN_READ_UNAVAILABLE", "暂时无法读取开通信息。"), 503);
    }
  }

  return {
    GET: (request: Request, context: Context) => handle(request, context, false),
    POST: (request: Request, context: Context) => handle(request, context, true),
  };
}
