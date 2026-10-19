import { STSClient,AssumeRoleWithWebIdentityCommand,GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { S3Client,GetObjectCommand,PutObjectCommand } from '@aws-sdk/client-s3';
import {createCloudApplicationV5} from '../cloud-worker/cloud-application-v5.mjs';
import {assertEvidenceSafeV5,EVIDENCE_V5} from '../cloud-worker/cloud-evidence-v5.mjs';
import {sha256Hex,canonicalJson} from '../../lib/deployments/execution/hash.ts';
import {CLOUD_V6 as C,S,must,obj,assertExact,releaseFromWorkflowV6,validateCloudRunV6,externalInputsV6,validateOidcClaimsV6,resultKeyV6} from './contract.mjs';

// Pure orchestration has injected ports so tests exercise the real mode bridge
// without credentials/network. Production ports below use explicit credentials.
export async function runPlatformCloudV6({env,binding,closure,ports}) {
  const run=validateCloudRunV6(env,binding,closure);
  const input=externalInputsV6(Object.fromEntries(['mode','job','installation','manifest','manifestSha','execution','lineage']
    .map(k=>[k,env['TECHLONG_INPUT_'+k.toUpperCase()]??''])));
  const installation=await ports.read(JSON.parse(input.installation));
  const links=input.lineage?await ports.read(JSON.parse(input.lineage)):[];
  let manifest=null,execution=null;
  if(input.mode!=='Review') {
    manifest=await ports.read(JSON.parse(input.manifest));
    must(manifest.jobPlan?.jobId===input.job && manifest.manifestSha256===input.manifestSha &&
      manifest.code?.commitSha===run.commitSha && manifest.code?.closureSha256===closure.closureSha256,'CONTROL_V6_MANIFEST_BINDING');
    if(input.mode==='Inspect') {
      execution=await ports.read(JSON.parse(input.execution));
      const previous=obj(execution.executionRun);
      assertExact(Object.keys(execution).sort(),['executionReportReference','executionRun'],'CONTROL_V6_EXECUTION_FIELDS');
      must(previous.repository===S.repository && previous.commitSha===run.commitSha && previous.runAttempt===1 &&
        previous.runId!==run.runId && /^[1-9][0-9]{0,15}$/.test(previous.runId) &&
        JSON.parse(input.execution).key.endsWith('/execution-reference-'+previous.runId+'-v1.json'),'CONTROL_V6_EXECUTION_RUN');
    }
  }
  const app=await ports.open({installation,links,run,code:{commitSha:run.commitSha,closureSha256:closure.closureSha256},
    approvedInstallationSha256:C.installationSha256});
  try {
    let result,manifestSha256,outcome;
    if(input.mode==='Review') {
      result=await app.review({jobId:input.job,signal:ports.signal});manifestSha256=result.manifest.manifestSha256;
      must(result.manifest.jobPlan?.jobId===input.job,'CONTROL_V6_REVIEW_JOB');outcome='REVIEW_PREPARED_NOT_APPROVED';
    } else {
      result=input.mode==='RunOnce'?await app.runOnce({manifest,approvedManifestSha256:input.manifestSha,signal:ports.signal}):
        await app.inspect({manifest,...execution,signal:ports.signal});
      manifestSha256=input.manifestSha;outcome=result.report.outcome??result.report.result?.outcome;
    }
    const executionReference=input.mode==='RunOnce'?await ports.writeExecution(
      `worker-v5/${S.instanceId}/${input.job}/${manifestSha256}/execution-reference-${run.runId}-v1.json`,
      {executionRun:run,executionReportReference:result.saved}):null;
    const proof={schema:'techlong/platform-cloud-result/v6',mode:input.mode,jobId:input.job,run,
      frozenSourceCommit:binding.sourceCommit,closureSha256:closure.closureSha256,identityProofSha256:binding.identityProofSha256,
      installationSha256:C.installationSha256,requestSha256:await sha256Hex(input),manifestSha256,outcome,
      cloudReportReference:result.saved,executionReference,retryAllowed:false};
    assertEvidenceSafeV5(proof);
    const saved=await ports.writeResult(resultKeyV6(input.job,manifestSha256,run.runId),proof);
    return {mode:input.mode,jobId:input.job,manifestSha256,outcome,saved,retryAllowed:false};
  } finally {app.dispose();}
}
async function boundedJson(response,limit,code) {
  must(response.body,code);const reader=response.body.getReader(),parts=[];let size=0;
  try {for(;;){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;
    if(size>limit){await reader.cancel();must(false,code);}parts.push(r.value);}}finally{reader.releaseLock();}
  const all=new Uint8Array(size);let at=0;for(const p of parts){all.set(p,at);at+=p.length;}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(all));
}
export async function platformRuntimeV6(env,closure) {
  const binding=releaseFromWorkflowV6(env);validateCloudRunV6(env,binding,closure);
  externalInputsV6(Object.fromEntries(['mode','job','installation','manifest','manifestSha','execution','lineage'].map(k=>[k,env['TECHLONG_INPUT_'+k.toUpperCase()]??''])));
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
    s3=new S3Client({...cfg,credentials});const signal=AbortSignal.timeout(3600000);
    const put=async(key,value)=>{
      const Body=canonicalJson(value),sha256=await sha256Hex(value);assertEvidenceSafeV5(value);
      const r=await s3.send(new PutObjectCommand({Bucket:EVIDENCE_V5.bucket,ExpectedBucketOwner:EVIDENCE_V5.owner,Key:key,Body,
        IfNoneMatch:'*',ServerSideEncryption:'AES256',ContentType:'application/json',ChecksumSHA256:Buffer.from(sha256,'hex').toString('base64')}),
      {abortSignal:AbortSignal.any([signal,AbortSignal.timeout(30000)])});
      must(r.VersionId && r.ServerSideEncryption==='AES256','CONTROL_V6_RESULT_ACK');return {key,versionId:r.VersionId,sha256};
    };
    return await runPlatformCloudV6({env,binding,closure,ports:{signal,
      async read(reference) {
        const r=await s3.send(new GetObjectCommand({Bucket:EVIDENCE_V5.bucket,ExpectedBucketOwner:EVIDENCE_V5.owner,Key:reference.key,
          VersionId:reference.versionId}),{abortSignal:AbortSignal.any([signal,AbortSignal.timeout(30000)])});
        must(r.VersionId===reference.versionId && r.ServerSideEncryption==='AES256' && r.ContentLength>0 && r.ContentLength<=1000000,'CONTROL_V6_S3_METADATA');
        const value=await boundedJson({body:r.Body.transformToWebStream()},1000000,'CONTROL_V6_S3_SIZE');assertEvidenceSafeV5(value);
        must(await sha256Hex(value)===reference.sha256,'CONTROL_V6_S3_DIGEST');return value;
      },
      async open(options) {
        // Capsule is public, source-pinned and reconstructed by the existing core.
        const {readFile}=await import('node:fs/promises');
        const capsule=JSON.parse(await readFile(new URL('../cloud-worker/material/public-capsule-v5.json',import.meta.url),'utf8'));
        return createCloudApplicationV5({...options,capsule,credentials:async()=>credentials});
      },
      writeResult:put,writeExecution:put,
    }});
  } finally {authSts?.destroy();s3?.destroy();sts.destroy();}
}
