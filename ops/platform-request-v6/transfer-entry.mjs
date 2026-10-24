// Reviewed mode protocol. All filesystem/private/SQL capabilities are injected.
import {sha256Hex,canonicalJson} from '../../lib/deployments/execution/hash.ts';
import {prepareTransferReview,assertTransferReview,assertTransferState,normalizedState,verifyTransferReadback,createReviewedTransfer,TRANSFER} from './transfer.mjs';
import {DATABASE_V6} from '../platform-publisher-v6/io.mjs';
import {assertEvidenceSafeV5} from '../cloud-worker/cloud-evidence-v5.mjs';
import {assertAdmissionSnapshot} from './transfer-state.mjs';
export const ENTRY=Object.freeze({slot:'F:/ChatGPT_workshop/techlong-w8r-task-transfer.intent.json',
  inspectSlot:'F:/ChatGPT_workshop/techlong-w8r-task-transfer-inspect.intent.json',
  riskFile:'docs/aws-auto-deployment-platform-w8r-task-transfer-review.md',configPath:'E:/NodejsProject/TechlongSoftware/.env.local'});
export const must=(ok,c)=>{if(!ok)throw Error('TRANSFER_ENTRY_'+c);};
const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
export async function makeOperatorReview({baseline,sourceCommit,pins,ci,auth,createdAt}){
  must(ci.sourceCommit===sourceCommit&&ci.attempt===1&&ci.status==='completed'&&ci.conclusion==='success'&&/^\d+$/.test(ci.runId)&&/^\d+$/.test(ci.jobId),'CI');
  must(pins.length>=10&&new Set(pins.map(p=>p.file)).size===pins.length&&pins.every(p=>typeof p.file==='string'&&!p.file.includes('..')&&!p.file.includes('.env')&&
    !/\.pem$/.test(p.file)&&/^[a-f0-9]{64}$/.test(p.sha256)),'PINS');
  must(auth.contentRead===false&&Number.isSafeInteger(auth.length)&&auth.length>0&&auth.length<=131072&&/^[a-f0-9]{64}$/.test(auth.aclSha256),'AUTH_METADATA');
  assertAdmissionSnapshot(baseline.deployment,createdAt);
  const core=await prepareTransferReview({baseline,sourceCommit,createdAt}),body={schema:'techlong/platform-task-transfer-operator-review/v6',
    sourceCommit,pins,ci,auth,core,createdAt,expiresAt:core.expiresAt,latestStartAt:core.expiresAt-120000,database:DATABASE_V6,entry:ENTRY,
    effects:{runConfigReadsMax:1,runConnectionsMax:1,runTaskRowsMax:2,independentConfigReadsMax:1,independentConnectionsMax:1,
      awsCalls:0,controllerWrites:0,iamChanges:0,workflowDispatches:0,automaticRetries:0},preparationIsNotApproval:true};
  assertEvidenceSafeV5(body);return {...body,manifestSha256:await sha256Hex(body)};
}
export async function verifyOperatorReview(m,approved,at,inspect=false){
  const rebuilt=await makeOperatorReview({baseline:m.core.baseline,sourceCommit:m.sourceCommit,pins:m.pins,ci:m.ci,auth:m.auth,createdAt:m.createdAt});
  must(same(m,rebuilt)&&approved===m.manifestSha256&&(inspect||at>=m.createdAt&&at<m.latestStartAt),'APPROVAL');
  await assertTransferReview(m.core,m.core.manifestSha256,inspect?m.createdAt:at);return m;
}
export async function prepareOperator({ciRun,io,now=Date.now}){
  let db;const close=async()=>{const p=db;db=null;await p?.close();};try{
    const sourceCommit=await io.assertSource(),ci=await io.verifyCi(ciRun,sourceCommit),pins=await io.sourcePins(),auth=await io.authMetadata();
    db=await io.open(auth);const baseline=await db.readOnly();await close();
    const m=await makeOperatorReview({baseline,sourceCommit,pins,ci,auth,createdAt:now()});
    await io.assertSource(m);await io.record('manifest',m);
    const result={outcome:'TASK_TRANSFER_PREPARED_NOT_APPROVED',manifestSha256:m.manifestSha256,sourceCommit,
      expiresAtUtc:new Date(m.expiresAt).toISOString(),latestStartAtUtc:new Date(m.latestStartAt).toISOString(),
      configReads:1,connections:1,sqlMutationSubmissions:0,awsCalls:0,slotsConsumed:0,executionApproved:false};
    await io.record('result',result);return result;
  }finally{await close();}
}
export async function runOperatorMode({mode,manifest:m,approved,io,now=Date.now}){
  must(['RunReviewed','Inspect'].includes(mode),'MODE');let db,phase='APPROVAL';const close=async()=>{const p=db;db=null;await p?.close();};
  try{
    await verifyOperatorReview(m,approved,now(),mode==='Inspect');phase='SOURCE';await io.assertSource(m);await io.verifyCi(m.ci.runId,m.sourceCommit);
    must(same(await io.authMetadata(),m.auth),'AUTH_CHANGED');
    if(mode==='Inspect'){
      phase='WRITER_RECEIPT';const receipt=await io.writerReceipt();must(receipt.claim.manifestSha256===approved&&receipt.claim.sourceCommit===m.sourceCommit&&
        receipt.claim.oldJobId===TRANSFER.oldJobId&&receipt.claim.newJobId===TRANSFER.newJobId,'WRITER_CLAIM');
      phase='INSPECT_SLOT';await io.claimInspect({manifestSha256:approved,sourceCommit:m.sourceCommit});
      phase='INSPECT_OPEN';db=await io.open(m.auth);const after=normalizedState(await db.readOnly());let result;
      if(same(after,m.core.baseline))result={outcome:'TASK_TRANSFER_NOT_APPLIED_INDEPENDENTLY_OBSERVED',retryAllowed:false,executionApproved:false};
      else{
        const intent=receipt.intent;must(intent&&Number.isSafeInteger(intent.at)&&intent.oldJobId===TRANSFER.oldJobId&&intent.newJobId===TRANSFER.newJobId&&
          intent.baselineSha256===m.core.baselineSha256,'INTENT');
        result={...await verifyTransferReadback(m.core.baseline,after,intent.at),outcome:'TASK_TRANSFER_INDEPENDENTLY_VERIFIED_HELD_ONLY'};
      }
      await io.record('independent-state',after);phase='CLOSE';await close();await io.record('result',result);return result;
    }
    phase='PREFLIGHT_OPEN';db=await io.open(m.auth);const observed=await db.readOnly();await io.record('preflight',observed);
    const before=await assertTransferState(observed,now());must(same(before,m.core.baseline),'BASELINE_DRIFT');
    const run=createReviewedTransfer({review:m.core,approved:m.core.manifestSha256,now,io:{
      assertSource:async()=>{await verifyOperatorReview(m,approved,now());await io.assertSource(m);},
      claim:async()=>{phase='WRITE_SLOT';await io.claimWrite({manifestSha256:approved,sourceCommit:m.sourceCommit,oldJobId:TRANSFER.oldJobId,newJobId:TRANSFER.newJobId});},
      transaction:async input=>{phase='TRANSACTION';return db.transaction(input);}}});
    const result=await run();phase='CLOSE';await close();await io.record('result',result);return result;
  }catch(e){
    const result={outcome:'TASK_TRANSFER_OPERATOR_STOPPED_REQUIRES_READBACK',mode,phase,retryAllowed:false,
      code:/^(?:TRANSFER_ENTRY|TASK_TRANSFER|TRANSFER_STATE)_[A-Z_]+$/.test(e?.message??'')?e.message:'DETAILS_WITHHELD',
      sqlState:/^[A-Z0-9]{5}$/.test(e?.code??'')?e.code:null,executionApproved:false};
    await io.record('stopped',result);return result;
  }finally{await close();}
}
