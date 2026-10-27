// Exact endpoints/RPCs only. No browser session or GitHub approval endpoint exists.
import pg from 'pg';
import {createHash} from 'node:crypto';
import {fromLoginCredentials} from '@aws-sdk/credential-provider-login';
import {STSClient,GetCallerIdentityCommand} from '@aws-sdk/client-sts';
import {S3Client,PutObjectCommand} from '@aws-sdk/client-s3';
import {IAMClient,SimulatePrincipalPolicyCommand} from '@aws-sdk/client-iam';
import {createGitHubController} from '../../lib/deployments/controller-v6/github.ts';
import {readAuthV6} from '../platform-local-v6/local.mjs';
import {keyMetadata,readKey} from '../platform-operator-v6/files.mjs';
import {publisherDatabaseConfigV6,createPublisherDatabaseV6,DATABASE_V6} from '../platform-publisher-v6/io.mjs';
import {ownerQueryV6} from '../platform-cloud-v6/publisher.mjs';
import {sqlContract,I} from '../platform-controller-review-v6/install.mjs';
import {EVIDENCE_V5 as E,assertEvidenceSafeV5} from '../cloud-worker/cloud-evidence-v5.mjs';
import {P} from '../platform-recovery-hosting-v1/plan.mjs';
import {ROOT,readText,git} from '../platform-image-source-v2/files.mjs';
import {D,S,must,same,environmentProof,auditKey} from './policy.mjs';
const rpc={begin:'SELECT deployment_control_v6.begin_dispatch($1,$2,$3,$4)',live:'SELECT deployment_control_v6.assert_live($1)',
  ack:'SELECT deployment_control_v6.acknowledge($1,$2)',unknown:'SELECT deployment_control_v6.mark_unknown($1)'};
export function verifyAuditPermission(response,grantSha,mode,keyFor=auditKey){const row=response.EvaluationResults?.[0],resource=`arn:aws:s3:::${E.bucket}/${keyFor(grantSha,mode)}`;
  must(!response.IsTruncated&&response.EvaluationResults?.length===1&&row.EvalActionName==='s3:PutObject'&&row.EvalResourceName===resource&&
    row.EvalDecision==='allowed'&&!(row.MissingContextValues??[]).length,'AUDIT_PERMISSION_NOT_PROVED');}
export async function readEnvironment(){let raw=git(['credential','fill'],'protocol=https\nhost=github.com\npath='+S.repository+'.git\n\n');
  let token=raw.split(/\r?\n/).find(v=>v.startsWith('password='))?.slice(9);raw=undefined;must(token,'GITHUB_READ_AUTH');
  try{const r=await fetch(`https://api.github.com/repos/${S.repository}/environments/${D.environment}`,{redirect:'error',signal:AbortSignal.timeout(20000),
    headers:{authorization:'Bearer '+token,accept:'application/vnd.github+json'}});must(r.status===200,'ENVIRONMENT_READ');
    const text=await r.text();must(text.length<=256000,'ENVIRONMENT_SIZE');return environmentProof(JSON.parse(text));}finally{token=undefined;}}
