// Local Source operator for this one published buyer-forward candidate.
// Runner and caller stay on their already published immutable revisions.
import { readFile, lstat, realpath } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const BUYER_SOURCE = Object.freeze({
  callerCommit: 'b4f49b253256199e5305742110826b943ea88134',
  callerCiRun: 44924647810, callerWorkflowId: 422829965,
  reusableCommit: 'a3f1cefcd72246e76c9a1b46634dc4da4a90d75f',
  reusableCiRun: 44924391465, reusableCiWorkflow: 422828156,
  artifactId: 14714442097, producerRunId: 44922494926,
  factsNotUsableAtOrAfterUtc: '2026-11-21T22:38:05.916Z',
  intentFile: 'techlong-sandbox-fc41597f-buyer-forward-14714442097.intent.json',
});
export const BUYER_SOURCE_LIMITS = Object.freeze({
  sourceSts: 7, awsMetadata: 246, githubGets: 213, cloudFormationUpdateStack: 2,
  githubWorkflowDispatch: 1, roleSessions: 1, topLevelDockerPush: 1,
  grantSeconds: 3600, stsSeconds: 900, gitCredentialLoads: 1,
  awsSecretValueReads: 0, appPrivateKeyReads: 0, sqlConnections: 0,
  resourceCreates: 0, resourceDeletes: 0, deployments: 0,
});
const profileSchema='techlong/sandbox-fc41597f-buyer-forward-source-review/v1';
const sectionSchema='techlong/sandbox-fc41597f-buyer-forward-source-section/v1';
const packageSchema='techlong/sandbox-first-open-publish-and-install/v1';
const risky='docs/evidence/sandbox-first-open-buyer-forward-candidate.verified.json';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const hex64=/^[a-f0-9]{64}$/;
const nowIso=ms=>new Date(ms).toISOString();
const self=fileURLToPath(import.meta.url);
const operatorSha=async()=>hash((await readFile(self,'utf8')).replaceAll('\r\n','\n'));
function need(ok,code){if(!ok)throw Error('BUYER_SOURCE_'+code);}

// Not all JSON loaded via new URL() is discovered by the original import walk.
const frozenRoots=[
  'ops/platform-registration-publish-v1/cloud.mjs',
  'ops/platform-registration-publish-v1/artifact.mjs',
  'ops/platform-registration-publish-v1/preflight.sh',
  'ops/platform-registration-publish-v1/extract.py',
  '.github/workflows/sandbox-registration-image-publish-job-v1.yml',
  'ops/cloud-worker/package.json','ops/cloud-worker/package-lock.json',
  risky,
  'docs/evidence/sandbox-registration-ecr-publication.prepared.json',
  'docs/evidence/sandbox-registration-platform-candidate.observed.json',
  'docs/evidence/sandbox-first-purchase-replacement.observed.json',
  'docs/evidence/sandbox-first-purchase-activation-consolidated.prepared.json',
  'docs/evidence/sandbox-first-purchase-dahlia.observed.json',
  'docs/evidence/sandbox-first-purchase-dahlia.prepared.json',
  'docs/evidence/sandbox-first-purchase-checkout-repair-rollout.review.json',
  'docs/evidence/sandbox-first-purchase-billing-rollout.review.json',
  'docs/evidence/sandbox-first-purchase-billing-candidate.observed.json',
];
const roots=[...frozenRoots,'ops/platform-image-source-v2/runner.mjs',
  'ops/platform-image-source-v2/aws.mjs','ops/platform-image-source-v2/github.mjs',
  '.github/workflows/sandbox-registration-image-publish-v1.yml',
  '.github/workflows/sandbox-registration-publication-checks.yml',
  'package.json','package-lock.json'];

