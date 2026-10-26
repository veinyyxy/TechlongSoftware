// W8f: existing Source/publisher flow, fixed real candidate; no unattended runner.
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomBytes} from 'node:crypto';
import {C as LEGACY_C,protocol as LEGACY_PROTOCOL} from './candidate.mjs';
import {sourceContext as legacyContext,verifyRetained as legacyRetained,verifyFinalInventory as legacyFinal} from './source-review.mjs';
import {hash,must,same} from '../platform-image-publication-v2/plan.mjs';
import {ROOT,EVIDENCE,pins,cleanSource,readText,writeOnce,absent,directory,environment} from '../platform-image-source-v2/files.mjs';
import {createAws,verifySnapshot} from '../platform-image-source-v2/aws.mjs';
import {createGithub} from '../platform-image-source-v2/github.mjs';
import {runControlled,errorCode} from '../platform-image-source-v2/runner.mjs';
import {lockedPublisherFoundation} from '../platform-image-recovery-v2/publisher-foundation.mjs';
export const CLOUD_ROOTS=Object.freeze(['ops/platform-hosted-publication-v2/cloud.mjs','ops/platform-hosted-publication-v2/artifact.mjs',
  'ops/platform-image-publication-v2/cloud-preflight.sh','ops/platform-image-publication-v1/extract.py',
  '.github/workflows/platform-image-hosted-publish-job-v2.yml','ops/cloud-worker/package.json','ops/cloud-worker/package-lock.json']);
