// Node hosting candidate, not a hosted deployment-controller activation.
export const CLOSED_BINDINGS=Object.freeze({
  AWS_INITIALIZED_REQUESTS_ENABLED:'false',DEPLOYMENT_WORKER_ENABLED:'false',AWS_APPLY_ENABLED:'false',
  TECHLONG_PLATFORM_CONTROLLER_ENABLED:'false',TECHLONG_PLATFORM_CONTROL_LOCAL:'false',
  TECHLONG_PLATFORM_CONTROLLER_LEASE:'',TECHLONG_PLATFORM_REQUEST_WINDOW_V6:'',
});
export const FORBIDDEN=Object.freeze(['TECHLONG_PLATFORM_CONTROLLER_PRIVATE_KEY','TECHLONG_PLATFORM_CONTROLLER_DATABASE_URL',
  'AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN','AWS_PROFILE','AWS_DEFAULT_PROFILE',
  'AWS_WEB_IDENTITY_TOKEN_FILE','AWS_ROLE_ARN','NODE_OPTIONS','NODE_PATH','NODE_EXTRA_CA_CERTS',
  'VINEXT_TRUSTED_HOSTS','VINEXT_TRUST_PROXY','STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET']);
export const must=(v,code)=>{if(!v)throw Error('PLATFORM_HOSTING_'+code);};
export function assertRuntimeEnvironment(env){
  must(FORBIDDEN.every(k=>!env[k])&&env.NODE_TLS_REJECT_UNAUTHORIZED!=='0'&&
    !Object.keys(env).some(k=>/^AWS_ENDPOINT_URL/.test(k))&&Object.entries(CLOSED_BINDINGS).every(([k,v])=>!env[k]||env[k]===v),'CLOSED_RUNTIME_REQUIRED');
}
export function buildEnvironment(env){
  // Never forward DATABASE_URL, NEXT_PUBLIC_*, AWS/Git/Cloudflare or Node overrides.
  const names=new Set(['systemroot','windir','temp','tmp','localappdata','appdata','userprofile','path']);
  return {...Object.fromEntries(Object.entries(env).filter(([k])=>names.has(k.toLowerCase()))),
    NODE_ENV:'production',CI:'true',GITHUB_ACTIONS:'true',...CLOSED_BINDINGS};
}
export function assertBuildChildEnvironment(env){
  const expected=buildEnvironment(env);
  must(Object.keys(env).length===Object.keys(expected).length&&Object.entries(env).every(([k,v])=>expected[k]===v),'BUILD_ENVIRONMENT');
}
export function serverOptions(args,env){
  must(args.length===0||(args.length===1&&args[0]==='--loopback'),'ARGUMENTS');assertRuntimeEnvironment(env);
  const port=env.PORT??'3000';must(/^[1-9][0-9]{0,4}$/.test(port)&&Number(port)>1023&&Number(port)<65536,'PORT');
  return {port:Number(port),host:args.length?'127.0.0.1':'0.0.0.0'};
}