const rejectOverrides=e=>need(!Object.keys(e).some(k=>/^(AWS_|GIT_(DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|CONFIG.*|COMMON_DIR)$|NODE_OPTIONS$|NODE_PATH$|NODE_EXTRA_CA_CERTS$)/.test(k)&&e[k])&&
  e.NODE_TLS_REJECT_UNAUTHORIZED!=='0','ENVIRONMENT_OVERRIDE');
const exactSettings=legacy=>Object.freeze({...legacy,
  reusableCommit:BUYER_SOURCE.reusableCommit,reusableCiRun:BUYER_SOURCE.reusableCiRun,reusableCiWorkflow:BUYER_SOURCE.reusableCiWorkflow,
  sourceCiFile:'sandbox-registration-publication-checks.yml',schema:profileSchema,
  tokenPrefix:'buyer-forward-35ec0afb-fc41597f',riskFile:risky,
  intentFile:BUYER_SOURCE.intentFile,scope:BUYER_SOURCE_LIMITS});

export function buyerSourceContext(protocol, base) {
  need(protocol?.P?.artifactId===BUYER_SOURCE.artifactId&&protocol.P.runId===BUYER_SOURCE.producerRunId,'CANDIDATE');
  const validateOuter=(text,sha,now=Date.now())=>{
    const m=base.validateOuter(text,sha,now);
    need(m.operatorSourceCommit===BUYER_SOURCE.callerCommit&&m.sourceCiRunId===BUYER_SOURCE.callerCiRun&&
      m.callerWorkflowId===BUYER_SOURCE.callerWorkflowId,'APPROVED_WORKFLOW_PINS');
    const cutoff=Date.parse(BUYER_SOURCE.factsNotUsableAtOrAfterUtc);
    need(Date.parse(m.expiresAt)<=cutoff&&now+3600000<=cutoff,'FACTS_EXPIRED');
    return m;
  };
  return Object.freeze({...base,validateOuter,innerReview(m,head,now=Date.now()){
    const text=JSON.stringify(m);validateOuter(text,hash(text),now);
    need(head===BUYER_SOURCE.callerCommit,'CALLER_HEAD');
    return base.innerReview(m,head,now);
  }});
}

function gitFrom(checkout,args){
  const r=spawnSync('git',args,{cwd:checkout,encoding:'utf8',timeout:20000,maxBuffer:3000000,windowsHide:true,
    env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'Never'},stdio:['ignore','pipe','ignore']});
  need(r.status===0&&!r.error,'GIT');return r.stdout;
}
async function checkedCheckout(checkout,{offline=false}={}){
  if(!offline)rejectOverrides(process.env);
  need(typeof checkout==='string'&&path.isAbsolute(checkout)&&path.resolve(checkout)===checkout,'CHECKOUT_PATH');
  need((await realpath(checkout)).toLowerCase()===checkout.toLowerCase()&&(await lstat(checkout)).isDirectory(),'CHECKOUT_CANONICAL_PATH');
  const git=args=>gitFrom(checkout,args);
  const exact=()=>{
    need(path.resolve(git(['rev-parse','--show-toplevel']).trim()).toLowerCase()===checkout.toLowerCase()&&
      git(['branch','--show-current']).trim()==='main'&&git(['rev-parse','HEAD']).trim()===BUYER_SOURCE.callerCommit&&
      git(['status','--porcelain','--untracked-files=all']).trim()==='','CLEAN_EXACT_MAIN');
    git(['merge-base','--is-ancestor',BUYER_SOURCE.reusableCommit,BUYER_SOURCE.callerCommit]);
  };
  exact();
  const load=rel=>import(pathToFileURL(path.join(checkout,rel)).href);
  const [files,review,{buyerForwardProtocol:protocol}]=await Promise.all([
    load('ops/platform-image-source-v2/files.mjs'),load('ops/platform-image-source-v2/review.mjs'),
    load('ops/platform-registration-publish-v1/contract.mjs'),
  ]);
  const settings=exactSettings(review.S),options={settings,roots,frozenRoots,metadataFiles:[]};
  const context=buyerSourceContext(protocol,review.sourceReview({protocol,settings}));
  async function clean(m){
    if(!offline)need(await files.cleanSource(m,options)===BUYER_SOURCE.callerCommit,'CLEAN_EXACT_MAIN');
    else{
      // Inspection only: managed Git config may be present. No credential
      // modules, writes, or weakening of the live cleanSource gate are allowed.
      exact();
      const actual=await files.pins(options);
      for(const {file,sha256} of actual)need(
        hash(git(['show',BUYER_SOURCE.callerCommit+':'+file]).replaceAll('\r\n','\n'))===sha256,'LOCAL_COMMIT_DRIFT');
      for(const {file,sha256} of await files.pins({settings,roots:frozenRoots}))need(
        hash(git(['show',BUYER_SOURCE.reusableCommit+':'+file]).replaceAll('\r\n','\n'))===sha256,'REUSABLE_DRIFT');
      if(m)need(JSON.stringify(actual)===JSON.stringify(m.sourcePins),'LOCAL_SOURCE_PIN_DRIFT');
    }
    return BUYER_SOURCE.callerCommit;
  }
  await clean();
  return {files,context,settings,protocol,clean,load,checkout,pins:()=>files.pins(options)};
}

