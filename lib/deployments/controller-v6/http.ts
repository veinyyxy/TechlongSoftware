import { apiError, apiSuccess } from '../../api/response.ts';
import { ControlError, parseAction } from './contract.ts';
type Context = { params: Promise<{instanceId:string}> };
type Auth = {account:{user:{id:string}}|null;response:Response|null};
export function createControlHandlers(deps: { authorize:()=>Promise<Auth>;
  status:(id:string)=>Promise<unknown>; enabled:()=>boolean;
  act:(id:string,admin:string,action:ReturnType<typeof parseAction>)=>Promise<unknown> }) {
  const json = (body:unknown,status=200) => Response.json(body,{status,headers:{'cache-control':'no-store'}});
  const denied = (response:Response) => { const headers=new Headers(response.headers);headers.set('cache-control','no-store');
    return new Response(response.body,{status:response.status,headers}); };
  const failure = (e:unknown) => json(apiError(e instanceof ControlError ? e.code : 'CONTROL_REQUIRES_READBACK_NO_RETRY',
    '操作未获确认或结果需只读核对；不会自动重试。'),e instanceof ControlError ? e.status : 503);
  return {
    async GET(_request:Request,context:Context) {
      const auth = await deps.authorize(); if(auth.response) return denied(auth.response);
      if(!auth.account) return json(apiError('UNAUTHORIZED','请先登录。'),401);
      try { return json(apiSuccess(await deps.status((await context.params).instanceId))); } catch(e) { return failure(e); }
    },
    async POST(request:Request,context:Context) {
      try {
        const origin = request.headers.get('origin');
        if(!origin || origin !== new URL(request.url).origin) return json(apiError('ORIGIN_FORBIDDEN','请求来源不受信任。'),403);
        const auth = await deps.authorize(); if(auth.response) return denied(auth.response);
        if(!auth.account) return json(apiError('UNAUTHORIZED','请先登录。'),401);
        if(!deps.enabled()) return json(apiError('CONTROL_NOT_ACTIVATED','控制器尚未批准启用。'),409);
        if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json')
          return json(apiError('JSON_REQUIRED','只接受 JSON。'),415);
        const reader=request.body?.getReader(), chunks:Uint8Array[]=[]; let size=0;
        if(reader) try { for(;;) { const part=await reader.read();if(part.done)break;size+=part.value.byteLength;
          if(size>2048){await reader.cancel();return json(apiError('REQUEST_TOO_LARGE','请求过大。'),413);}chunks.push(part.value);
        } } finally {reader.releaseLock();}
        const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.byteLength;}
        let raw:unknown;try{raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new ControlError('CONTROL_JSON',400);}
        const action=parseAction(raw);
        return json(apiSuccess(await deps.act((await context.params).instanceId,auth.account.user.id,action)));
      }catch(e){return failure(e);}
    },
  };
}
