// One exact sandbox activation; importing this module does not contact providers.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { ROOT, EVIDENCE, absent, directory, environment, git, noLinks, pins, readText, writeOnce } from '../platform-image-source-v2/files.mjs';
import { createAws, verifySnapshot } from '../platform-image-source-v2/aws.mjs';
import { createGithub } from '../platform-image-source-v2/github.mjs';
import { runControlled, errorCode } from '../platform-image-source-v2/runner.mjs';
import { firstPurchaseSourceContext } from '../platform-registration-publish-v1/source.mjs';
import { firstPurchaseProtocol } from '../platform-registration-publish-v1/contract.mjs';
import { canonical, hash, same } from './contract.mjs';
import { buildFirstPurchaseActivationTemplates, scope, draft } from './first-purchase-activation.mjs';
import { firstPurchaseAws } from './first-purchase-activation-aws.mjs';
import { firstPurchaseDatabase } from './first-purchase-activation-db.mjs';
import { validSandboxPurchaseScope } from '../../lib/purchases/sandbox-first-purchase-config.ts';

const reviewPath='docs/evidence/sandbox-first-purchase-activation-renewed.review.json';
const riskDoc='docs/aws-sandbox-first-purchase-activation-renewed-review.md';
const approvalDocChanges=[reviewPath,'docs/aws-auto-deployment-execution-runbook.md','docs/aws-auto-deployment-mainline.md',
  'docs/aws-sandbox-first-purchase-activation-preparation.md'];
const checkoutScopeHash='7359ccf32c3bebd4c4b754caac4cdfbdd471a8202c9206f67a298a8f020ca0fc';
const code=(ok,g)=>{if(!ok)throw Error('FIRST_PURCHASE_REVIEW_'+g);};
const local=path.join(ROOT,'.local-secrets');
const privateName='sandbox-first-purchase-stripe-test.json', signingName='sandbox-first-purchase-stripe-webhook-test.json';
const prefix='techlong-platform-recovery-image-v1';
const slot=path.join(local,'sandbox-first-purchase-activation-v1.intent.json');
const total=95*60000, approvalWindow=24*3600000, preflightMax=10*60000;
const webhookApiVersion='2026-10-28.endive';
const meta={stripeAuthenticatedGets:5,stripeApiWrites:0,operatorStripeDashboardEndpointCreatesIfAbsent:0,
  sourceSts:11,awsMetadata:440,gitHubGets:213,githubCredentialLoads:1,fixedArtifactDownloadsInWorkflow:1,
  workflowGitHubApiGets:3,workflowSts:1,workflowExplicitEcrReads:3,
  stripePrivateFiles:2,configReads:1,neonTlsConnections:3,neonSqlSubmissions:76,anonymousTechnicalGets:2};
const writes={publisherGrantUpdates:1,publisherRevokeUpdates:1,protectedDispatch:1,topLevelEcrPush:1,
  neonInstallTransactions:1,newEmptySecret:1,newPolicy:1,newSecretVersion:1,accessChangeSetCreate:1,accessChangeSetExecute:1,
  hostingChangeSetCreate:1,hostingChangeSetExecute:1,checkoutOrTaskBusinessWrites:0,repeats:0,deletes:0};
const pub=firstPurchaseSourceContext(), candidate=firstPurchaseProtocol.P;
const normalize=t=>t.replaceAll('\r\n','\n');
const fingerprint=x=>hash(canonical(x));

