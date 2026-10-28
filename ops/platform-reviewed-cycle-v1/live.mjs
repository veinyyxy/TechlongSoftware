// No new executor: the frozen application owns DB Secret/claim/provider/Inspect.
// This transport accepts only a reviewed SOURCE descriptor, never env JSON.
import {STSClient,AssumeRoleWithWebIdentityCommand,GetCallerIdentityCommand} from '@aws-sdk/client-sts';
import {S3Client,GetObjectCommand,PutObjectCommand} from '@aws-sdk/client-s3';
import {createRecoveryApplication} from '../platform-recovery-cloud-v1/application.mjs';
import {CLOUD_V6 as C,releaseFromWorkflowV6,validateOidcClaimsV6} from '../platform-cloud-v6/contract.mjs';
import {EVIDENCE_V5 as E,assertEvidenceSafeV5} from '../cloud-worker/cloud-evidence-v5.mjs';
import {sha256Hex,canonicalJson} from '../../lib/deployments/execution/hash.ts';
import {createReviewedCycle,bindWorkflowSource,must,same} from './cycle.mjs';
import {createCycleRuntime} from './cloud.mjs';
import {SELECTED_CYCLE} from './selection.mjs';
async function boundedJson(response,max){
  must(response.body,'RESPONSE_BODY');const reader=response.body.getReader(),chunks=[];let n=0;
  try{for(;;){const r=await reader.read();if(r.done)break;n+=r.value.length;must(n<=max,'RESPONSE_SIZE');chunks.push(r.value);}}finally{reader.releaseLock();}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,n)));
}
export async function runCycleLive(env,closure,{source=SELECTED_CYCLE}={}){
  // Gate before credentials/OIDC/metadata/private operations, including default.
  must(source,'SOURCE_NOT_CONFIGURED');
  const bound=await bindWorkflowSource(source,env.GITHUB_SHA,env.TECHLONG_REUSABLE_COMMIT),cycle=await createReviewedCycle(bound),
    runtime=createCycleRuntime({cycle,publication:bound.publication}),p=await runtime.guard();await runtime.input(env,closure);
  const b=releaseFromWorkflowV6(env);must(same(b,{state:'PUBLISHED',sourceCommit:p.frozenSourceCommit,reusableCommit:p.release.reusableCommit,
    closureSha256:p.release.closureSha256,identityProofSha256:p.release.identityProofSha256,actorId:p.release.actorId,installationSha256:p.release.installationSha256}),'WORKFLOW_RELEASE');
  const endpoint=new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL);must(endpoint.protocol==='https:'&&endpoint.hostname.endsWith('.actions.githubusercontent.com')&&
    !endpoint.username&&!endpoint.password&&typeof env.ACTIONS_ID_TOKEN_REQUEST_TOKEN==='string'&&env.ACTIONS_ID_TOKEN_REQUEST_TOKEN.length>0,'OIDC_ENDPOINT');
  endpoint.searchParams.set('audience','sts.amazonaws.com');const response=await fetch(endpoint,{headers:{authorization:'Bearer '+env.ACTIONS_ID_TOKEN_REQUEST_TOKEN},redirect:'error',signal:AbortSignal.timeout(15000)});
  must(response.status===200,'OIDC_RESPONSE');const oidc=await boundedJson(response,20000);
  must(typeof oidc.value==='string'&&oidc.value.length<15000&&oidc.value.split('.').length===3,'OIDC_TOKEN');
  validateOidcClaimsV6(JSON.parse(Buffer.from(oidc.value.split('.')[1],'base64url').toString('utf8')),env,b,Date.now());
  const cfg={region:C.region,maxAttempts:1,ignoreConfiguredEndpointUrls:true},sts=new STSClient(cfg);let authSts,s3;
  try{
    const r=await sts.send(new AssumeRoleWithWebIdentityCommand({RoleArn:C.roleArn,RoleSessionName:`Deploy-${env.GITHUB_RUN_ID}-1`,WebIdentityToken:oidc.value,DurationSeconds:3600}),{abortSignal:AbortSignal.timeout(30000)}),v=r.Credentials;
    must(v?.AccessKeyId&&v.SecretAccessKey&&v.SessionToken&&v.Expiration?.getTime()>Date.now()+60000,'TEMPORARY_CREDENTIALS');
    const credentials={accessKeyId:v.AccessKeyId,secretAccessKey:v.SecretAccessKey,sessionToken:v.SessionToken,expiration:v.Expiration};
    authSts=new STSClient({...cfg,credentials});const id=await authSts.send(new GetCallerIdentityCommand({}),{abortSignal:AbortSignal.timeout(30000)});
    must(id.Account===E.owner&&id.UserId===C.roleId+`:Deploy-${env.GITHUB_RUN_ID}-1`&&
      id.Arn===`arn:aws:sts::${E.owner}:assumed-role/TechlongSandboxGitHubDeploymentWorkerRole/Deploy-${env.GITHUB_RUN_ID}-1`,'ROLE_ID');
    s3=new S3Client({...cfg,credentials});const signal=AbortSignal.timeout(3600000);
    return await runtime.run({env,closure,ports:{signal,open:options=>createRecoveryApplication({...options,credentials:async()=>credentials}),
      async read(ref){const r=await s3.send(new GetObjectCommand({Bucket:E.bucket,ExpectedBucketOwner:E.owner,Key:ref.key,VersionId:ref.versionId}),{abortSignal:AbortSignal.any([signal,AbortSignal.timeout(30000)])});
        must(r.VersionId===ref.versionId&&r.ServerSideEncryption==='AES256'&&r.ContentLength>0&&r.ContentLength<=1000000,'S3_METADATA');
        const value=await boundedJson({body:r.Body.transformToWebStream()},1000000);assertEvidenceSafeV5(value);must(await sha256Hex(value)===ref.sha256,'S3_HASH');return value;},
      async put(key,value){assertEvidenceSafeV5(value);const Body=canonicalJson(value),sha256=await sha256Hex(value);must(Buffer.byteLength(Body)<=1000000,'PUT_SIZE');
        const r=await s3.send(new PutObjectCommand({Bucket:E.bucket,ExpectedBucketOwner:E.owner,Key:key,Body,IfNoneMatch:'*',ServerSideEncryption:'AES256',ContentType:'application/json',
          ChecksumSHA256:Buffer.from(sha256,'hex').toString('base64')}),{abortSignal:AbortSignal.any([signal,AbortSignal.timeout(30000)])});
        must(r.VersionId&&r.ServerSideEncryption==='AES256','PUT_ACK');return {key,versionId:r.VersionId,sha256};}
    }});
  }finally{authSts?.destroy();s3?.destroy();sts.destroy();}
}
