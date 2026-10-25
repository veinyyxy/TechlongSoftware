// Reviewed operator protocol. Never opens a default connection or finds auth.
import {sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {DATABASE_V6 as D} from '../platform-publisher-v6/io.mjs';
import {normalizedState} from '../platform-request-v6/transfer.mjs';
import {assertEvidenceSafeV5} from '../cloud-worker/cloud-evidence-v5.mjs';
import {makeRecoveryRequestReview,verifyRecoveryRequestReadback} from './request.mjs';
import {recoveryData,must,same} from './basis.mjs';
export const REQUEST_RISK='docs/aws-auto-deployment-w9f-recovery-entry-bridge.md';
export async function makeRequestOperatorReview({basis,sourceCommit,pins,ci,auth,createdAt}){
  const d=recoveryData(basis,createdAt),core=await makeRecoveryRequestReview({basis,sourceCommit,createdAt});
  must(ci?.sourceCommit===sourceCommit&&ci.attempt===1&&ci.status==='completed'&&ci.conclusion==='success'&&
    /^[1-9][0-9]*$/.test(ci.runId)&&/^[1-9][0-9]*$/.test(ci.jobId),'REQUEST_CI');
  must(Array.isArray(pins)&&pins.length>=20&&new Set(pins.map(p=>p.file)).size===pins.length&&pins.every(p=>
    typeof p.file==='string'&&!p.file.includes('..')&&!p.file.includes('.env')&&!/\.pem$/.test(p.file)&&/^[a-f0-9]{64}$/.test(p.sha256)),'REQUEST_PINS');
  must(auth?.contentRead===false&&Number.isSafeInteger(auth.length)&&auth.length>0&&auth.length<=131072&&/^[a-f0-9]{64}$/.test(auth.aclSha256),'REQUEST_AUTH_METADATA');
  const body={schema:'techlong/recovery-request-operator-review/v1',basis,sourceCommit,pins,ci,auth,core,database:D,
    createdAt,expiresAt:core.expiresAt,latestStartAt:core.latestStartAt,configPath:'E:/NodejsProject/TechlongSoftware/.env.local',
    writeSlot:d.target.requestSlot,inspectSlot:d.target.requestSlot+'.inspect.json',riskFile:REQUEST_RISK,
    effects:{runConfigReadsMax:1,runTlsConnectionsMax:1,insertedHeldRowsMax:1,oldRowUpdates:0,runSqlCallsMax:80,
      inspectConfigReadsMax:1,inspectTlsConnectionsMax:1,inspectSqlCallsMax:80,awsCalls:0,dispatches:0,retries:0},
    risks:{wholeConfigInMemory:true,ownerCredentialHasBroadExistingPrivileges:true,providerAndLocalLogsPossible:true,
      shortWriteLocks:true,metadataIsNotCas:true,commitAckMayBeUnknown:true,permanentSlotsNeverReset:true,noAutomaticRetryOrCompensation:true},
    preparationIsNotApproval:true,executionAuthorized:false,requestEntryImplemented:true,cloudRecoveryPublished:false};
  assertEvidenceSafeV5(body);return {...body,manifestSha256:await sha256Hex(body)};
}
export async function verifyRequestOperatorReview(m,basis,approved,at,{inspect=false}={}){
  must(same(m,await makeRequestOperatorReview({...m,basis}))&&approved===m.manifestSha256&&Number.isSafeInteger(at)&&
    (inspect||at>=m.createdAt&&at<m.latestStartAt),'REQUEST_OPERATOR_APPROVAL');
  if(!inspect)recoveryData(basis,at);
}
export async function runRequestOperator({mode,manifest:m,basis,approved,io,now=Date.now}){
  must(['RunReviewed','Inspect'].includes(mode),'REQUEST_OPERATOR_MODE');
  // Invalid approval has no port side effects, including source/metadata reads.
  await verifyRequestOperatorReview(m,basis,approved,now(),{inspect:mode==='Inspect'});
  let db,phase='SOURCE';const close=async()=>{const d=db;db=null;await d?.close();};
  const guard=async()=>{await verifyRequestOperatorReview(m,basis,approved,now(),{inspect:mode==='Inspect'});await io.assertSource(m);};
  try{
    await guard();await io.verifyCi(m.ci.runId,m.sourceCommit);must(same(await io.authMetadata(),m.auth),'REQUEST_AUTH_DRIFT');
    if(mode==='Inspect'){
      phase='WRITER_RECEIPT';const r=await io.writerReceipt();
      must(r.claim.manifestSha256===approved&&r.claim.coreSha256===m.core.manifestSha256&&r.claim.sourceCommit===m.sourceCommit&&
        r.claim.basisSha256===basis.basisSha256&&r.claim.newJobId===m.core.target.newJobId,'REQUEST_WRITER_CLAIM');
      const intent=r.intent;if(intent)must(intent.manifestSha256===m.core.manifestSha256&&intent.basisSha256===basis.basisSha256&&
        intent.newJobId===m.core.target.newJobId&&intent.stateSha256===basis.stateSha256&&Number.isSafeInteger(intent.at)&&
        intent.at>=m.createdAt&&intent.at<m.expiresAt,'REQUEST_WRITER_INTENT');
      phase='INSPECT_SLOT';await io.claimInspect({manifestSha256:approved,sourceCommit:m.sourceCommit,basisSha256:basis.basisSha256});
      phase='INSPECT_OPEN';db=await io.open(m.auth,{inspect:true});const after=normalizedState(await db.readOnly());
      const before=recoveryData(basis,m.createdAt).state;
      let result;
      if(same(after,before))result={outcome:'RECOVERY_REQUEST_ABSENT_INDEPENDENTLY_OBSERVED',executionAuthorized:false,retryAllowed:false};
      else{must(intent,'REQUEST_WRITER_INTENT_REQUIRED_FOR_CHANGED_STATE');result={...await verifyRecoveryRequestReadback(basis,after,intent.at),outcome:'RECOVERY_HELD_REQUEST_INDEPENDENTLY_VERIFIED',executionAuthorized:false};}
      await io.record('independent-state',after);await close();await io.record('result',result);return result;
    }
    phase='PREFLIGHT_OPEN';db=await io.open(m.auth,{inspect:false,assertApproved:guard,claimPermanent:async v=>{
      must(v.slot===m.writeSlot&&v.basisSha256===basis.basisSha256&&v.manifestSha256===m.core.manifestSha256&&v.newJobId===m.core.target.newJobId,'REQUEST_CLAIM_BINDING');
      await guard();await io.claimWrite({manifestSha256:approved,coreSha256:m.core.manifestSha256,sourceCommit:m.sourceCommit,basisSha256:basis.basisSha256,newJobId:v.newJobId});
    }});
    phase='PREFLIGHT_STATE';const before=normalizedState(await db.readOnly());must(same(before,recoveryData(basis,now()).state),'REQUEST_PREFLIGHT_DRIFT');
    await io.record('preflight-state',before);await guard();phase='TRANSACTION';
    const result=await db.transaction({review:m.core,basis,approved:m.core.manifestSha256});
    await close();await io.record('result',result);return result;
  }catch(e){const result={outcome:'RECOVERY_REQUEST_OPERATOR_STOPPED_REQUIRES_READBACK',mode,phase,
    code:/^(?:RECOVERY_V1|TRANSFER_ENTRY)_[A-Z0-9_]+$/.test(e?.message??'')?e.message:null,
    sqlState:/^[A-Z0-9]{5}$/.test(e?.code??'')?e.code:null,detailsWithheld:true,executionAuthorized:false,retryAllowed:false};
    await io.record('stopped',result);return result;
  }finally{await close();}
}