async function verifiedDependencyRoots(checkout){
  // This isolated checkout may live below another repository; Node must not
  // climb into that repository's modules at runtime. Install only from the
  // checkout's already pinned lockfiles before seeking actual run approval.
  const roots=[path.join(checkout,'node_modules'),path.join(checkout,'ops','cloud-worker','node_modules')];
  const from=[
    ['ops/platform-image-source-v2/aws.mjs',['@smithy/node-http-handler','@aws-sdk/credential-provider-login','@aws-sdk/credential-provider-node']],
    ['ops/cloud-worker/package.json',['@aws-sdk/client-sts','@aws-sdk/client-iam','@aws-sdk/client-cloudformation','@aws-sdk/client-ecr']],
  ];
  for(const [file,names] of from){
    const require=createRequire(path.join(checkout,file));
    for(const name of names){
      let resolved;
      try{resolved=await realpath(require.resolve(name));}catch{throw Error('BUYER_SOURCE_LOCKED_DEPENDENCIES_REQUIRED');}
      need(roots.some(root=>{
        const rel=path.relative(root,resolved);return rel&&!rel.startsWith('..')&&!path.isAbsolute(rel);
      }),'DEPENDENCY_OUTSIDE_CHECKOUT');
    }
  }
}

/** Local source/approval preparation only. Embed the resulting source section
 * in the one combined approval; this never calls GitHub or an AWS endpoint. */
export async function prepareBuyerForwardSource(checkout,{now=Date.now(),nonce=randomBytes(16).toString('hex')}={}){
  const c=await checkedCheckout(checkout,{offline:true});
  const expiresAt=nowIso(Math.min(Date.parse(BUYER_SOURCE.factsNotUsableAtOrAfterUtc),Date.parse(c.protocol.P.artifactExpiresAt)));
  const m={schema:profileSchema,issuedAt:nowIso(now),expiresAt,latestStartAt:nowIso(Date.parse(expiresAt)-3600000),nonce,
    operatorSourceCommit:BUYER_SOURCE.callerCommit,sourceCiRunId:BUYER_SOURCE.callerCiRun,callerWorkflowId:BUYER_SOURCE.callerWorkflowId,
    sourcePins:await c.pins(),riskSha256:hash((await c.files.readText(path.join(checkout,risky))).replaceAll('\r\n','\n')),
    candidate:c.protocol.P,reusableCommit:BUYER_SOURCE.reusableCommit,scope:BUYER_SOURCE_LIMITS};
  const text=JSON.stringify(m);c.context.validateOuter(text,hash(text),now);
  await c.clean(m);
  return {schema:sectionSchema,checkout,operatorSha256:await operatorSha(),review:m};
}