export function appFetchGuard({guard,fetcher=fetch,counts,beforeDispatch=async()=>{}}){
  const gets=new Set(['/app',`/app/installations/${S.installationId}`,'/installation/repositories','/users/techlong-sandbox-controller%5Bbot%5D',
    `/repos/${S.repository}/git/ref/heads/main`,`/repos/${S.repository}/actions/workflows/${S.workflowFile}`]);
  return async(url,options)=>{const u=new URL(url),method=options.method??'GET';
    must(u.origin==='https://api.github.com'&&!u.search&&!u.hash&&options.redirect==='manual','APP_ENDPOINT');
    if(method!=='DELETE')await guard();must(++counts.appHttp<=10,'APP_HTTP_BUDGET');
    if(method==='GET')must(gets.has(u.pathname),'APP_GET_SCOPE');
    else if(method==='POST'&&u.pathname===`/app/installations/${S.installationId}/access_tokens`)must(++counts.tokens===1,'TOKEN_ONCE');
    else if(method==='POST'){must(u.pathname===`/repos/${S.repository}/actions/workflows/${S.workflowFile}/dispatches`&&++counts.dispatches===1,'DISPATCH_ONCE');await beforeDispatch();}
    else must(method==='DELETE'&&u.pathname==='/installation/token'&&++counts.revokes===1,'REVOKE_ONLY');
    return fetcher(url,options);
  };
}
export function createIo({grant:g,mode,planSha256,record,claim,guard,verifyCi,capability}){
  const target=capability?.definition??D,keyFor=capability?.auditKey??auditKey;
  must(target.environment===D.environment&&target.admin===D.admin&&target.keyPath===D.keyPath,'SOURCE_CAPABILITY_SCOPE');
  let sts,s3,iam,credentials,writer,reader,publisher,halted=false,opened=false,auditPersisted=false,beginSucceeded=false;const clients=[];
  const counts={sts:0,auditPermissionSimulations:0,auditPuts:0,configReads:0,connections:0,queries:0,keyReads:0,seedPuts:0,begin:0,live:0,ack:0,unknown:0,
    appHttp:0,tokens:0,dispatches:0,revokes:0,environmentReads:0,githubEnvironmentApprovals:0};
  const assertOpen=()=>must(!halted,'CLOSED');
  async function query(c,text,values,readOnly){assertOpen();must(++counts.queries<=100,'SQL_BUDGET');await guard();
    const mutation=Object.values(rpc).includes(text)||text===ownerQueryV6('plan',{planSha256:'',actionSha256:'',plan:{riskSha256:''}}).text;
    if(/^SELECT deployment_control_v6\./.test(text))must(mutation||['SELECT deployment_control_v6.load_plan($1) AS value','SELECT deployment_control_v6.status() AS value'].includes(text),'RPC_SCOPE');
    must(!readOnly||!mutation,'READER_WRITE');
    must(mutation||/^SELECT\b/.test(text)||['BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY','SET LOCAL search_path=pg_catalog','COMMIT','ROLLBACK'].includes(text),'SQL_SCOPE');
    try{return await c.query(text,values);}catch{halted=true;throw Error('DELEGATED_APPROVAL_SQL_REQUIRES_READBACK');}}
  const q=(text,values)=>query(writer,text,values,false);
  const app=createGitHubController({release:g.binding.release,privateKey:async()=>{
    await guard();must(beginSucceeded&&counts.keyReads++===0,'KEY_AFTER_LEDGER_ONCE');return readKey(target.keyPath,g.key);
  },fetch:appFetchGuard({guard,counts,beforeDispatch:async()=>{must(++counts.environmentReads<=2,'ENVIRONMENT_BUDGET');
    must(same(await readEnvironment(),g.environment),'ENVIRONMENT_DRIFT');}})});
  return {record,claim,assertSource:guard,verifyCi,environment:async()=>{must(++counts.environmentReads<=2,'ENVIRONMENT_BUDGET');return readEnvironment();},
    async preflight(){await guard();must(!opened,'OPEN_ONCE');opened=true;
      must(same(await keyMetadata(target.keyPath),g.key),'KEY_METADATA_DRIFT');
      credentials=await fromLoginCredentials({profile:P.profile,ignoreCache:true})();
      must(credentials.expiration instanceof Date&&credentials.expiration.getTime()>Date.now()+180000,'SOURCE_EXPIRY');
      const sdk={region:P.region,credentials,maxAttempts:1,ignoreConfiguredEndpointUrls:true};
      sts=new STSClient({...sdk,endpoint:'https://sts.ca-central-1.amazonaws.com'});counts.sts++;
      const id=await sts.send(new GetCallerIdentityCommand({}),{abortSignal:AbortSignal.timeout(20000)});
      must(id.Account===P.account&&id.Arn===P.sourceArn&&id.UserId===P.sourceId,'SOURCE_IDENTITY');
      iam=new IAMClient({...sdk,region:'us-east-1',endpoint:'https://iam.amazonaws.com'});counts.auditPermissionSimulations++;
      const permission=await iam.send(new SimulatePrincipalPolicyCommand({PolicySourceArn:P.sourceArn,ActionNames:['s3:PutObject'],
        ResourceArns:[`arn:aws:s3:::${E.bucket}/${keyFor(g.grantSha256,mode)}`],ContextEntries:[
          {ContextKeyName:'aws:RequestedRegion',ContextKeyValues:[P.region],ContextKeyType:'string'},
          {ContextKeyName:'aws:SecureTransport',ContextKeyValues:['true'],ContextKeyType:'boolean'},
          {ContextKeyName:'s3:x-amz-server-side-encryption',ContextKeyValues:['AES256'],ContextKeyType:'string'},
          {ContextKeyName:'s3:if-none-match',ContextKeyValues:['*'],ContextKeyType:'string'}]}),{abortSignal:AbortSignal.timeout(20000)});
      verifyAuditPermission(permission,g.grantSha256,mode,keyFor);
      s3=new S3Client({...sdk,endpoint:'https://s3.ca-central-1.amazonaws.com'});
      counts.configReads++;let url=await readAuthV6(g.auth),config={...await publisherDatabaseConfigV6(url),application_name:'Techlong-Delegated-Web-Approval-V1'};url=undefined;
      for(const role of ['writer','reader']){const c=new pg.Client(config);clients.push(c);c.on('error',()=>{halted=true;});counts.connections++;
        await c.connect();must(c.connection.stream.encrypted===true&&c.connection.stream.authorized===true,'TLS');if(role==='writer')writer=c;else reader=c;}
      config=undefined;const contract=sqlContract((await readText(ROOT+'/'+I.sql,3000000)).replaceAll('\r\n','\n'));
      publisher=createPublisherDatabaseV6({client:{query:q},expected:DATABASE_V6,contract,release:g.binding.release,maxWrites:1});await publisher.verify();
      const readVerify=createPublisherDatabaseV6({client:{query:(t,v)=>query(reader,t,v,true)},expected:DATABASE_V6,contract,release:g.binding.release,maxWrites:1});await readVerify.verify();
      if(capability?.verifyPreflight)await capability.verifyPreflight({client:{query:(t,v)=>query(reader,t,v,true)},contract});},
    async loadPlan(sha){must(/^[a-f0-9]{64}$/.test(sha),'PLAN_SHA');const r=await query(reader,'SELECT deployment_control_v6.load_plan($1) AS value',[sha],true);
      must(r.rows?.length===1,'LOAD_ROWS');return r.rows[0].value??null;},
    async status(){const r=await query(reader,'SELECT deployment_control_v6.status() AS value',[],true);must(r.rows?.length===1,'STATUS_ROWS');return r.rows[0].value;},
    async persistAudit(key,value){await guard();must(s3&&key===keyFor(g.grantSha256,mode)&&counts.auditPuts++===0,'AUDIT_ONCE');assertEvidenceSafeV5(value);
      const body=Buffer.from(JSON.stringify(value,null,2)+'\n');must(body.length<=1000000,'AUDIT_SIZE');
      const r=await s3.send(new PutObjectCommand({Bucket:E.bucket,ExpectedBucketOwner:E.owner,Key:key,Body:body,IfNoneMatch:'*',
        ServerSideEncryption:'AES256',ContentType:'application/json',ChecksumSHA256:createHash('sha256').update(body).digest('base64')}),{abortSignal:AbortSignal.timeout(30000)});
      must(typeof r.VersionId==='string'&&r.VersionId.length>0,'AUDIT_ACK_REQUIRES_READBACK');await record('audit-put-ack',{key,versionId:r.VersionId});auditPersisted=true;},
    async publishSeed(v){must(mode==='Review'&&auditPersisted&&counts.seedPuts++===0&&same(v,g.seed),'SEED_ONCE');
      await publisher.writeOwner(ownerQueryV6('plan',v));},
    async begin(v,admin){must(auditPersisted&&counts.begin++===0&&v.planSha256===planSha256&&admin===target.admin,'BEGIN_ONCE');
      await q(rpc.begin,[v.planSha256,v.actionSha256,v.plan.riskSha256,target.admin]);beginSucceeded=true;},
    async assertLive(sha){must(sha===planSha256&&counts.live++===0,'LIVE_ONCE');await q(rpc.live,[sha]);},
    async acknowledge(sha,ack){must(sha===planSha256&&counts.ack++===0&&/^[1-9][0-9]{0,15}$/.test(ack.runId),'ACK_ONCE');await q(rpc.ack,[sha,ack.runId]);},
    async markUnknown(sha){must(sha===planSha256&&counts.begin===1&&counts.unknown++===0,'UNKNOWN_ONCE');await q(rpc.unknown,[sha]);},
    dispatch:(plan,before,onAck)=>app.dispatch(plan,before,onAck),
    async close(){halted=true;for(const c of clients)try{await c.end();}catch{/* no reconnect */}sts?.destroy();s3?.destroy();iam?.destroy();credentials=undefined;
      await record('io-counts',{...counts,webLogins:0,githubProtectionWrites:0,automaticRetries:0});},
  };
}
