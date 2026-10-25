// Explicit live adapter. Importing constructs no client and discovers no credential.
import {createRequire} from 'node:module';
import path from 'node:path';
import {createGitHubController} from '../../lib/deployments/controller-v6/github.ts';
import {validatePlan} from '../../lib/deployments/controller-v6/contract.ts';
import {INSTALLED_BINDING_V6 as B} from '../../lib/deployments/controller-v6/installed-binding.ts';
import {canonicalJson,sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {assertReferenceV6,resultKeyV6,S} from '../platform-cloud-v6/contract.mjs';
import {EVIDENCE_V5 as E,evidenceKeyV5,assertEvidenceSafeV5} from '../cloud-worker/cloud-evidence-v5.mjs';
import {createVerifiedCredentialPort} from '../platform-operations-v6/credentials.mjs';
import {ROOT,git,keyMetadata,readKey,cleanSource,sourcePins,evidenceRoot,writeOnce} from './files.mjs';
import {LIMITS,SOURCE_IDENTITY,must,same,verifyReview,intentName} from './review.mjs';

export async function boundedJson(response,max=256000){
  must(response.body,'HTTP_BODY');const reader=response.body.getReader(),parts=[];let size=0;
  try{for(;;){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;must(size<=max,'HTTP_SIZE');parts.push(Buffer.from(r.value));}}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts)));
}
export function createInspectTransport(m,p){
  const followup=m.schema==='techlong/platform-operator-followup-review/v1'&&m.policy.waitForRunOnce===true;
  let token,closed=false,ack,gets=0,heads=0,executionHeads=0,runs=0,keys=0,issues=0,posts=0,revokes=0,http=0,credentialLoads=0;
  let originalReference=m.input.resultReference??null;
  const cache=new Map(),allowed=new Set([...(originalReference?[originalReference]:[]),...['installation','manifest','lineage'].filter(k=>m.input.plan.inputs[k]!=='')
    .map(k=>JSON.parse(m.input.plan.inputs[k]))].map(canonicalJson));
  const input=m.input,sourceCommit=input.plan.sourceCommit,job=input.plan.jobId,mv=input.plan.inputs.manifestSha;
  const reserve=()=>{if(followup)must(p.now()+m.policy.minInspectReserveMs<Math.min(p.deadline,m.expiresAt,input.workloadExpiresAt),'FOLLOWUP_INSUFFICIENT_WINDOW');};
  const guard=async()=>{must(!closed,'CLOSED');await p.guard();};
  const readRun=async id=>{
    await guard();must(token&&(id===input.runId||id===ack?.runId)&&runs<LIMITS.maxRunGets,'RUN_BUDGET_OR_SCOPE');runs++;
    const r=await p.fetch(`https://api.github.com/repos/${S.repository}/actions/runs/${id}`,{method:'GET',redirect:'manual',cache:'no-store',
      headers:{authorization:'Bearer '+token,accept:'application/vnd.github+json','x-github-api-version':'2026-03-10','user-agent':'Techlong-Reviewed-Operator-V6'},
      signal:AbortSignal.timeout(20000)});
    must(r.status===200,'RUN_RESPONSE');return boundedJson(r);
  };
  async function readObject(ref){
    await guard();const k=canonicalJson(ref);must(allowed.has(k),'OBJECT_ALLOWLIST');
    if(cache.has(k))return structuredClone(cache.get(k).object);
    must(gets<LIMITS.maxObjects,'OBJECT_BUDGET');gets++;const r=await p.getObject(ref);
    must(r.versionId===ref.versionId&&r.encryption==='AES256'&&r.contentLength>0&&r.contentLength<=1000000,'OBJECT_METADATA');
    assertEvidenceSafeV5(r.value);must(await sha256Hex(r.value)===ref.sha256,'OBJECT_HASH');
    if(ref.key===originalReference?.key||ref.key===resultKeyV6(job,mv,ack?.runId??input.runId)){
      const original=ref.key===originalReference?.key,id=original?input.runId:ack.runId,mode=original?'RunOnce':'Inspect',v=r.value;
      must(v.mode===mode&&v.jobId===job&&v.manifestSha256===mv&&v.run?.runId===id&&v.run.commitSha===sourceCommit,'RESULT_BINDING');
      assertReferenceV6(v.cloudReportReference,evidenceKeyV5(original?'run.json':'inspect.json',{jobId:job,manifestSha256:mv,run:v.run}));
      allowed.add(canonicalJson(v.cloudReportReference));
      if(original){assertReferenceV6(v.executionReference,`worker-v5/${S.instanceId}/${job}/${mv}/execution-reference-${id}-v1.json`);
        allowed.add(canonicalJson(v.executionReference));}
    }
    const item={reference:structuredClone(ref),object:structuredClone(r)};cache.set(k,item);await p.record('object-'+gets,item);return structuredClone(r);
  }
  const appGets=new Set(['/app',`/app/installations/${S.installationId}`,'/installation/repositories','/users/techlong-sandbox-controller%5Bbot%5D',
    `/repos/${S.repository}/git/ref/heads/main`,`/repos/${S.repository}/actions/workflows/${S.workflowFile}`]);
  const controller=createGitHubController({release:B.platform,now:p.now,privateKey:async()=>{
    await guard();must(keys++===0,'KEY_ONCE');return p.readKey(input.keyPath,m.key);
  },fetch:async(url,options)=>{
    const u=new URL(url),method=options.method??'GET';must(u.origin==='https://api.github.com'&&!u.search&&!u.hash&&options.redirect==='manual','APP_ENDPOINT');
    // An already-issued token must get its one cleanup attempt even after expiry.
    if(method!=='DELETE')await guard();must(http++<10,'APP_HTTP_BUDGET');
    if(method==='POST'&&u.pathname===`/app/installations/${S.installationId}/access_tokens`)must(issues++===0,'TOKEN_ONCE');
    else if(method==='POST'){
      must(u.pathname===`/repos/${S.repository}/actions/workflows/${S.workflowFile}/dispatches`&&posts===0,'DISPATCH_ONCE');
      reserve();
      const body=JSON.parse(options.body);must(body.ref==='main'&&body.return_run_details===true&&same(body.inputs,dispatchPlan?.inputs)&&body.inputs.mode==='Inspect','INSPECT_ONLY');
      posts++;
    }else if(method==='DELETE')must(u.pathname==='/installation/token'&&revokes++===0,'REVOKE_ONCE');
    else must(method==='GET'&&appGets.has(u.pathname),'APP_GET_SCOPE');
    return p.fetch(url,options);
  }});
  let dispatchPlan;
  async function resultHead(id,name){
    const key=resultKeyV6(job,mv,id),r=await p.headObject(key);
    must(typeof r.versionId==='string'&&r.encryption==='AES256'&&r.contentLength>0&&r.contentLength<=1000000&&
      /^[A-Za-z0-9+/]{43}=$/.test(r.checksumSHA256),'RESULT_HEAD');
    const ref={key,versionId:r.versionId,sha256:Buffer.from(r.checksumSHA256,'base64').toString('hex')};assertReferenceV6(ref,key);
    allowed.add(canonicalJson(ref));await p.record(name,ref);return ref;
  }
  return {
    deadline:p.deadline,guard,record:p.record,readRun,readObject,knownAck:()=>structuredClone(ack??null),
    async preflight(){await guard();await p.source.credentials();must(same(await p.keyMetadata(input.keyPath),m.key),'KEY_DRIFT');},
    async claim(){await guard();await p.claim();must(credentialLoads++===0,'READ_CREDENTIAL_ONCE');token=await p.loadReadCredential();
      must(typeof token==='string'&&token.length>0&&token.length<=16000&&!/[\r\n]/.test(token),'READ_CREDENTIAL');},
    async dispatch(plan){
      await guard();must(plan.mode==='Inspect'&&plan.sourceCommit===sourceCommit&&plan.jobId===job&&plan.inputs.manifestSha===mv&&
        plan.predecessor?.runId===input.runId&&posts===0&&!dispatchPlan,'EXACT_INSPECT');
      const expected=await validatePlan(plan,B.platform,p.now());dispatchPlan=structuredClone(plan);
      return controller.dispatch(dispatchPlan,async()=>{await guard();reserve();must(same(expected,await validatePlan(dispatchPlan,B.platform,p.now())),'FINAL_PLAN');},
        async value=>{ack=structuredClone(value);await p.record('dispatch-api-ack',ack);});
    },
    async discoverResult(id){
      await guard();must(id===ack?.runId&&heads++===0,'RESULT_HEAD_ONCE');return resultHead(id,'inspect-result-reference');
    },
    async discoverExecutionResult(id){
      await guard();must(followup&&id===input.runId&&!originalReference&&executionHeads++===0,'EXECUTION_HEAD_ONCE_OR_SCOPE');
      originalReference=await resultHead(id,'execution-result-reference');return structuredClone(originalReference);
    },
    async bundle(plan,runId,run,resultReference){return {schema:'techlong/platform-operator-bundle/v6',plan,runId,run,resultReference,objects:[...cache.values()],observedAt:p.now()};},
    async close(){
      if(closed)return;closed=true;token=undefined;await p.source.close();await p.dispose();
      await p.record('capability-counts',{...p.source.counts(),s3VersionedGets:gets,s3LatestHeads:heads+executionHeads,executionResultHeads:executionHeads,githubRunGets:runs,
        keyReads:keys,githubReadCredentialLoads:credentialLoads,appTokenIssues:issues,inspectDispatches:posts,appTokenRevocations:revokes,
        localSqlConnections:0,localSecretValueReads:0,platformLedgerWrites:0});
    },
  };
}
export async function livePorts(m,output,notify,{verify=verifyReview}={}){
  const now=Date.now,deadline=Math.min(now()+LIMITS.runMs,m.expiresAt),signal=AbortSignal.timeout(LIMITS.runMs);
  const record=async(name,value)=>{await writeOnce(path.join(output,name+'.json'),value);
    if(['awaiting-human-environment','awaiting-runonce-terminal'].includes(name))notify({stage:name,...value,deadlineUtc:new Date(value.deadline).toISOString(),
      deadlineLocal:new Intl.DateTimeFormat('en-CA',{timeZone:'America/Winnipeg',dateStyle:'full',timeStyle:'long'}).format(value.deadline)});};
  const guard=async()=>{must(now()<deadline,'ACTIVE_WINDOW_EXPIRED');signal.throwIfAborted();await verify(m,m.manifestSha256,now());
    await cleanSource(m.operatorSourceCommit);await evidenceRoot(m.input.evidenceRoot);};
  // Only reached by inspect-once after approval, source/pin checks and explicit human readiness.
  const req=createRequire(path.join(ROOT,'package.json')),{fromLoginCredentials}=req('@aws-sdk/credential-provider-login'),
    {STSClient,GetCallerIdentityCommand}=req('@aws-sdk/client-sts'),{S3Client,GetObjectCommand,HeadObjectCommand}=req('@aws-sdk/client-s3'),
    {NodeHttpHandler}=req('@smithy/node-http-handler');
  const logger={debug(){},info(){},warn(){},error(){}},handler=new NodeHttpHandler({connectionTimeout:5000,requestTimeout:20000});
  const sdk={region:E.region,maxAttempts:1,ignoreConfiguredEndpointUrls:true,logger,requestHandler:handler};
  const loader=fromLoginCredentials({profile:'techlong-sandbox-user',ignoreCache:true,logger,clientConfig:sdk});
  const source=createVerifiedCredentialPort({guard,deadline,expectedIdentity:SOURCE_IDENTITY,load:()=>loader({callerClientConfig:{...sdk,region:async()=>E.region}}),
    verifyIdentity:async credentials=>{
      const c=new STSClient({...sdk,requestHandler:new NodeHttpHandler({connectionTimeout:5000,requestTimeout:20000}),endpoint:'https://sts.ca-central-1.amazonaws.com',credentials});
      try{return await c.send(new GetCallerIdentityCommand({}),{abortSignal:AbortSignal.any([signal,AbortSignal.timeout(20000)])});}finally{c.destroy();}
    }});
  const s3=new S3Client({...sdk,endpoint:'https://s3.ca-central-1.amazonaws.com',credentials:source.credentials});
  let slotClaimed=false;const io=createInspectTransport(m,{guard,deadline,now,record,source,keyMetadata,readKey,
    async claim(){await guard();must(same(await sourcePins(),m.pins),'SOURCE_PINS');await guard();
      await writeOnce(path.join(m.input.evidenceRoot,intentName(m)),
        {manifestSha256:m.manifestSha256,jobId:m.input.plan.jobId,claimedAt:now(),retryAllowed:false});slotClaimed=true;},
    async loadReadCredential(){must(slotClaimed,'SLOT_REQUIRED');const raw=await git(['credential','fill'],`protocol=https\nhost=github.com\npath=${S.repository}.git\n\n`);
      return raw.split(/\r?\n/).find(v=>v.startsWith('password='))?.slice(9);},
    fetch:(url,options)=>fetch(url,{...options,signal:options.method==='DELETE'?options.signal:AbortSignal.any([signal,options.signal??AbortSignal.timeout(20000)])}),
    async getObject(ref){
      const r=await s3.send(new GetObjectCommand({Bucket:E.bucket,ExpectedBucketOwner:E.owner,Key:ref.key,VersionId:ref.versionId}),{abortSignal:AbortSignal.any([signal,AbortSignal.timeout(20000)])});
      must(r.Body&&r.ContentLength>0&&r.ContentLength<=1000000,'S3_BODY');
      return {value:await boundedJson({body:r.Body.transformToWebStream()},1000000),versionId:r.VersionId,encryption:r.ServerSideEncryption,contentLength:r.ContentLength};
    },
    async headObject(key){const r=await s3.send(new HeadObjectCommand({Bucket:E.bucket,ExpectedBucketOwner:E.owner,Key:key,ChecksumMode:'ENABLED'}),
      {abortSignal:AbortSignal.any([signal,AbortSignal.timeout(20000)])});
      return {versionId:r.VersionId,encryption:r.ServerSideEncryption,contentLength:r.ContentLength,checksumSHA256:r.ChecksumSHA256};},
    async dispose(){s3.destroy();handler.destroy();},
  });
  return io;
}