export function makeFirstPurchaseReview({implementationCommit,nonce,issuedAt,riskSha256}){
  const issued=Date.parse(issuedAt);
  const artifactEnd=Date.parse(candidate.artifactExpiresAt);
  const hardStop=Math.min(issued+approvalWindow+total,artifactEnd);
  const latestStart=hardStop-total;
  code(/^[a-f0-9]{40}$/.test(implementationCommit)&&/^[a-f0-9]{32}$/.test(nonce)&&/^[a-f0-9]{64}$/.test(riskSha256)&&
    Number.isFinite(issued)&&issued<latestStart,'REVIEW_WINDOW');
  return {schema:'techlong/sandbox-first-purchase-activation-reviewed/v2',implementationCommit,nonce,issuedAt,riskSha256,
    latestStartUtc:new Date(latestStart).toISOString(),hardStopUtc:new Date(hardStop).toISOString(),totalMinutesMax:95,
    preflight:{freshReadbacksAfterApprovalAndBeforeFirstRemoteWrite:true,maxMinutesBeforeFirstRemoteWrite:10,
      originalSnapshotEndedUtc:draft.originalSnapshot.usableBeforeUtc,originalSnapshotUse:'expected baseline only, never current authority',
      exactTenantImageManifestAndExistingKmsPolicy:true},
    artifactExpiresAtUtc:candidate.artifactExpiresAt,
    sourceCi:{publisherRun:44375035526,publisherCommit:'9de0536ff4a1d064ad633c272b244995e835ce07',reusableRun:pub.S.reusableCiRun,
      reusableCommit:pub.S.reusableCommit,callerWorkflowId:422829965,postgres18Run:44374702186},
    target:{...scope,workspaceIdSha256:checkoutScopeHash,originalNeonProjectionSha256:draft.originalSnapshot.privateReceiptSha256.neon,
      originalAwsProjectionSha256:draft.originalSnapshot.privateReceiptSha256.aws},
    candidate:{buildRun:candidate.runId,attempt:1,artifact:candidate.artifactId,zipSha256:candidate.artifactDigest,
      configDigest:candidate.imageConfigDigest,recipe:candidate.sourceRecipeSha256,tree:candidate.sourceTreeOid,
      exactTag:candidate.targetTag,repository:candidate.ecrRepository,publisherStack:candidate.stackId,environment:candidate.environment},
    stripe:{endpoint:draft.runtimeMaterial.stripeEndpoint,events:draft.runtimeMaterial.stripeEventTypes,apiVersion:webhookApiVersion,
      mode:'sandbox / your account / snapshot',credentialFilename:privateName,signingFilename:signingName,
      newSecretName:draft.runtimeMaterial.newSecretName},
    limits:meta,writes,safety:'Only this one window; always revoke the temporary ECR Grant after any possible submission. Keep managed CFN rollback; no additional recovery, write retry, payment, job claim or full worker.'};
}

export function validateFirstPurchaseReview(text,approvedSha,now=Date.now()){
  code(/^[a-f0-9]{64}$/.test(approvedSha??'')&&hash(normalize(text))===approvedSha,'APPROVAL_SHA');
  const m=JSON.parse(text);
  code(same(m,makeFirstPurchaseReview(m))&&Date.parse(m.issuedAt)<=now&&now<Date.parse(m.latestStartUtc)&&
    now+total<Date.parse(m.artifactExpiresAtUtc),'REVIEW_EXPIRED_OR_CHANGED');
  return m;
}

export async function runFirstPurchaseStages(ports){
  await ports.preflight();
  const publisher=await ports.publish();
  code(publisher?.locked===true,'PUBLISHER_LOCK_NOT_PROVED');
  const webhookDatabaseUrl=await ports.install();
  const secret=await ports.store(webhookDatabaseUrl);
  const targets=ports.templates(publisher,secret);
  await ports.update('access',targets.access);
  await ports.update('hosting',targets.hosting);
  await ports.inspect(targets);
}

function sourceGuard(m){
  environment();
  code(git(['branch','--show-current']).trim()==='main'&&git(['status','--porcelain']).trim()===''&&
    git(['diff','--name-only',m.implementationCommit,'HEAD']).trim().split(/\r?\n/).filter(Boolean).every(x=>approvalDocChanges.includes(x)),
    'LOCAL_MAIN_OR_CODE_DRIFT');
  git(['merge-base','--is-ancestor',m.implementationCommit,'HEAD']);
  const head=git(['rev-parse','HEAD']).trim();
  code(normalize(git(['show',head+':.github/workflows/'+candidate.callerFile]))===
    normalize(git(['show',m.sourceCi.publisherCommit+':.github/workflows/'+candidate.callerFile])),'CALLER_WORKFLOW_DRIFT');
  return head;
}

