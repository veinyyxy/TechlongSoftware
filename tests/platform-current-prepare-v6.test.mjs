import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readTransferredSnapshot,NEW_LEDGER_SQL} from '../ops/platform-review-v6/current-database.mjs';
import {CURRENT_READS,verifyCurrentHosting} from '../ops/platform-review-v6/current-cloud.mjs';
import {DATABASE_V6 as D} from '../ops/platform-publisher-v6/io.mjs';
import {K} from '../ops/platform-hosted-window-v6/contract.mjs';
import {parseCurrentArgs} from '../ops/platform-review-v6/current-local.mjs';
const good={actor:D.ownerRole,session_actor:D.ownerRole,database:D.database,oid:D.ownerOid,read_only:'on',isolation:'repeatable read'};
for(const field of Object.keys(good))test('read-only database preparation rejects changed '+field+' before business reads',async()=>{
  const calls=[],client={async query(q){calls.push(q);return {rows:[{...good,[field]:'wrong'}]};}};
  await assert.rejects(readTransferredSnapshot(client,{contract:{}}),/CURRENT_DATABASE_IDENTITY_OR_TRANSACTION/);
  assert.equal(calls[0],'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');assert.equal(calls.at(-1),'ROLLBACK');
  assert.equal(calls.filter(q=>q.includes('public.deployment_jobs')).length,0);
});
test('new ledger query is parameter-bound and distinct from historical scope',()=>{
  assert.equal((NEW_LEDGER_SQL.match(/job_id=\$1/g)??[]).length,3);assert.doesNotMatch(NEW_LEDGER_SQL,/INSERT|UPDATE|DELETE|oldJobId|job_[a-f0-9]{24}/);
});
test('preparation CLI has only explicit read and saved-evidence modes, no write or retry mode',()=>{
  const args=['--mode','Collect','--ci-run','12345','--allow-config-read','yes','--output','output'];assert.equal(parseCurrentArgs(args)['--mode'],'Collect');
  assert.equal(parseCurrentArgs(['--mode','PrepareSaved','--ci-run','12345','--audit','audit','--output','output'])['--mode'],'PrepareSaved');
  for(const a of [[...args,'--mode','Collect'],args.map(v=>v==='yes'?'no':v),args.map(v=>v==='Collect'?'RunReviewed':v),
    ['--mode','PrepareSaved','--ci-run','12345','--audit','audit','--output','out','--allow-config-read','yes']])assert.throws(()=>parseCurrentArgs(a));
});
test('cloud metadata allowlist exposes no mutation, Secret value or log-content operation',()=>{
  assert(Object.values(CURRENT_READS).flat().every(op=>/^(describe|get-template|get-stack-policy|list)/.test(op)));
  assert(!Object.values(CURRENT_READS).flat().some(op=>/secret|log-events|create|update|delete|execute|put/.test(op)));
});
test('read-only production preparation sources contain no SQL writer or cloud mutation command',async()=>{
  const db=await readFile(new URL('../ops/platform-review-v6/current-database.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(db,/writeOwner|createTransferTransaction|UPDATE public|INSERT INTO|readKey|GetSecretValue/);
  const cloud=await readFile(new URL('../ops/platform-review-v6/current-cloud.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(cloud,/UpdateStackCommand|GetSecretValueCommand|PutObjectCommand|readKey|enableWrite/);
});
test('changed cloud root, active old lease or missing IAM proof is rejected before shared validator',()=>{
  const at=Date.now(),ids=Array.from({length:11},(_,i)=>({id:'id'+i,physicalId:'physical'+i}));
  const parent={outcome:'COMPATIBLE_WINDOW_INDEPENDENTLY_VERIFIED_ACCEPTANCE_PENDING',verified:{stackId:K.stackId,stackStatus:'UPDATE_COMPLETE',
    resources:ids,rootEventId:'root-fixed',controlLease:{expiresAt:at-1}}};
  const base={rawMetadata:{stack:{Stacks:[{StackId:K.stackId,DisableRollback:false}]},events:{StackEvents:[{ResourceType:'AWS::CloudFormation::Stack',
    PhysicalResourceId:K.stackId,EventId:'root-fixed',ResourceStatus:'UPDATE_COMPLETE',Timestamp:new Date(at-10000).toISOString()}]}},iam:{iamLayoutUnchanged:true}};
  for(const change of [v=>{v.iam.iamLayoutUnchanged=false;},v=>{v.rawMetadata.events.StackEvents[0].EventId='different';},
    v=>{v.rawMetadata.stack.Stacks[0].DisableRollback=true;}]){const v=structuredClone(base);change(v);assert.throws(()=>verifyCurrentHosting(v,parent,at),/CURRENT_CLOUD_PARENT_OR_CURRENT_ROOT/);}
  const active=structuredClone(parent);active.verified.controlLease.expiresAt=at+1;
  assert.throws(()=>verifyCurrentHosting(base,active,at),/CURRENT_CLOUD_PARENT_OR_CURRENT_ROOT/);
});
