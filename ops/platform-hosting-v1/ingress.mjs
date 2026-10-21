import {must} from './contract.mjs';

export const PUBLIC_ORIGIN='https://console.sandbox.techlong.cloud';
const PUBLIC_HOST=new URL(PUBLIC_ORIGIN).host;
const SAFE_METHODS=new Set(['GET','HEAD']);
const WRITE_METHODS=new Set(['POST','PUT','PATCH','DELETE']);
const CRITICAL=new Set(['host','origin','x-forwarded-host','x-forwarded-proto','x-forwarded-port','sec-fetch-site']);
const forwarded=name=>name==='forwarded'||name.startsWith('x-forwarded-')||name==='x-real-ip';

export function ingressPolicy(env,options){
  const mode=env.TECHLONG_PLATFORM_INGRESS,origin=env.TECHLONG_PLATFORM_PUBLIC_ORIGIN;
  if(!mode&&!origin)return Object.freeze({mode:'loopback',host:`127.0.0.1:${options.port}`,origin:`http://127.0.0.1:${options.port}`});
  must(mode==='alb-https-v1'&&origin===PUBLIC_ORIGIN&&options.host==='0.0.0.0','INGRESS_CONFIG');
  return Object.freeze({mode,host:PUBLIC_HOST,origin:PUBLIC_ORIGIN});
}

// Validate original wire fields, before Node's merged headers can hide duplicates.
export function checkIngress(req,policy){
  const values=new Map();
  for(let i=0;i<req.rawHeaders.length;i+=2){
    const name=req.rawHeaders[i].toLowerCase();
    if(CRITICAL.has(name)){
      if(values.has(name))return 400;
      values.set(name,req.rawHeaders[i+1]);
    }
  }
  if(!values.get('host')||[...values.values()].some(v=>typeof v!=='string'||/[\r\n,]/.test(v)))return 400;
  if(!req.url?.startsWith('/')||req.url.startsWith('//')||/[\\#\x00-\x20\x7f]/.test(req.url))return 400;
  const method=req.method;
  if(!SAFE_METHODS.has(method)&&!WRITE_METHODS.has(method)&&method!=='OPTIONS')return 405;
  const headers=req.headers;
  // ALB/container health probes use target-IP Host and have no browser/proxy context.
  // Only this exact read-only route is exempt. Strip ALL caller headers below.
  const health=SAFE_METHODS.has(method)&&req.url==='/api/health'&&
    !Object.keys(headers).some(forwarded)&&!headers.origin&&!headers.cookie&&!headers.authorization&&!headers['next-action'];
  if(health)return 0;
  const acceptedHost=v=>v===policy.host||(policy.mode==='alb-https-v1'&&v===policy.host+':443');
  if(!acceptedHost(values.get('host')))return 421;
  if(policy.mode==='alb-https-v1'){
    if(values.get('x-forwarded-proto')!=='https'||values.get('x-forwarded-port')!=='443')return 400;
    if(values.has('x-forwarded-host')&&!acceptedHost(values.get('x-forwarded-host')))return 421;
    if(headers.forwarded!==undefined)return 400;
  }else if(Object.keys(headers).some(forwarded))return 400;
  if(values.has('origin')&&values.get('origin')!==policy.origin)return 403;
  if(WRITE_METHODS.has(method)){
    if(values.get('origin')!==policy.origin)return 403;
    if(values.has('sec-fetch-site')&&!['same-origin','none'].includes(values.get('sec-fetch-site')))return 403;
  }
  return 0;
}

export function ingressHandler(handler,policy){
  return (req,res)=>{
    const status=checkIngress(req,policy);
    if(status){
      res.writeHead(status,{'content-type':'text/plain; charset=utf-8','cache-control':'no-store','connection':'close'});
      res.end('PLATFORM_INGRESS_REFUSED');return;
    }
    const health=SAFE_METHODS.has(req.method)&&req.url==='/api/health'&&!Object.keys(req.headers).some(forwarded);
    if(health)req.headers={};
    for(const name of Object.keys(req.headers))if(forwarded(name))delete req.headers[name];
    req.headers.host=policy.host;
    if(policy.mode==='alb-https-v1'){
      req.headers['x-forwarded-host']=policy.host;req.headers['x-forwarded-proto']='https';req.headers['x-forwarded-port']='443';
      res.setHeader('strict-transport-security','max-age=300');
    }
    req.rawHeaders=Object.entries(req.headers).flatMap(([k,v])=>Array.isArray(v)?v.flatMap(item=>[k,item]):[k,v]);
    handler(req,res);
  };
}

export function installIngress(server,policy){
  // Never prepend a listener: that would still execute the original handler on refusal.
  const listeners=server.listeners('request');
  must(!server.listening&&listeners.length===1&&['upgrade','connect','checkContinue','checkExpectation'].every(e=>server.listenerCount(e)===0),'INGRESS_LISTENERS');
  server.removeAllListeners('request');server.on('request',ingressHandler(listeners[0],policy));
}
