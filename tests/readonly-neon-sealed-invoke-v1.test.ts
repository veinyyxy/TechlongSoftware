import assert from "node:assert/strict";
import test from "node:test";
import { NEON_INVOKE_PREDECESSOR_V1 as pin, compileNeonSealedInvokeManifestV1, validateNeonSealedInvokeManifestV1, runNeonSealedInvokeV1, type NeonSealedInvokeInventoryV1, type NeonSealedInvokePortsV1, type NeonSealedInvokeManifestV1 } from "../lib/deployments/execution/readonly-neon-sealed-invoke-v1.ts";
const now=Date.parse("2026-10-11T17:00:00Z"),code="c".repeat(64);
function inventory(): NeonSealedInvokeInventoryV1 { return {observedAt:now,predecessorAnchorSha256:pin.fullAnchorSha256,stableAnchorSha256:pin.stableAnchorSha256,state:"CANDIDATE_READY",revisionId:pin.completedRevisionId,sourcePermissionsAllowed:true}; }
async function fixture(){
  const manifest=await compileNeonSealedInvokeManifestV1({inventory:inventory(),now,codeSha256:code,nonce:"a".repeat(64)}),calls:string[]=[];
  const ports:NeonSealedInvokePortsV1={now:()=>now,inventory:async()=>inventory(),claimSlot:async()=>{calls.push("slot");},marker:async name=>{calls.push(name);},invokeOnce:async()=>{
    calls.push("invoke");return {schemaVersion:1,protocol:"neon-sealed-readonly-probe-v1",functionArn:"arn:aws:lambda:ca-central-1:402010193138:function:techlong-sandbox-cell-ttl-executor-v3",nonce:manifest.event.nonce,
      requestId:"12345678-1234-1234-1234-123456789012",outcome:"NEON_SEALED_READONLY_PREFLIGHT_NOT_VERIFIED",stage:"readonly-database",errorCode:"NEON_PROBE_READ_UNVERIFIED",databaseReadAttempted:true,proof:null,runtimeEnabled:false,mutationPerformed:false,deletionAuthorized:false};
  }};
  return {manifest,calls,ports,run:()=>runNeonSealedInvokeV1({manifest,approvedSha:manifest.manifestSha256,codeSha256:code,ports})};
}
test("exact installed code allows one call only, without a code-update port",async()=>{
  const f=await fixture(),r=await f.run();assert.equal(r.codeUpdates,0);assert.equal(r.invocationAttempts,1);assert.equal(r.failureStage,null);assert.equal(r.retryAuthorized,false);
  assert.equal(f.calls.filter(x=>x==="invoke").length,1);assert.ok(!("updateCodeOnce" in f.ports));assert.equal(r.response?.outcome,"NEON_SEALED_READONLY_PREFLIGHT_NOT_VERIFIED");
});
test("expired or wrong fresh SHA cannot claim slot or invoke",async()=>{
  for(const expired of [false,true]){const f=await fixture();if(expired)f.ports.now=()=>now+3600000;
    const r=await runNeonSealedInvokeV1({manifest:f.manifest,approvedSha:expired?f.manifest.manifestSha256:"f".repeat(64),codeSha256:code,ports:f.ports});assert.equal(r.slotConsumed,false);assert.equal(f.calls.length,0);}
});
test("candidate RevisionId/full anchor/source permission drift blocks before slot",async()=>{
  for(const changes of [{revisionId:"12345678-1234-1234-1234-123456789012"},{predecessorAnchorSha256:"f".repeat(64)},{sourcePermissionsAllowed:false},{observedAt:now-31000}]){
    const f=await fixture();f.ports.inventory=async()=>({...inventory(),...changes});const r=await f.run();assert.equal(r.slotConsumed,false);assert.equal(r.invocationAttempts,0);}
});
test("consumed slot cannot be reset, adopted or retried",async()=>{
  const f=await fixture();f.ports.claimSlot=async()=>{throw new Error("EEXIST");};const r=await f.run();assert.equal(r.invocationAttempts,0);assert.equal(r.retryAuthorized,false);
});
test("failed intent marker never submits a call",async()=>{
  const f=await fixture();f.ports.marker=async name=>{if(name==="invoke-attempt.json")throw new Error("disk");};const r=await f.run();assert.equal(r.slotConsumed,true);assert.equal(r.invocationAttempts,0);
});
test("lost Invoke response remains one uncertain attempt and Inspect only",async()=>{
  const f=await fixture();f.ports.invokeOnce=async()=>{f.calls.push("invoke");throw new Error("lost response");};const r=await f.run();assert.equal(r.invocationAttempts,1);assert.equal(r.slotConsumed,true);assert.equal(r.response,null);assert.equal(r.retryAuthorized,false);
});
test("expired after claiming the slot stops without calling",async()=>{
  const f=await fixture();f.ports.marker=async()=>{f.ports.now=()=>now+3600000;};const r=await f.run();assert.equal(r.slotConsumed,true);assert.equal(r.invocationAttempts,0);
});
test("scope escalation and mutable predecessor pins are rejected even before Run",async()=>{
  const f=await fixture();await assert.rejects(validateNeonSealedInvokeManifestV1({...f.manifest,scope:{...f.manifest.scope,codeUpdates:1}} as unknown as NeonSealedInvokeManifestV1,code));
  await assert.rejects(validateNeonSealedInvokeManifestV1({...f.manifest,predecessor:{...pin,completedRevisionId:"12345678-1234-1234-1234-123456789012"}} as unknown as NeonSealedInvokeManifestV1,code));
});