export function approvedBuyerForwardSource(text,sha,runnerSha,now=Date.now()){
  need(typeof text==='string'&&text.length<250000&&hex64.test(sha??'')&&hash(text)===sha,'COMBINED_APPROVAL_SHA');
  const m=JSON.parse(text),section=m?.platformPublication?.source;
  need(m.schema===packageSchema&&m.status==='READY_FOR_EXECUTION'&&m.jobId==='job_fc41597f9b5ba8e02b338ecf'&&
    m.authorization?.firstOpenApproved===false&&m.authorization?.windowAllocated===false&&
    m.reuse?.preparationNotUsableAtOrAfterUtc===BUYER_SOURCE.factsNotUsableAtOrAfterUtc&&
    now+3600000<=Date.parse(m.reuse.preparationNotUsableAtOrAfterUtc),'COMBINED_APPROVAL_SCOPE');
  need(section?.schema===sectionSchema&&hex64.test(runnerSha)&&section.operatorSha256===runnerSha&&
    section.review?.operatorSourceCommit===BUYER_SOURCE.callerCommit,'OPERATOR_PIN');
  return section;
}

export async function runApprovedBuyerForwardSource(file,approvedSha,notify=console.log){
  // Validate the reviewed file before loading any credential/provider module.
  const s=await lstat(file);need(s.isFile()&&!s.isSymbolicLink()&&s.size<250000,'APPROVAL_FILE');
  const outer=await readFile(file,'utf8'),section=approvedBuyerForwardSource(outer,approvedSha,await operatorSha());
  const c=await checkedCheckout(section.checkout),text=JSON.stringify(section.review),sha=hash(text);
  const m=c.context.validateOuter(text,sha);
  await c.clean(m);
  need(hash((await c.files.readText(path.join(c.checkout,risky))).replaceAll('\r\n','\n'))===m.riskSha256,'RISK_EVIDENCE_DRIFT');
  const intent=path.join(c.files.EVIDENCE,BUYER_SOURCE.intentFile);
  await c.files.absent(intent);
  await verifiedDependencyRoots(c.checkout);
  const evidence=await c.files.directory('techlong-platform-recovery-image-v1-'+m.nonce,{prefix:'techlong-platform-recovery-image-v1'});
  const record=(name,value)=>{
    need(/^[a-z0-9-]+$/.test(name),'RECORD_NAME');
    return c.files.writeOnce(path.join(evidence,name+'.json'),value);
  };
  const [{runControlled,errorCode},{createAws,verifySnapshot},{createGithub},{lockedPublisherFoundation}]=await Promise.all([
    c.load('ops/platform-image-source-v2/runner.mjs'),c.load('ops/platform-image-source-v2/aws.mjs'),
    c.load('ops/platform-image-source-v2/github.mjs'),c.load('ops/platform-image-recovery-v2/publisher-foundation.mjs'),
  ]);
  // Capacities include worst-case polling and leave the original coordinator's
  // unconditional revoke path its own complete settling and verification budget.
  const aws=await createAws({protocol:c.protocol,request:c.context.updateRequest,sourceLogin:true,
    metadataLimit:BUYER_SOURCE_LIMITS.awsMetadata,stsLimit:BUYER_SOURCE_LIMITS.sourceSts});
  const gh=createGithub({context:c.context,maxGets:BUYER_SOURCE_LIMITS.githubGets});
  let before,terminal;
  const refs=v=>JSON.stringify({boundary:v.boundary.Policy,repositories:v.repository.repositories,
    tags:[...(v.role.Role.Tags??[])].sort((a,b)=>a.Key.localeCompare(b.Key)),
    stackTags:[...(v.stack.Stacks[0].Tags??[])].sort((a,b)=>a.Key.localeCompare(b.Key))});
  const stable=after=>need(refs(after)===refs(before),'REFERENCES_CHANGED');
  const locked=lockedPublisherFoundation();
  locked.Resources.PlatformImagePublisher.Properties.Policies[0].PolicyDocument={Version:'2012-10-17',
    Statement:[{Sid:'LockedDenyAllEcr',Effect:'Deny',Action:['ecr:*'],Resource:'*'}]};
  const settle=async phase=>{try{await aws.settled(Date.now()+10*60000);}catch(e){
    try{await record(phase+'-settle-error',{code:errorCode(e)});}catch{}
  }};
  try{
    const result=await runControlled({text,approvedSha:sha,review:c.context,ports:{
      async preflight(){
        const head=await c.clean(m);await c.files.absent(intent);
        before=await aws.snapshot();verifySnapshot(before,locked);c.protocol.verifyRetained(before.images);
        await record('preflight-aws',before);await record('preflight-github',await gh.metadata(head,m));
        need(await c.clean(m)===head&&Date.now()-Date.parse(before.startedAtUtc)<120000,'LIVE_PREFLIGHT_EXPIRED');
        return head;
      },
      consume:value=>c.files.writeOnce(intent,{...value,combinedApprovalSha256:approvedSha,artifactId:BUYER_SOURCE.artifactId}),
      record,
      async update(inner,phase){
        terminal=inner;
        if(phase==='grant'){
          await c.clean(m);await record('grant-intent',{stackId:c.protocol.P.stackId,automaticRetry:false});
        }else{
          // The one revoke attempt does not depend on review expiry, clean
          // checkout, successful dispatch, or writing this audit record.
          await settle('revoke-before');
          try{await record('revoke-intent',{stackId:c.protocol.P.stackId,automaticRetry:false});}catch{}
        }
        await record(phase+'-ack',await aws.update(inner,phase));
      },
      async verify(inner,phase){
        await settle(phase+'-verify');
        const v=await aws.snapshot();verifySnapshot(v,c.protocol.templates(inner)[phase]);stable(v);
        if(phase==='grant')c.protocol.verifyRetained(v.images);
        await record(phase+'-independent-readback',v);
      },
      async dispatch(inner,value,digest){
        await c.clean(m);await record('dispatch-intent',{reviewSha256:digest,automaticRetry:false});
        return gh.dispatch(inner,value,digest);
      },
      wait:(ack,inner,value,id)=>gh.wait(ack,inner,value,id,async v=>{await record('awaiting-human-environment',v);notify(v);}),
      async published(){
        const r=await aws.published();await record('independent-registry-manifest',r);
        const v=await aws.snapshot();verifySnapshot(v,c.protocol.templates(terminal).revoke);stable(v);
        c.protocol.verifyFinalInventory(v.images,r.verified.manifestDigest);await record('final-independent-readback',v);
        return r.verified;
      },
    }});
    return {result,evidence,counts:{aws:{...aws.counts},github:{...gh.counts}}};
  }finally{aws.close();gh.close();}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const [mode,file,approval,...extra]=process.argv.slice(2);
  Promise.resolve().then(()=>{
    need(!extra.length&&((mode==='PrepareOffline'&&file&&!approval)||
      (mode==='RunReviewed'&&file&&hex64.test(approval??''))),'CLI_ARGUMENTS');
    return mode==='PrepareOffline'?prepareBuyerForwardSource(path.resolve(file)):runApprovedBuyerForwardSource(path.resolve(file),approval,
      v=>console.log(JSON.stringify(v)));
  }).then(r=>{console.log(JSON.stringify(r));if(r.result?.outcome==='REQUIRES_INDEPENDENT_INSPECT')process.exitCode=2;})
    .catch(e=>{console.error(JSON.stringify({outcome:'BUYER_SOURCE_STOPPED',code:/^[A-Z_0-9]+$/.test(e.message??'')?e.message:'LOCAL_OR_PROVIDER_FAILURE',automaticRetry:false}));process.exitCode=1;});
}
