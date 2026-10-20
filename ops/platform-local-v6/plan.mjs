// Public review + ordered startup only. No filesystem, client or process discovery.
import {canonicalJson,sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {INSTALLED_BINDING_V6 as B} from '../../lib/deployments/controller-v6/installed-binding.ts';
import {verifiedRuntimeLeaseV6,CONTROL_ORIGIN_V6} from '../../lib/deployments/controller-v6/configuration.ts';
export const L=Object.freeze({root:'E:/NodejsProject/TechlongSoftware',base:'F:/ChatGPT_workshop',
  key:'E:/NodejsProject/TechlongSoftware/techlong-sandbox-controller.2026-10-19.private-key.pem',
  authFile:'E:/NodejsProject/TechlongSoftware/.env.local',config:'ops/platform-local-v6/worker.json',
  secretArn:'arn:aws:secretsmanager:ca-central-1:402010193138:secret:techlong/sandbox/platform-controller/neon-v6-M4A08E',
  versionId:'3574f24e-ecb3-476c-8f71-baa501fd129e',region:'ca-central-1',
  sourceArn:'arn:aws:iam::402010193138:user/techlong-sandbox-dev',sourceUserId:'AIDAV3GNMXTZEO7SHLC2X',
  slot:'F:/ChatGPT_workshop/techlong-w6k-local-runtime.intent.json',
  riskFile:'docs/aws-auto-deployment-platform-w6k-local-runtime-review.md',validMs:48*3600000,runMs:1800000});
export const must=(v,c)=>{if(!v)throw Error('LOCAL_RUNTIME_'+c);};
export const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
export const BINDINGS=Object.freeze(['DATABASE_URL','AWS_INITIALIZED_REQUESTS_ENABLED','DEPLOYMENT_WORKER_ENABLED','AWS_APPLY_ENABLED',
  'TECHLONG_PLATFORM_CONTROLLER_ENABLED','TECHLONG_PLATFORM_CONTROL_LOCAL','TECHLONG_PLATFORM_CONTROLLER_LEASE',
  'TECHLONG_PLATFORM_CONTROLLER_DATABASE_URL','TECHLONG_PLATFORM_CONTROLLER_PRIVATE_KEY']);
export async function makeLocalReviewV6({sourceCommit,pins,ci,metadata,createdAt}){
  must(B.state==='PUBLISHED'&&B.publisher.state==='PUBLISHED'&&await sha256Hex(B.platform)===B.publisher.releaseSha256,'BINDING');
  must(/^[a-f0-9]{40}$/.test(sourceCommit)&&ci?.sourceCommit===sourceCommit&&ci.conclusion==='success'&&ci.status==='completed'&&ci.attempt===1&&
    Number.isSafeInteger(createdAt)&&pins.length>=12&&new Set(pins.map(p=>p.file)).size===pins.length&&pins.every(p=>/^[a-f0-9]{64}$/.test(p.sha256)),'SOURCE_CI');
  must(metadata.source?.Account==='402010193138'&&metadata.source.Arn===L.sourceArn&&metadata.source.UserId===L.sourceUserId&&
    metadata.secret?.arn===L.secretArn&&metadata.secret.versionId===L.versionId&&metadata.secret.current===true&&metadata.secret.sourceOnlyPolicyMatched===true&&
    metadata.key?.protectedThreePrincipalAcl===true&&metadata.key.keyContentRead===false&&metadata.key.length>0&&metadata.key.length<=16000&&
    /^[a-f0-9]{64}$/.test(metadata.key.aclSha256)&&metadata.auth?.contentRead===false&&metadata.auth.length>0&&metadata.auth.length<=131072&&
    /^[a-f0-9]{64}$/.test(metadata.auth.aclSha256)&&metadata.portFree===true,'METADATA');
  const body={schema:'techlong/platform-local-start-review/v6',sourceCommit,pins,ci,metadata,createdAt,expiresAt:createdAt+L.validMs,
    binding:B,origin:CONTROL_ORIGIN_V6,secret:{arn:L.secretArn,versionId:L.versionId},keyPath:L.key,authFile:L.authFile,
    riskFile:L.riskFile,permanentSlot:L.slot,runMs:L.runMs,
    effects:{fixedSecretReadsMax:1,privateKeyFileReadsMax:1,existingAuthFileReadsMax:1,childStartsMax:1,awsWrites:0,
      automaticSqlConnections:0,automaticAppTokens:0,automaticDispatches:0,businessRequestEntryEnabled:false,workerEnabled:false,awsApplyEnabled:false,automaticRetries:0},
    risks:{privateValuesInTrustedProcessMemory:true,existingOwnerCredentialForNormalAuthentication:true,normalUiActionsRemainPossible:true,
      startupIsNotDispatchApproval:true,providerAndLocalToolExposure:true,metadataNotCas:true,stopMayBeUnconfirmed:true,
      expiryDoesNotCancelInFlightOperations:true,noGuaranteedMemoryErasure:true,noAutomaticRetryResetOrCompensation:true},preparationIsNotApproval:true};
  return {...body,manifestSha256:await sha256Hex(body)};
}
export async function verifyLocalReviewV6(m,approved,now,inspect=false){
  must(same(m,await makeLocalReviewV6(m)),'MANIFEST_CHANGED');
  if(!inspect)must(approved===m.manifestSha256&&now>=m.createdAt&&now+L.runMs<m.expiresAt,'APPROVAL_OR_WINDOW');
}
export async function localLeaseV6(m,now){
  const lease={schema:'techlong/platform-local-runtime-lease/v6',releaseSha256:m.binding.publisher.releaseSha256,
    origin:m.origin,sourceCommit:m.sourceCommit,issuedAt:now,expiresAt:now+L.runMs};
  must(await verifiedRuntimeLeaseV6(JSON.stringify(lease),B.platform,now),'LEASE');return lease;
}
export function childEnvironmentV6(inherited,material,lease){
  // Do not spread inherited env: AWS/Git/Node overrides and VITE_* never enter child.
  const names=new Set(['systemroot','windir','temp','tmp','localappdata','appdata','userprofile','path']);
  return {...Object.fromEntries(Object.entries(inherited).filter(([k])=>names.has(k.toLowerCase()))),
    DATABASE_URL:material.authUrl,TECHLONG_PLATFORM_CONTROLLER_DATABASE_URL:material.databaseUrl,
    TECHLONG_PLATFORM_CONTROLLER_PRIVATE_KEY:material.privateKey,TECHLONG_PLATFORM_CONTROLLER_LEASE:JSON.stringify(lease),
    TECHLONG_PLATFORM_CONTROLLER_ENABLED:'true',TECHLONG_PLATFORM_CONTROL_LOCAL:'true',TECHLONG_PLATFORM_LOCAL_LAUNCHER_V6:'true',
    AWS_INITIALIZED_REQUESTS_ENABLED:'false',DEPLOYMENT_WORKER_ENABLED:'false',AWS_APPLY_ENABLED:'false',
    // Wrangler reads only the dedicated config directory, not repository .env files.
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV:'true',CLOUDFLARE_INCLUDE_PROCESS_ENV:'true',
    WRANGLER_WRITE_LOGS:'false',WRANGLER_SEND_METRICS:'false',DO_NOT_TRACK:'1',
    WRANGLER_LOG_PATH:'.wrangler/logs',MINIFLARE_REGISTRY_PATH:'.wrangler/registry',NODE_ENV:'development'};
}
export async function startLocalOnceV6({manifest:m,approved,io,now=Date.now}){
  const approval=()=>verifyLocalReviewV6(m,approved,now());await approval();await io.assertSource(m);
  const t=now(),metadata=await io.metadata();must(now()-t<120000&&same(metadata,m.metadata),'FRESH_METADATA_CHANGED');await approval();
  const lease=await localLeaseV6(m,now());
  await io.claim({manifestSha256:m.manifestSha256,sourceCommit:m.sourceCommit,lease,consumedAt:now(),retryAllowed:false});
  let phase='SLOT_CONSUMED',material;
  const guard=async()=>{await approval();must(now()<lease.issuedAt+120000,'STARTUP_WINDOW');await io.assertSource(m);};
  try{
    await guard();phase='FIXED_SECRET_READ';const databaseUrl=await io.readSecret();
    await guard();phase='PRIVATE_KEY_READ';const privateKey=await io.readKey(m.metadata.key);
    await guard();phase='EXISTING_AUTH_FILE_READ';const authUrl=await io.readAuth(m.metadata.auth);
    material={databaseUrl,privateKey,authUrl};await guard();phase='CHILD_START';
    const result=await io.serve(material,lease,ready=>io.record('started',{...ready,lease,manifestSha256:m.manifestSha256}));
    must(result.childExited===true&&result.portFree===true&&result.cleanClose===true,'STOP_UNCONFIRMED');
    const receipt={outcome:'LOCAL_RUNTIME_STOPPED_REQUIRES_INDEPENDENT_INSPECT',lease,childExited:true,portFree:true,
      runtimeStarted:true,automaticDispatches:0,retryAllowed:false};await io.record('result',receipt);return receipt;
  }catch{
    const receipt={outcome:'LOCAL_RUNTIME_STOPPED_OR_UNKNOWN_INSPECT_ONLY',phase,lease,retryAllowed:false};
    await io.record('result',receipt);return receipt;
  }finally{material=undefined;}
}
