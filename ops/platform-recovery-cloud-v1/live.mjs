// Explicit GitHub OIDC -> fixed STS role -> fixed-version S3. No local credentials.
import {STSClient,AssumeRoleWithWebIdentityCommand,GetCallerIdentityCommand} from '@aws-sdk/client-sts';
import {S3Client,GetObjectCommand,PutObjectCommand} from '@aws-sdk/client-s3';
import {assertEvidenceSafeV5,EVIDENCE_V5} from '../cloud-worker/cloud-evidence-v5.mjs';
import {sha256Hex,canonicalJson} from '../../lib/deployments/execution/hash.ts';
import {CLOUD_V6 as C,must,releaseFromWorkflowV6,validateCloudRunV6,validateOidcClaimsV6} from '../platform-cloud-v6/contract.mjs';
import {runRecoveryCloud,recoveryCloudInput} from './runtime.mjs';
import {createRecoveryApplication} from './application.mjs';
async function boundedJson(response,limit,code) {
  must(response.body,code);const reader=response.body.getReader(),parts=[];let size=0;
  try {for(;;){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;
    if(size>limit){await reader.cancel();must(false,code);}parts.push(r.value);}}finally{reader.releaseLock();}
  const all=new Uint8Array(size);let at=0;for(const p of parts){all.set(p,at);at+=p.length;}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(all));
}
export async function recoveryRuntime(env,closure) {
  const binding=releaseFromWorkflowV6(env);validateCloudRunV6(env,binding,closure);
  recoveryCloudInput(env,binding,closure);
  const endpoint=new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL);
  must(endpoint.protocol==='https:' && endpoint.hostname.endsWith('.actions.githubusercontent.com') && !endpoint.username && !endpoint.password &&
    typeof env.ACTIONS_ID_TOKEN_REQUEST_TOKEN==='string' && env.ACTIONS_ID_TOKEN_REQUEST_TOKEN.length>0,'CONTROL_V6_OIDC_ENDPOINT');
  endpoint.searchParams.set('audience','sts.amazonaws.com');
  const response=await fetch(endpoint,{headers:{authorization:'Bearer '+env.ACTIONS_ID_TOKEN_REQUEST_TOKEN},redirect:'error',signal:AbortSignal.timeout(15000)});
  must(response.status===200,'CONTROL_V6_OIDC_RESPONSE');const oidc=await boundedJson(response,20000,'CONTROL_V6_OIDC_SIZE');
  must(typeof oidc.value==='string' && oidc.value.length<15000 && oidc.value.split('.').length===3,'CONTROL_V6_OIDC_TOKEN');
  validateOidcClaimsV6(JSON.parse(Buffer.from(oidc.value.split('.')[1],'base64url').toString('utf8')),env,binding,Date.now());
  const cfg={region:C.region,maxAttempts:1,ignoreConfiguredEndpointUrls:true},sts=new STSClient(cfg);let s3,authSts;
  try {
    const r=await sts.send(new AssumeRoleWithWebIdentityCommand({RoleArn:C.roleArn,RoleSessionName:`Deploy-${env.GITHUB_RUN_ID}-1`,
      WebIdentityToken:oidc.value,DurationSeconds:3600}),{abortSignal:AbortSignal.timeout(30000)});
    const c=r.Credentials;must(c?.AccessKeyId && c.SecretAccessKey && c.SessionToken && c.Expiration?.getTime()>Date.now()+60000,'CONTROL_V6_STS');
    const credentials={accessKeyId:c.AccessKeyId,secretAccessKey:c.SecretAccessKey,sessionToken:c.SessionToken,expiration:c.Expiration};
    authSts=new STSClient({...cfg,credentials});
    const who=await authSts.send(new GetCallerIdentityCommand({}),{abortSignal:AbortSignal.timeout(30000)});
    must(who.Account==='402010193138' && who.UserId===C.roleId+`:Deploy-${env.GITHUB_RUN_ID}-1` &&
      who.Arn===`arn:aws:sts::402010193138:assumed-role/TechlongSandboxGitHubDeploymentWorkerRole/Deploy-${env.GITHUB_RUN_ID}-1`,'CONTROL_V6_ROLE_ID');
    s3=new S3Client({...cfg,credentials});const signal=AbortSignal.timeout(3600000);let objectReads=0,outerPuts=0;
    const put=async(key,value)=>{
      const Body=canonicalJson(value),sha256=await sha256Hex(value);assertEvidenceSafeV5(value);
      must(++outerPuts<=2&&Buffer.byteLength(Body)<=1000000,'RECOVERY_OUTER_PUT_BUDGET');
      const r=await s3.send(new PutObjectCommand({Bucket:EVIDENCE_V5.bucket,ExpectedBucketOwner:EVIDENCE_V5.owner,Key:key,Body,
        IfNoneMatch:'*',ServerSideEncryption:'AES256',ContentType:'application/json',ChecksumSHA256:Buffer.from(sha256,'hex').toString('base64')}),
      {abortSignal:AbortSignal.any([signal,AbortSignal.timeout(30000)])});
      must(r.VersionId && r.ServerSideEncryption==='AES256','CONTROL_V6_RESULT_ACK');return {key,versionId:r.VersionId,sha256};
    };
    return await runRecoveryCloud({env,binding,closure,ports:{signal,
      async read(reference) {
        must(++objectReads<=4,'RECOVERY_OBJECT_READ_BUDGET');
        const r=await s3.send(new GetObjectCommand({Bucket:EVIDENCE_V5.bucket,ExpectedBucketOwner:EVIDENCE_V5.owner,Key:reference.key,
          VersionId:reference.versionId}),{abortSignal:AbortSignal.any([signal,AbortSignal.timeout(30000)])});
        must(r.VersionId===reference.versionId && r.ServerSideEncryption==='AES256' && r.ContentLength>0 && r.ContentLength<=1000000,'CONTROL_V6_S3_METADATA');
        const value=await boundedJson({body:r.Body.transformToWebStream()},1000000,'CONTROL_V6_S3_SIZE');assertEvidenceSafeV5(value);
        must(await sha256Hex(value)===reference.sha256,'CONTROL_V6_S3_DIGEST');return value;
      },
      async open(options) {
        return createRecoveryApplication({...options,credentials:async()=>credentials});
      },
      put,
    }});
  } finally {authSts?.destroy();s3?.destroy();sts.destroy();}
}
