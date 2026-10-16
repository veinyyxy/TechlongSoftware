import { apiError, apiSuccess } from '../api/response.ts';
import { InitializedRequestError, parseInitializedRequestBody } from './initialized-platform-request-v1.ts';
type Context = { params: Promise<{ instanceId: string }> };
type Authorization = { account: { user: { id: string } } | null; response: Response | null };
/** Testable HTTP boundary; dependencies in the real route are existing admin
 * session authorization and the concrete DB store, never browser-provided ports. */
export function createInitializedPlatformHandlers(deps: {
  authorize: () => Promise<Authorization>; enabled: () => boolean;
  read: (id: string) => Promise<unknown>;
  submit: (input: { instanceId: string; adminUserId: string; body: unknown }) => Promise<{ created: boolean; jobId: string; cloudExecutionAuthorized: boolean }>;
}) {
  return {
    async GET(_request: Request, context: Context) {
      const auth = await deps.authorize();
      if (auth.response) return auth.response;
      if (!auth.account) return Response.json(apiError('UNAUTHORIZED', '请先登录。'), { status: 401 });
      try { return Response.json(apiSuccess(await deps.read((await context.params).instanceId)), { headers: { 'cache-control': 'no-store' } }); }
      catch { return Response.json(apiError('INITIALIZED_STATUS_UNAVAILABLE', '无法读取受控部署状态。'), { status: 503 }); }
    },
    async POST(request: Request, context: Context) {
      let trusted = false;
      try { trusted = Boolean(request.headers.get('origin')) && new URL(request.headers.get('origin')!).origin === new URL(request.url).origin; } catch { /* reject */ }
      if (!trusted) return Response.json(apiError('ORIGIN_FORBIDDEN', '请求来源不受信任。'), { status: 403 });
      const auth = await deps.authorize();
      if (auth.response) return auth.response;
      if (!auth.account) return Response.json(apiError('UNAUTHORIZED', '请先登录。'), { status: 401 });
      if (!deps.enabled()) return Response.json(apiError('INITIALIZED_REQUESTS_DISABLED', '请求写入口尚未批准开启。'), { status: 409 });
      if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json')
        return Response.json(apiError('JSON_REQUIRED', '只接受 JSON 请求。'), { status: 415 });
      try {
        const reader = request.body?.getReader(), chunks: Uint8Array[] = [];
        let size = 0;
        if (reader) {
          try {
            for (;;) {
              const part = await reader.read(); if (part.done) break;
              size += part.value.byteLength;
              if (size > 2048) { await reader.cancel(); return Response.json(apiError('REQUEST_TOO_LARGE', '请求内容过大。'), { status: 413 }); }
              chunks.push(part.value);
            }
          } finally { reader.releaseLock(); }
        }
        const bytes = new Uint8Array(size); let offset = 0;
        for (const part of chunks) { bytes.set(part, offset); offset += part.byteLength; }
        let text: string;
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
        catch { return Response.json(apiError('INVALID_JSON', '请求不是有效 UTF-8 JSON。'), { status: 400 }); }
        let raw: unknown;
        try { raw = JSON.parse(text); } catch { return Response.json(apiError('INVALID_JSON', '请求不是有效 JSON。'), { status: 400 }); }
        const body = parseInitializedRequestBody(raw);
        const result = await deps.submit({ instanceId: (await context.params).instanceId, adminUserId: auth.account.user.id, body });
        return Response.json(apiSuccess(result), { status: result.created ? 201 : 200, headers: { 'cache-control': 'no-store' } });
      } catch (e) {
        if (e instanceof InitializedRequestError) return Response.json(apiError(e.code, e.message), { status: e.status });
        return Response.json(apiError('REQUEST_REQUIRES_READBACK', '结果需要刷新列表核对；不会自动重试。'), { status: 503 });
      }
    },
  };
}
