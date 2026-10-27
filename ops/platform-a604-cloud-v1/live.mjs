// Lazy OIDC adapter. A source UNPUBLISHED gate runs before every credential port.
import {STSClient,AssumeRoleWithWebIdentityCommand,GetCallerIdentityCommand} from '@aws-sdk/client-sts';
import {S3Client,GetObjectCommand,PutObjectCommand} from '@aws-sdk/client-s3';
import {assertEvidenceSafeV5,EVIDENCE_V5} from '../cloud-worker/cloud-evidence-v5.mjs';
import {sha256Hex,canonicalJson} from '../../lib/deployments/execution/hash.ts';
import {CLOUD_V6 as C,releaseFromWorkflowV6,validateOidcClaimsV6} from '../platform-cloud-v6/contract.mjs';
import {createRecoveryApplication} from '../platform-recovery-cloud-v1/application.mjs';
import {createA604Runtime} from './runtime.mjs';
import {A604_PUBLICATION} from './profile.mjs';
import {must,same} from './contract.mjs';
async function boundedJson(response,limit){
  must(response.body,'RESPONSE_BODY');const reader=response.body.getReader(),parts=[];let size=0;
  try{for(;;){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;
    if(size>limit){await reader.cancel();must(false,'RESPONSE_SIZE');}parts.push(r.value);}}finally{reader.releaseLock();}
  const all=new Uint8Array(size);let at=0;for(const p of parts){all.set(p,at);at+=p.length;}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(all));
}
export async function a604Runtime(env,closure,{publication=A604_PUBLICATION}={}){
  // This option is supplied only by reviewed workflow bootstrap SOURCE. There
  // is deliberately no JSON/env/CLI deserialization for a publication.
  const runtime=createA604Runtime({publication}),p=await runtime.guard();await runtime.input(env,closure);
  const b=releaseFromWorkflowV6(env);
  must(same(b,{state:'PUBLISHED',sourceCommit:p.frozenSourceCommit,reusableCommit:p.release.reusableCommit,
    closureSha256:p.release.closureSha256,identityProofSha256:p.release.identityProofSha256,
    actorId:p.release.actorId,installationSha256:p.release.installationSha256}),'WORKFLOW_RELEASE');
  const endpoint=new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL);
  must(endpoint.protocol==='https:'&&endpoint.hostname.endsWith('.actions.githubusercontent.com')&&!endpoint.username&&!endpoint.password&&
    typeof env.ACTIONS_ID_TOKEN_REQUEST_TOKEN==='string'&&env.ACTIONS_ID_TOKEN_REQUEST_TOKEN.length>0,'OIDC_ENDPOINT');
  endpoint.searchParams.set('audience','sts.amazonaws.com');
  const response=await fetch(endpoint,{headers:{authorization:'Bearer '+env.ACTIONS_ID_TOKEN_REQUEST_TOKEN},redirect:'error',signal:AbortSignal.timeout(15000)});
  must(response.status===200,'OIDC_RESPONSE');const oidc=await boundedJson(response,20000);
  must(typeof oidc.value==='string'&&oidc.value.length<15000&&oidc.value.split('.').length===3,'OIDC_TOKEN');
  validateOidcClaimsV6(JSON.parse(Buffer.from(oidc.value.split('.')[1],'base64url').toString('utf8')),env,b,Date.now());
  const cfg={region:C.region,maxAttempts:1,ignoreConfiguredEndpointUrls:true},sts=new STSClient(cfg);let s3,authSts;
  try{
    const r=await sts.send(new AssumeRoleWithWebIdentityCommand({RoleArn:C.roleArn,RoleSessionName:`Deploy-${env.GITHUB_RUN_ID}-1`,
      WebIdentityToken:oidc.value,DurationSeconds:3600}),{abortSignal:AbortSignal.timeout(30000)});
    const c=r.Credentials;must(c?.AccessKeyId&&c.SecretAccessKey&&c.SessionToken&&c.Expiration?.getTime()>Date.now()+60000,'STS');
    const credentials={accessKeyId:c.AccessKeyId,secretAccessKey:c.SecretAccessKey,sessionToken:c.SessionToken,expiration:c.Expiration};
    authSts=new STSClient({...cfg,credentials});
    const who=await authSts.send(new GetCallerIdentityCommand({}),{abortSignal:AbortSignal.timeout(30000)});
    must(who.Account==='402010193138'&&who.UserId===C.roleId+`:Deploy-${env.GITHUB_RUN_ID}-1`&&
      who.Arn===`arn:aws:sts::402010193138:assumed-role/TechlongSandboxGitHubDeploymentWorkerRole/Deploy-${env.GITHUB_RUN_ID}-1`,'ROLE_ID');
    s3=new S3Client({...cfg,credentials});const signal=AbortSignal.timeout(3600000);let reads=0,puts=0;
    return await runtime.run({env,closure,ports:{signal,
      async read(ref){must(++reads<=4,'S3_READ_BUDGET');const r=await s3.send(new GetObjectCommand({Bucket:EVIDENCE_V5.bucket,
        ExpectedBucketOwner:EVIDENCE_V5.owner,Key:ref.key,VersionId:ref.versionId}),{abortSignal:AbortSignal.any([signal,AbortSignal.timeout(30000)])});
        must(r.VersionId===ref.versionId&&r.ServerSideEncryption==='AES256'&&r.ContentLength>0&&r.ContentLength<=1000000,'S3_METADATA');
        const value=await boundedJson({body:r.Body.transformToWebStream()},1000000);assertEvidenceSafeV5(value);
        must(await sha256Hex(value)===ref.sha256,'S3_HASH');return value;},
      open:options=>createRecoveryApplication({...options,credentials:async()=>credentials}),
      async put(key,value){const Body=canonicalJson(value),sha256=await sha256Hex(value);assertEvidenceSafeV5(value);
        must(++puts<=2&&Buffer.byteLength(Body)<=1000000,'S3_PUT_BUDGET');
        const r=await s3.send(new PutObjectCommand({Bucket:EVIDENCE_V5.bucket,ExpectedBucketOwner:EVIDENCE_V5.owner,Key:key,Body,
          IfNoneMatch:'*',ServerSideEncryption:'AES256',ContentType:'application/json',ChecksumSHA256:Buffer.from(sha256,'hex').toString('base64')}),
        {abortSignal:AbortSignal.any([signal,AbortSignal.timeout(30000)])});
        must(r.VersionId&&r.ServerSideEncryption==='AES256','PUT_ACK');return {key,versionId:r.VersionId,sha256};}
    }});
  }finally{authSts?.destroy();s3?.destroy();sts.destroy();}
}
