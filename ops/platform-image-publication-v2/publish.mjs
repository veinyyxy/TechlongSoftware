// Only invoked by the protected, immutable reusable job after future approval.
import {P,must,validateReview,validateCloud,validateClaims,same,publicationProtocol} from './plan.mjs';
import {readFile,mkdtemp,unlink,rmdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {inspect,save,fileHash} from './artifact.mjs';

export function verifyPreflight(p,now=Date.now(),candidate=P){
  const P=candidate;
  must(p?.schema==='techlong/platform-publication-preflight/v2'&&p.outcome==='OS_HIGH_CRITICAL_ZERO'&&
    p.sourceCommit===P.sourceCommit&&p.producerRunId===P.runId&&p.artifactId===P.artifactId&&
    p.artifactZipDigest===P.artifactDigest&&p.archiveSha256===P.archiveSha256&&p.imageConfigDigest===P.imageConfigDigest&&
    p.os?.Family==='alpine'&&/^3\.24(\.\d+)*$/.test(p.os.Name)&&p.os.EOSL!==true&&Number.isSafeInteger(p.packageCount)&&p.packageCount>=10&&
    same(p.findingSeverityCounts,{HIGH:0,CRITICAL:0})&&p.findings?.length===0&&p.findingsTruncated===false&&
    p.ignoredFindingsAllowed===false&&p.ignoreUnfixedAllowed===false&&p.scannerVersion===P.scannerVersion&&
    p.scannerArchiveSha256===P.scannerSha256&&
    ['reportSha256','databaseSha256','databaseMetadataSha256'].every(k=>/^[a-f0-9]{64}$/.test(p[k]))&&
    now-Date.parse(p.recordedAtUtc)>=0&&now-Date.parse(p.recordedAtUtc)<=15*60000&&
    now-Date.parse(p.databaseUpdatedAt)>=-300000&&now-Date.parse(p.databaseUpdatedAt)<=48*3600000,'PREFLIGHT');
}
export async function runPublisher({text,approvedSha,env,preflight,ports,now=Date.now(),protocol=publicationProtocol()}){
  const {P,validateReview,validateCloud,verifyPublishedManifest}=protocol;
  const m=validateReview(text,approvedSha,now);validateCloud(env,m,now);verifyPreflight(preflight,now,P);
  await ports.consume({manifestSha256:approvedSha,nonce:m.nonce,runId:env.GITHUB_RUN_ID,retryAllowed:false});
  try{
    // Source owns IAM revoke; this role has no IAM/CFN permission.
    const who=await ports.authenticate(m);
    const session='Platform-'+env.GITHUB_RUN_ID+'-1';
    must(who.Account===P.account&&who.UserId===P.roleId+':'+session&&
      who.Arn===`arn:aws:sts::${P.account}:assumed-role/${P.role}/${session}`,'ROLE_ID');
    const inventory=await ports.inventory();
    if(protocol.verifyInventory)protocol.verifyInventory(inventory);
    else must(!inventory.nextToken&&Array.isArray(inventory.imageDetails)&&inventory.imageDetails.length===0,'REPOSITORY_NOT_EMPTY');
    await ports.login();await ports.tag();await ports.push(); // exactly one top-level push, no application retry
    const published=verifyPublishedManifest(await ports.manifest());
    const result={schema:'techlong/platform-image-publication-result/v2',outcome:'IMAGE_PUBLISHED_REVOKE_NOT_YET_PROVED',
      manifestSha256:approvedSha,nonce:m.nonce,runId:env.GITHUB_RUN_ID,sourceCommit:P.sourceCommit,
      artifactId:P.artifactId,target:`${P.registry}/${P.ecrRepository}:${P.targetTag}`,...published,
      roleId:P.roleId,pushProcessCalls:1,retryAllowed:false,iamRevokeProved:false};
    await ports.save(result);return result;
  }finally{await ports.dispose();}
}
async function oidc(env,m){
  const u=new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL);
  must(u.protocol==='https:'&&u.hostname.endsWith('.actions.githubusercontent.com')&&!u.username&&!u.password&&!u.port&&
    typeof env.ACTIONS_ID_TOKEN_REQUEST_TOKEN==='string'&&env.ACTIONS_ID_TOKEN_REQUEST_TOKEN.length>0,'OIDC_ENDPOINT');
  u.searchParams.set('audience','sts.amazonaws.com');
  const r=await fetch(u,{headers:{authorization:'Bearer '+env.ACTIONS_ID_TOKEN_REQUEST_TOKEN},redirect:'error',signal:AbortSignal.timeout(15000)});
  must(r.ok,'OIDC_RESPONSE');const body=await r.text();must(body.length<24000,'OIDC_SIZE');
  const token=JSON.parse(body).value;must(typeof token==='string'&&token.length<20000&&token.split('.').length===3,'OIDC_TOKEN');
  validateClaims(JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString('utf8')),env,m);return token;
}
export async function execute(dir,env=process.env){
  const text=env.TECHLONG_PUBLICATION_REVIEW,approvedSha=env.TECHLONG_PUBLICATION_SHA;
  const m=validateReview(text,approvedSha);validateCloud(env,m);
  must(path.dirname(path.resolve(dir))===path.resolve(env.RUNNER_TEMP),'PUBLICATION_DIRECTORY');
  const preflight=JSON.parse(await readFile(path.join(dir,'verified-preflight.json'),'utf8'));verifyPreflight(preflight);
  await inspect(dir);must(await fileHash(path.join(dir,'os-scan.json'))===preflight.reportSha256,'SCAN_REPORT_CHANGED');
  const {execFileSync}=await import('node:child_process');
  must(execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()===m.reusableCommit,'IMMUTABLE_SOURCE');
  const require=createRequire(new URL('../cloud-worker/package.json',import.meta.url));
  const {STSClient,AssumeRoleWithWebIdentityCommand,GetCallerIdentityCommand}=require('@aws-sdk/client-sts');
  const {ECRClient,DescribeImagesCommand,GetAuthorizationTokenCommand,BatchGetImageCommand}=require('@aws-sdk/client-ecr');
  const config={region:P.region,maxAttempts:1,ignoreConfiguredEndpointUrls:true};
  const baseSts=new STSClient(config);let sts,ecr,dockerDir;
  const call=(client,command)=>client.send(command,{abortSignal:AbortSignal.timeout(30000)});
  const docker=(args,input)=>{
    must(dockerDir,'DOCKER_CONFIG');const childEnv=Object.fromEntries(['PATH','HOME'].filter(k=>env[k]).map(k=>[k,env[k]]));
    const r=spawnSync('docker',args,{env:{...childEnv,DOCKER_CONFIG:dockerDir},input,encoding:'utf8',
      timeout:600000,maxBuffer:4*1024*1024,windowsHide:true});must(r.status===0&&!r.error,'DOCKER_COMMAND');
  };
  return runPublisher({text,approvedSha,env,preflight,ports:{
    consume:v=>save(path.join(dir,'publication.intent.json'),v),
    async authenticate(review){
      const token=await oidc(env,review),session='Platform-'+env.GITHUB_RUN_ID+'-1';
      const r=await call(baseSts,new AssumeRoleWithWebIdentityCommand({RoleArn:P.roleArn,RoleSessionName:session,WebIdentityToken:token,DurationSeconds:900}));
      const c=r.Credentials;must(c?.AccessKeyId&&c.SecretAccessKey&&c.SessionToken&&c.Expiration?.getTime()>Date.now()+60000,'STS_CREDENTIALS');
      const credentials={accessKeyId:c.AccessKeyId,secretAccessKey:c.SecretAccessKey,sessionToken:c.SessionToken,expiration:c.Expiration};
      sts=new STSClient({...config,credentials});ecr=new ECRClient({...config,credentials});
      return call(sts,new GetCallerIdentityCommand({}));
    },
    inventory:()=>call(ecr,new DescribeImagesCommand({registryId:P.account,repositoryName:P.ecrRepository,maxResults:100})),
    async login(){
      const r=await call(ecr,new GetAuthorizationTokenCommand({registryIds:[P.account]}));
      must(r.authorizationData?.length===1,'ECR_AUTH_DATA');const a=r.authorizationData[0];
      must(a.proxyEndpoint==='https://'+P.registry&&a.expiresAt?.getTime()>Date.now()+60000&&typeof a.authorizationToken==='string','ECR_AUTH_ENDPOINT');
      const decoded=Buffer.from(a.authorizationToken,'base64').toString('utf8');must(decoded.startsWith('AWS:')&&decoded.length>4,'ECR_AUTH_USERNAME');
      dockerDir=await mkdtemp(path.join(path.resolve(env.RUNNER_TEMP),'platform-ecr-auth-'));
      // A nonempty auth map prevents automatic detection of a host credential
      // helper; auth remains only in this private ephemeral config.json.
      await save(path.join(dockerDir,'config.json'),{auths:{[P.registry]:{}}});
      docker(['login','--username','AWS','--password-stdin',P.registry],decoded.slice(4));
    },
    async tag(){docker(['tag',P.imageConfigDigest,`${P.registry}/${P.ecrRepository}:${P.targetTag}`]);},
    async push(){must(Date.now()+60000<Date.parse(m.grantExpiresAt),'PUSH_WINDOW');docker(['push',`${P.registry}/${P.ecrRepository}:${P.targetTag}`]);},
    manifest:()=>call(ecr,new BatchGetImageCommand({registryId:P.account,repositoryName:P.ecrRepository,imageIds:[{imageTag:P.targetTag}],
      acceptedMediaTypes:['application/vnd.docker.distribution.manifest.v2+json','application/vnd.oci.image.manifest.v1+json']})),
    save:r=>save(path.join(dir,'publication-result.json'),r),
    async dispose(){
      baseSts.destroy();sts?.destroy();ecr?.destroy();
      if(dockerDir){
        must(path.dirname(dockerDir)===path.resolve(env.RUNNER_TEMP)&&path.basename(dockerDir).startsWith('platform-ecr-auth-'),'DOCKER_CLEANUP_PATH');
        try{await unlink(path.join(dockerDir,'config.json'));}catch(e){if(e.code!=='ENOENT')throw e;}
        await rmdir(dockerDir); // never recursively delete an unexpected file
      }
    },
  }});
}
// Explicit adapter boundary used by a future reviewed Source controller. No live
// clients here; no success claim unless independent revoke verification succeeds.
export async function coordinatePublication({text,approvedSha,ports,now=Date.now()}){
  const m=validateReview(text,approvedSha,now),t=templatesForCoordinator(m);
  must(now>=Date.parse(m.grantStartsAt)&&now+60000<Date.parse(m.grantExpiresAt),'SOURCE_GRANT_WINDOW');
  await ports.preflight(m);await ports.consume({manifestSha256:approvedSha,nonce:m.nonce});let result,error;
  try{await ports.grant(t.grant);await ports.verifyGrant(t.grant);result=await ports.dispatchAndWait(m);}
  catch(e){error=e;}
  finally{
    // Revoke even when grant submission or dispatch returns an ambiguous error.
    try{await ports.revoke(t.revoke);}catch(e){error=e;}
    // A rejected/ambiguous revoke submission still requires a separate readback.
    try{await ports.verifyLocked(t.revoke);}catch(e){error=e;}
  }
  if(error)throw error;return result;
}
import {templates as templatesForCoordinator} from './plan.mjs';
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const [dir,...extra]=process.argv.slice(2);
  Promise.resolve().then(()=>{must(dir&&!extra.length,'PUBLISH_ARGUMENTS');return execute(dir);}).then(r=>console.log(JSON.stringify(r)))
    .catch(()=>{console.error('PLATFORM_PUBLICATION_REQUIRES_SOURCE_REVOKE_AND_INSPECT');process.exitCode=1;});
}