function privateAcl(...files){
  code(process.platform==='win32','LOCAL_OS');
  const one=s=>"'"+s.replaceAll("'","''")+"'";
  const command=`$ErrorActionPreference='Stop'
$self=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$allow=@($self,'S-1-5-18','S-1-5-32-544')
foreach($p in @(${files.map(one).join(',')})){
  $v=Get-Item -LiteralPath $p -Force
  if(($v.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Reparse'}
  $a=Get-Acl -LiteralPath $p
  if($a.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $self){throw 'Owner'}
  $rules=@($a.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]) | Where-Object {$_.AccessControlType -eq 'Allow'})
  if(@($rules | Where-Object {$_.IdentityReference.Value -notin $allow}).Count -ne 0){throw 'Acl'}
  if(@($rules | Where-Object {$_.IdentityReference.Value -eq $self -and ($_.FileSystemRights -band [Security.AccessControl.FileSystemRights]::ReadData)}).Count -eq 0){throw 'Read'}
}
'PRIVATE_ACL_OK'`;
  const p=spawnSync('pwsh.exe',['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(command,'utf16le').toString('base64')],
    {encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:32768});
  code(p.status===0&&p.stdout.trim()==='PRIVATE_ACL_OK','PRIVATE_FILE_MISSING_OR_ACL');
}
function excluded(file){
  const rel=path.relative(ROOT,file).replaceAll('\\','/');
  git(['check-ignore','--quiet','--',rel]);
  code(!git(['ls-files','--',rel]).trim(),'PRIVATE_FILE_TRACKED');
}
async function privateJson(p,expected){
  const text=await readText(p,2*1024*1024);
  if(expected)code(hash(text)===expected,'PRIVATE_RECEIPT_CHANGED');
  return JSON.parse(text);
}
async function stripeGate(t,s,until){
  const test=/^rk_test_[A-Za-z0-9_]{8,512}$/;
  code(same(Object.keys(t).sort(),['accountId','inspectionKey','runtimeKey'])&&/^acct_[A-Za-z0-9]{6,90}$/.test(t.accountId)&&
    test.test(t.runtimeKey)&&test.test(t.inspectionKey)&&t.runtimeKey!==t.inspectionKey&&
    same(Object.keys(s).sort(),['endpointId','signingSecret'])&&/^we_[A-Za-z0-9]{1,90}$/.test(s.endpointId)&&
    /^whsec_[A-Za-z0-9_]{8,512}$/.test(s.signingSecret),'STRIPE_PRIVATE_SHAPE');
  async function get(route,key){
    code(Date.now()+15000<until,'STRIPE_WINDOW');
    const r=await fetch('https://api.stripe.com'+route,{method:'GET',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000),
      headers:{Authorization:'Bearer '+key,Accept:'application/json'}});
    if(r.status!==200){await r.body?.cancel().catch(()=>{});code(false,'STRIPE_METADATA_HTTP');}
    code(r.body,'STRIPE_METADATA_BODY');
    const rd=r.body.getReader(),chunks=[];let size=0;
    try{for(;;){const b=await rd.read();if(b.done)break;size+=b.value.length;code(size<=1048576,'STRIPE_METADATA_SIZE');chunks.push(b.value);}}
    finally{await rd.cancel().catch(()=>{});rd.releaseLock();}
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  for(const k of [t.runtimeKey,t.inspectionKey]){
    const a=await get('/v1/account',k);
    code(a.object==='account'&&a.id===t.accountId,'STRIPE_ACCOUNT');
    const b=await get('/v1/balance',k);
    code(b.object==='balance'&&b.livemode===false,'STRIPE_MODE');
  }
  const rows=await get('/v1/webhook_endpoints?limit=100',t.inspectionKey);
  code(rows.object==='list'&&rows.has_more===false&&Array.isArray(rows.data),'STRIPE_ENDPOINT_LIST');
  const matches=rows.data.filter(x=>{try{
    const u=new URL(x.url);return u.hostname.toLowerCase().replace(/\.$/,'')==='console.sandbox.techlong.cloud'&&
      u.pathname.toLowerCase().replace(/\/+$/,'')==='/api/stripe/webhook';
  }catch{return false;}});
  const w=matches[0];
  code(matches.length===1&&w.id===s.endpointId&&w.url===draft.runtimeMaterial.stripeEndpoint&&w.object==='webhook_endpoint'&&
    w.livemode===false&&w.status==='enabled'&&w.application==null&&w.api_version===webhookApiVersion&&
    Array.isArray(w.enabled_events)&&same([...w.enabled_events].sort(),draft.runtimeMaterial.stripeEventTypes),'STRIPE_EXACT_ENDPOINT');
  return {stripeTestKey:t.runtimeKey,stripeTestWebhookSecret:s.signingSecret};
}

async function publish(m,until,preflightBy,heads,notify,record){
  const latest=until-25*60000, issued=Date.now();
  code(issued+3600000<latest,'INSUFFICIENT_PUBLICATION_AND_UPDATE_TIME');
  const pHead=heads(),commonRoots=['ops/platform-registration-publish-v1/cloud.mjs','ops/platform-registration-publish-v1/artifact.mjs',
    'ops/platform-registration-publish-v1/preflight.sh','ops/platform-registration-publish-v1/extract.py',
    '.github/workflows/'+candidate.reusableFile,'ops/cloud-worker/package.json','ops/cloud-worker/package-lock.json',
    'docs/evidence/sandbox-first-purchase-replacement.observed.json','docs/evidence/sandbox-first-purchase-activation-consolidated.prepared.json'];
  const sourcePins=await pins({roots:commonRoots});
  for(const f of sourcePins)code(hash(normalize(git(['show',pub.S.reusableCommit+':'+f.file])))===f.sha256,'REUSABLE_FILE_DRIFT');
  const innerOuter={schema:pub.S.schema,issuedAt:new Date(issued).toISOString(),expiresAt:new Date(latest).toISOString(),
    latestStartAt:new Date(latest-3600000).toISOString(),nonce:m.nonce,operatorSourceCommit:m.sourceCi.publisherCommit,
    sourceCiRunId:m.sourceCi.publisherRun,callerWorkflowId:m.sourceCi.callerWorkflowId,sourcePins,
    riskSha256:hash(normalize(await readText(path.join(ROOT,pub.S.riskFile)))),candidate,reusableCommit:pub.S.reusableCommit,scope:pub.S.scope};
  const text=JSON.stringify(innerOuter);
  const request=(inner,phase)=>{
    if(phase==='grant')code(Date.now()<preflightBy,'PREFLIGHT_EXPIRED');
    return pub.updateRequest(inner,phase);
  };
  const a=await createAws({protocol:firstPurchaseProtocol,request,sourceLogin:true,metadataLimit:238,stsLimit:6});
  const g=createGithub({context:pub,maxGets:213});let attempted=false,before,inner;
  const bindings=s=>fingerprint({roleTags:s.role.Role.Tags,stackTags:s.stack.Stacks[0].Tags,boundary:s.boundary.Policy,repository:s.repository.repositories});
  try{
    const result=await runControlled({text,approvedSha:hash(text),review:pub,ports:{
      async preflight(){
        await absent(path.join(EVIDENCE,pub.S.intentFile));
        before=await a.snapshot();
        const now=Date.now(),draftInner=pub.innerReview(innerOuter,pHead,now);
        verifySnapshot(before,firstPurchaseProtocol.templates(draftInner).revoke);firstPurchaseProtocol.verifyRetained(before.images);
        await g.metadata(pHead,innerOuter);
        code(heads()===pHead&&Date.now()-Date.parse(before.startedAtUtc)<120000,'PUBLISHER_PREFLIGHT_DRIFT');return pHead;
      },consume:v=>writeOnce(path.join(EVIDENCE,pub.S.intentFile),v),record:(name,v)=>record('publish-'+name,v),
      async update(r,phase){
        inner=r;
        if(phase==='grant'){
          code(heads()===pHead&&Date.now()<preflightBy&&Date.now()+60000<Date.parse(r.grantExpiresAt)&&
            Date.parse(r.grantExpiresAt)<=latest,'PUBLISHER_WRITE_WINDOW');
          await record('publish-grant-intent',{stack:candidate.stackId});
          const writesBefore=a.counts.writes;
          try{await record('publish-grant-ack',await a.update(r,'grant'));}
          finally{attempted=a.counts.writes>writesBefore;}
          return;
        }
        if(!attempted)return;
        try{await a.settled(Date.now()+10*60000);}catch{/* an attempted grant must still be revoked once */}
        try{await record('publish-revoke-intent',{stack:candidate.stackId});}catch{/* audit I/O must not suppress revoke */}
        await record('publish-revoke-ack',await a.update(r,'revoke'));
      },
      async verify(r,phase){
        await a.settled(Date.now()+10*60000);
        const state=await a.snapshot();verifySnapshot(state,firstPurchaseProtocol.templates(r)[phase]);
        code(bindings(state)===bindings(before),'PUBLISHER_REFERENCE_DRIFT');
        if(phase==='grant')firstPurchaseProtocol.verifyRetained(state.images);
      },
      dispatch(r,txt,sha){code(heads()===pHead,'PUBLISHER_DISPATCH_HEAD');return g.dispatch(r,txt,sha);},
      wait:(ack,r,sha,id)=>g.wait(ack,r,sha,id,async v=>{await record('publish-human-gate',v);notify(v);}),
      async published(){
        const proof=await a.published(),view=await a.snapshot();
        verifySnapshot(view,firstPurchaseProtocol.templates(inner).revoke);
        firstPurchaseProtocol.verifyFinalInventory(view.images,proof.verified.manifestDigest);
        code(bindings(view)===bindings(before),'PUBLISHER_FINAL_DRIFT');return proof.verified;
      },
    }});
    code(result.outcome==='PUBLISHED_AND_INDEPENDENTLY_LOCKED'&&result.locked,'PUBLISHER_STOP');
    const independent=await createAws({protocol:firstPurchaseProtocol,request:pub.updateRequest,sourceLogin:true,readOnly:true,metadataLimit:17,stsLimit:2});
    try{
      const view=await independent.snapshot(), proof=await independent.published();
      verifySnapshot(view,firstPurchaseProtocol.templates(inner).revoke);
      firstPurchaseProtocol.verifyFinalInventory(view.images,proof.verified.manifestDigest);
      code(bindings(view)===bindings(before)&&same(proof.verified,result.published),'PUBLISHER_INDEPENDENT_PROOF');
      const verified={locked:true,artifactId:candidate.artifactId,sourceRecipeSha256:candidate.sourceRecipeSha256,
        sourceTreeOid:candidate.sourceTreeOid,...proof.verified,runId:result.runId};
      await record('publish-independently-verified',verified);return verified;
    }finally{independent.close();}
  }finally{a.close();g.close();}
}

async function execute(approvedSha,notify){
  const text=await readText(path.join(ROOT,reviewPath)),m=validateFirstPurchaseReview(text,approvedSha);
  const heads=()=>sourceGuard(m);
  heads();code(hash(normalize(await readText(path.join(ROOT,riskDoc))))===m.riskSha256,'RISK_CHANGED');
  const tf=path.join(local,privateName),sf=path.join(local,signingName),config=path.join(ROOT,'.env.local');
  await absent(slot);await absent(path.join(EVIDENCE,pub.S.intentFile));
  for(const f of [tf,sf,config]){excluded(f);await noLinks(f);}
  privateAcl(local,tf,sf);
  const start=Date.now(),until=Math.min(Date.parse(m.hardStopUtc),start+total);
  code(start<Date.parse(m.latestStartUtc)&&until-start===total,'REVIEW_START_MISSED');
  const preflightBy=start+preflightMax;
  const dir=await directory(prefix+'-'+m.nonce,{prefix});
  const record=(label,v)=>writeOnce(path.join(dir,'activation-'+label+'.json'),{utc:new Date().toISOString(),approvedSha,...v});
  await writeOnce(slot,{approvedSha,startedAt:new Date(start).toISOString(),endsAt:new Date(until).toISOString(),retry:false});
  let stage='preflight',aws,db,stripe;
  const step=(name,work)=>(...args)=>{code(Date.now()<until,'RUN_EXPIRED');stage=name;notify({stage});return work(...args);};
  try{
    const w=await privateJson(path.join(local,'sandbox-first-onboarding-workspace-20261118.json'));
    const projection=await privateJson(path.join(local,'sandbox-first-purchase-readonly-a.neon.result.json'),m.target.originalNeonProjectionSha256);
    const awsFacts=await privateJson(path.join(local,'sandbox-first-purchase-readonly-a.aws.result.json'),m.target.originalAwsProjectionSha256);
    const prior=JSON.parse(await readText(path.join(ROOT,'docs/evidence/sandbox-registration-preflight.review.json'))).target.historicalPrivateTargetReceipt;
    const historic=await privateJson(prior.path,prior.sha256);
    const binding={workspaceId:w.workspaceId,planId:projection.checks.plans[0]?.plan_id,releaseId:scope.tenantReleaseId,imageUri:scope.tenantReleaseImage};
    code(hash(binding.workspaceId)===checkoutScopeHash&&validSandboxPurchaseScope(binding)&&w.releaseId===scope.tenantReleaseId&&
      w.productId===scope.productId&&w.environmentId===scope.environmentId&&w.deploymentProfileKey===scope.profile&&
      awsFacts.outcome==='AWS_READ_ONLY_VERIFIED'&&same(projection.findings,['STANDARD_PLAN_NOT_UNIQUE_OR_INVALID']),'ORIGINAL_FACTS');
    const tc=await privateJson(tf),sc=await privateJson(sf);
    db=firstPurchaseDatabase({rawConfig:await readText(config,65536),historical:historic,projection:projection.checks,binding,deadline:until,record});
    aws=firstPurchaseAws({deadline:until,nonce:m.nonce,versionId:randomUUID(),prior:awsFacts.checks,record});
    await runFirstPurchaseStages({
      preflight:step('necessary-preflight',async()=>{const observedFrom=new Date().toISOString();
        await aws.preflight();await db.preflight();stripe=await stripeGate(tc,sc,preflightBy);
        code(Date.now()<preflightBy,'PREFLIGHT_EXPIRED');
        tc.runtimeKey=undefined;tc.inspectionKey=undefined;sc.signingSecret=undefined;
        await record('preflight-verified',{observedFrom,observedThrough:new Date().toISOString(),
          accountAndEndpointMatch:true,platformAndBusinessBaselineMatch:true});}),
      publish:step('publish-and-lock',()=>publish(m,until,preflightBy,heads,notify,record)),
      install:step('install-neon',()=>db.install()),
      store:step('store-runtime-secret',async webhookDatabaseUrl=>{try{return await aws.store({...stripe,webhookDatabaseUrl});}finally{stripe=undefined;}}),
      templates:(publisher,secret)=>buildFirstPurchaseActivationTemplates({...binding,publisher,secret}),
      update:(which,t)=>step('update-'+which,()=>aws.update(which,t))(),
      inspect:step('independent-technology-inspect',t=>aws.inspect(t)),
    });
    await record('result',{outcome:'SANDBOX_FIRST_PURCHASE_ENABLED_TECHNICALLY_VERIFIED',aws:aws.counts,db:db.limits,businessTest:false,retry:false});
    return {outcome:'SANDBOX_FIRST_PURCHASE_ENABLED_TECHNICALLY_VERIFIED',evidenceDirectory:dir,businessTest:false};
  }catch(e){
    const safe=errorCode(e);
    await record('result',{outcome:'STOPPED_REQUIRES_INSPECTION',stage,code:safe,aws:aws?.counts,db:db?.limits,retry:false}).catch(()=>{});
    return {outcome:'STOPPED_REQUIRES_INSPECTION',stage,code:safe,evidenceDirectory:dir,retry:false};
  }finally{aws?.close();}
}

async function cli([mode,value,...extra]){
  if(mode==='PrepareOffline'&&!value&&!extra.length){
    const implementationCommit=git(['rev-parse','HEAD']).trim();
    code(git(['status','--porcelain']).trim()===''&&git(['branch','--show-current']).trim()==='main','PREPARE_CLEAN_MAIN');
    await absent(slot);await absent(path.join(EVIDENCE,pub.S.intentFile));
    const riskSha256=hash(normalize(await readText(path.join(ROOT,riskDoc))));
    const m=makeFirstPurchaseReview({implementationCommit,nonce:randomBytes(16).toString('hex'),issuedAt:new Date().toISOString(),riskSha256});
    await writeOnce(path.join(ROOT,reviewPath),m);
    const approvedSha=hash(normalize(await readText(path.join(ROOT,reviewPath))));
    return {mode,approvalSha256:approvedSha,latestStartUtc:m.latestStartUtc,executed:false};
  }
  code(mode==='RunReviewed'&&value&&!extra.length,'ARGUMENTS');
  return execute(value,msg=>console.log(JSON.stringify(msg)));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  cli(process.argv.slice(2)).then(r=>{console.log(JSON.stringify(r));if(r.outcome==='STOPPED_REQUIRES_INSPECTION')process.exitCode=1;})
    .catch(e=>{console.error(JSON.stringify({outcome:'NOT_STARTED',code:errorCode(e)}));process.exitCode=1;});
}