// Code-only composition; the legacy CLI never accepts a profile or target override.
export function sourceAdapter({candidate:C=LEGACY_C,protocol=LEGACY_PROTOCOL,sourceContext=legacyContext,
  verifyRetained=legacyRetained,verifyFinalInventory=legacyFinal,cloudRoots=CLOUD_ROOTS,
  sourceEntry='ops/platform-hosted-publication-v2/source.mjs',testFile='tests/platform-hosted-source-v2.test.mjs',
  reviewPattern=/^F:\/ChatGPT_workshop\/techlong-hosted-publication-w8f-review-[a-z0-9-]+\.json$/,
  directoryPrefix='techlong-platform-hosted-source-v2',inspectPrefix='techlong-hosted-publication-w8f-inspect',
  metadataFiles=['README.md','docs/aws-auto-deployment-mainline.md','ops/aws-sandbox/reviews/platform-hosted-publication-w8f.verified.json']}={}){
function fileContext(review){
  const roots=[sourceEntry,review.S.riskFile,`.github/workflows/${review.S.sourceCiFile}`,
    `.github/workflows/${C.callerFile}`,testFile,'package.json','package-lock.json',...cloudRoots];
  const options={settings:review.S,roots,frozenRoots:cloudRoots,metadataFiles:[...metadataFiles,review.S.publicReviewFile]};
  return {pins:()=>pins(options),clean:m=>cleanSource(m,options)};
}
function cloud(review){environment();return createAws({protocol,request:review.updateRequest,sourceLogin:true});}
function lockedTemplate(inner){return protocol.templates(inner).revoke;}
function initial(v){
  // This lineage begins after the old publication: trust+inline are Locked and
  // exactly the retained image exists. Never call the legacy empty-ECR verifier.
  const expected=lockedPublisherFoundation();
  expected.Resources.PlatformImagePublisher.Properties.Policies[0].PolicyDocument={Version:'2012-10-17',
    Statement:[{Sid:'LockedDenyAllEcr',Effect:'Deny',Action:['ecr:*'],Resource:'*'}]};
  verifySnapshot(v,expected);verifyRetained(v.images);
}
function references(v){return {boundary:v.boundary.Policy,repository:v.repository.repositories,
  roleTags:[...(v.role.Role.Tags??[])].sort((a,b)=>a.Key.localeCompare(b.Key)),
  stackTags:[...(v.stack.Stacks[0].Tags??[])].sort((a,b)=>a.Key.localeCompare(b.Key))};}
async function revokeOnce(aws,record,inner){
  // The cloud adapter itself enforces one submission per phase. Recording a
  // cleanup intent/ACK may fail, but must not prevent the one revoke attempt.
  try{await aws.settled(Date.now()+10*60000);}catch(e){try{await record('revoke-wait-error',{code:errorCode(e)});}catch{}}
  try{await record('revoke-intent',{stackId:C.stackId,template:lockedTemplate(inner),automaticRetry:false});}catch{}
  const ack=await aws.update(inner,'revoke');await record('revoke-ack',ack);
}
async function prepare(output,ciRun){
  const review=sourceContext(),files=fileContext(review);
  must(reviewPattern.test(output??'')&&
    /^[1-9][0-9]{5,19}$/.test(ciRun??''),'HOSTED_PREPARE_ARGUMENTS');
  await absent(output);await absent(path.join(EVIDENCE,review.S.intentFile));
  const head=await files.clean(),aws=await cloud(review),gh=createGithub({context:review});
  try{
    const snapshot=await aws.snapshot();initial(snapshot);
    const metadata=await gh.metadata(head,undefined,{sourceCiRunId:Number(ciRun)}),sourcePins=await files.pins();
    const operatorSourceCommit=metadata.sourceCi.head_sha;
    await files.clean({operatorSourceCommit,sourcePins});
    const issued=Date.now(),end=Math.min(issued+48*3600000,Date.parse(C.artifactExpiresAt));
    const m={schema:review.S.schema,issuedAt:new Date(issued).toISOString(),expiresAt:new Date(end).toISOString(),
      latestStartAt:new Date(end-3600000).toISOString(),nonce:randomBytes(16).toString('hex'),operatorSourceCommit,
      sourceCiRunId:metadata.sourceCi.id,callerWorkflowId:metadata.workflow.id,sourcePins,
      riskSha256:hash((await readText(path.join(ROOT,review.S.riskFile))).replaceAll('\r\n','\n')),
      candidate:{...C},reusableCommit:review.S.reusableCommit,scope:{...review.S.scope}};
    const text=JSON.stringify(m,null,2)+'\n';review.validateOuter(text,hash(text));
    await writeOnce(output+'.facts.json',{snapshot,metadata,cloudWrites:0,privateValueReads:0});await writeOnce(output,m);
    return {mode:'Prepare',output,manifestSha256:hash(text),expiresAt:m.expiresAt,latestStartAt:m.latestStartAt,
      grantWindow:'Maximum one hour from RunReviewed, never beyond approved deadline',cloudWrites:0};
  }finally{aws.close();gh.close();}
}
async function run(file,sha,notify=console.log){
  must(/^[a-f0-9]{64}$/.test(sha??''),'HOSTED_NEW_APPROVAL_REQUIRED');
  const review=sourceContext(),text=await readText(file),m=review.validateOuter(text,sha),files=fileContext(review);
  await files.clean(m);must(hash((await readText(path.join(ROOT,review.S.riskFile))).replaceAll('\r\n','\n'))===m.riskSha256,'HOSTED_RISK_DRIFT');
  const intent=path.join(EVIDENCE,review.S.intentFile);await absent(intent);
  const dir=await directory(directoryPrefix+'-'+m.nonce,{prefix:directoryPrefix});
  const record=(name,value)=>{must(/^[a-z0-9-]+$/.test(name),'HOSTED_RECORD_NAME');return writeOnce(path.join(dir,name+'.json'),value);};
  const aws=await cloud(review),gh=createGithub({context:review});let before,executedInner;
  try{
    const result=await runControlled({text,approvedSha:sha,review,ports:{
      async preflight(){
        const head=await files.clean(m);await absent(intent);before=await aws.snapshot();await record('preflight-aws',before);initial(before);
        await record('preflight-github',await gh.metadata(head,m));
        must(await files.clean(m)===head&&Date.now()-Date.parse(before.startedAtUtc)<120000,'HOSTED_PREFLIGHT_FRESHNESS');return head;
      },consume:v=>writeOnce(intent,v),record,
      async update(inner,phase){
        executedInner=inner;
        if(phase==='revoke'){
          // Audit I/O and old Source/approval drift cannot suppress cleanup.
          await revokeOnce(aws,record,inner);return;
        }
        must(await files.clean(m)===inner.dispatchCommit,'HOSTED_GRANT_HEAD');
        await record('grant-intent',{stackId:C.stackId,template:protocol.templates(inner).grant,automaticRetry:false});
        await record('grant-ack',await aws.update(inner,'grant'));
      },
      async verify(inner,phase){
        try{await aws.settled(Date.now()+10*60000);}catch(e){await record(phase+'-settle-error',{code:errorCode(e)});}
        const snapshot=await aws.snapshot();await record(phase+'-independent-readback',snapshot);
        verifySnapshot(snapshot,protocol.templates(inner)[phase]);
        must(same(references(snapshot),references(before)),'HOSTED_REFERENCES_CHANGED');
        if(phase==='grant')verifyRetained(snapshot.images);
      },
      async dispatch(inner,innerText,innerSha){
        must(await files.clean(m)===inner.dispatchCommit,'HOSTED_DISPATCH_HEAD');
        await record('dispatch-intent',{sha256:innerSha,head:inner.dispatchCommit,automaticRetry:false});return gh.dispatch(inner,innerText,innerSha);
      },wait:(ack,inner,innerSha,id)=>gh.wait(ack,inner,innerSha,id,async v=>{await record('awaiting-human-environment',v);notify(JSON.stringify(v));}),
      async published(){
        const r=await aws.published();await record('independent-registry-manifest',r);
        const snapshot=await aws.snapshot();await record('final-independent-readback',snapshot);
        verifySnapshot(snapshot,lockedTemplate(executedInner));verifyFinalInventory(snapshot.images,r.verified.manifestDigest);
        must(same(references(snapshot),references(before)),'HOSTED_FINAL_REFERENCES_CHANGED');return r.verified;
      },
    }});return {mode:'RunReviewed',output:path.join(dir,'result.json'),...result};
  }finally{aws.close();gh.close();}
}
async function inspect(file,sha){
  const review=sourceContext(),text=await readText(file),m=review.validateOuter(text,sha,Date.parse(JSON.parse(text).issuedAt));
  const intent=JSON.parse(await readText(path.join(EVIDENCE,review.S.intentFile)));
  must(intent.outerSha256===sha&&intent.nonce===m.nonce&&hash(intent.innerReview)===intent.innerSha256,'HOSTED_AUDIT_BINDING');
  const inner=protocol.validateReview(intent.innerReview,intent.innerSha256,Date.parse(JSON.parse(intent.innerReview).issuedAt));
  must(inner.nonce===m.nonce,'HOSTED_AUDIT_NONCE');const aws=await cloud(review),errors=[];let published;
  try{
    const snapshot=await aws.snapshot();let locked=false;
    try{verifySnapshot(snapshot,lockedTemplate(inner));locked=true;}catch(e){errors.push(errorCode(e));}
    try{published=await aws.published();verifyFinalInventory(snapshot.images,published.verified.manifestDigest);}catch(e){errors.push(errorCode(e));}
    const output=path.join(EVIDENCE,inspectPrefix+'-'+Date.now()+'.json');
    const result={mode:'Inspect',outcome:locked&&!errors.length?'LOCKED_PUBLISHED_INDEPENDENTLY_VERIFIED':locked?'LOCKED_PUBLICATION_NOT_PROVED':'LOCK_NOT_PROVED',
      locked,snapshot,published:published??null,errors,cloudWrites:0};await writeOnce(output,result);
    return {mode:'Inspect',output,outcome:result.outcome,locked,errors,cloudWrites:0};
  }finally{aws.close();}
}
async function main(args=process.argv.slice(2)){
  const [mode,file,value,...extra]=args;
  must(!extra.length&&file&&value&&['Prepare','RunReviewed','Inspect'].includes(mode),'HOSTED_SOURCE_ARGUMENTS');
  return mode==='Prepare'?prepare(file,value):mode==='RunReviewed'?run(file,value):inspect(file,value);
}
return Object.freeze({main,revokeOnce});
}
const legacy=sourceAdapter();
export const main=(...args)=>legacy.main(...args);
export const revokeOnce=(...args)=>legacy.revokeOnce(...args);
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main()
  .then(r=>{console.log(JSON.stringify(r));if(r.outcome==='REQUIRES_INDEPENDENT_INSPECT')process.exitCode=2;})
  .catch(e=>{console.error(JSON.stringify({outcome:'HOSTED_SOURCE_STOPPED',errorCode:errorCode(e),automaticRetry:false}));process.exitCode=1;});
