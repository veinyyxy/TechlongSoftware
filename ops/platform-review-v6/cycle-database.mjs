// Owner connection is explicit and one-use; the readback client has no write port.
import pg from 'pg';
import {readAuthV6} from '../platform-local-v6/local.mjs';
import {publisherDatabaseConfigV6,createPublisherDatabaseV6,DATABASE_V6 as D} from '../platform-publisher-v6/io.mjs';
import {ownerQueryV6} from '../platform-cloud-v6/publisher.mjs';
import {validatePlan,CONTROL_SCOPE} from '../../lib/deployments/controller-v6/contract.ts';
import {readTransferredSnapshot} from './current-database.mjs';
import {normalizedState} from '../platform-request-v6/transfer.mjs';
import {assertTransferredReviewQuery} from './transferred-cycle.mjs';
import {CYCLE,CYCLE_SCOPE,must,same} from './cycle-plan.mjs';
const planSql=ownerQueryV6('plan',{planSha256:'',actionSha256:'',plan:{riskSha256:''}}).text;
const proofSql=ownerQueryV6('proof',{planSha256:'a'.repeat(64),proofSha256:'b'.repeat(64)}).text;
export const OBSERVE_SQL='SELECT deployment_control_v6.observe_run($1,$2,$3,$4)';
export function cycleSqlGate({inspect=false}={}){
  let halted=false;const counts={queries:0,plans:0,proofs:0,observations:0};
  return {counts,halt(){halted=true;},check(text,values,readOnly){
    must((!halted||text==='ROLLBACK')&&++counts.queries<=(inspect?CYCLE_SCOPE.inspectSqlQueriesMax:CYCLE_SCOPE.runSqlQueriesMax),'SQL_BUDGET_OR_HALTED');
    const kind=text===planSql?'plans':text===proofSql?'proofs':text===OBSERVE_SQL?'observations':null;
    if(kind){must(!inspect&&!readOnly&&Array.isArray(values),'READ_CLIENT_WRITE_REJECTED');
      must(++counts[kind]<=(kind==='plans'?2:1),'WRITE_BUDGET');
    }else must(/^SELECT\b/.test(text)||['BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY','COMMIT','ROLLBACK','SET LOCAL search_path=pg_catalog'].includes(text),'SQL_OPERATION');
  }};
}
export async function verifyPublishedReview(snapshot,entry,m){
  must(same(normalizedState(snapshot.state),m.anchor.after)&&snapshot.newLedger.plans.length===1&&
    snapshot.newLedger.approvals.length===0&&snapshot.newLedger.attempts.length===0&&entry.attempt===null,'PUBLICATION_READBACK_STATE');
  await assertTransferredReviewQuery(ownerQueryV6('plan',entry),m.anchor,m.sourceCommit,entry.plan.preparedAt);
  const p=snapshot.newLedger.plans[0];must(p.plan_sha===entry.planSha256&&p.action_sha===entry.actionSha256&&p.risk_sha===entry.plan.riskSha256&&
    p.job_id===CYCLE.jobId&&p.mode==='Review'&&same(p.body,entry.plan)&&Date.parse(p.expires_at)===entry.plan.expiresAt,'PUBLICATION_READBACK_PLAN');
  return {planSha256:entry.planSha256,actionSha256:entry.actionSha256,plans:1,approvals:0,attempts:0,independentReadClient:true};
}
export async function wireCycleDatabase({writer:rawWriter,reader:rawReader,contract,manifest:m,guard,assertClaim,inspect=false,
  expected=D,gate=cycleSqlGate({inspect}),counts={configReads:0,connections:2},close=async()=>{}}){
  must(typeof assertClaim==='function','EXPLICIT_CLAIM_PORT');
  const wrap=(raw,readOnly)=>({async query(text,values){gate.check(text,values,readOnly);await guard();
    if([planSql,proofSql,OBSERVE_SQL].includes(text))await assertClaim();
    try{return await raw.query(text,values);}catch{gate.halt();throw Error('HOSTED_CYCLE_DATABASE_REQUIRES_INSPECT');}}});
    const writer=inspect?null:wrap(rawWriter,false),reader=wrap(rawReader,true);
    const make=(client,maxWrites)=>createPublisherDatabaseV6({client,contract,expected,release:m.binding.platform,maxWrites});
    const reads=make(reader,1);await reads.verify();
    const pub=writer&&make(writer,1),handoff=writer&&make(writer,2);if(pub){await pub.verify();await handoff.verify();}
    return Object.freeze({counts:()=>({...counts,...gate.counts}),
      snapshot:()=>readTransferredSnapshot(reader,{contract,expected}),loadPlan:sha=>reads.loadPlan(sha),
      readHeldJob:async id=>{must(!inspect&&id===CYCLE.jobId,'EXACT_HELD_JOB');return pub.readHeldJob(id);},
      publish:async q=>{must(!inspect,'INSPECT_READONLY');await assertTransferredReviewQuery(q,m.anchor,m.sourceCommit,Date.now());await guard();return pub.writeOwner(q);},
      advance:async q=>{
        must(!inspect,'INSPECT_READONLY');
        if(q.text===proofSql){const e=await reads.loadPlan(q.values[0]);must(e.plan.jobId===CYCLE.jobId&&e.plan.sourceCommit===m.sourceCommit&&e.plan.mode==='Review'&&
          e.attempt?.state==='OBSERVED'&&e.attempt.status==='completed'&&e.attempt.conclusion==='success'&&e.attempt.proofSha256===null,'PROOF_SCOPE');}
        else{must(q.text===planSql,'SUCCESSOR_SQL');const v=await validatePlan(JSON.parse(q.values[3]),m.binding.platform,Date.now()),p=v.plan;
          must(p.mode==='RunOnce'&&p.jobId===CYCLE.jobId&&p.sourceCommit===m.sourceCommit,'SUCCESSOR_SCOPE');
          const e=await reads.loadPlan(p.predecessor.planSha256);
          must(e.plan.jobId===CYCLE.jobId&&e.plan.sourceCommit===m.sourceCommit&&e.plan.mode==='Review'&&e.attempt?.state==='OBSERVED'&&
            e.attempt.runId===p.predecessor.runId&&e.attempt.proofSha256===p.predecessor.proofSha256&&e.attempt.proofSha256!==null&&
            p.inputs.installation===e.plan.inputs.installation&&p.inputs.lineage===e.plan.inputs.lineage,'SUCCESSOR_PREDECESSOR');}
        await guard();return handoff.writeOwner(q);
      },
      async observe(sha,o){
        must(!inspect&&o.status==='completed'&&o.conclusion==='success'&&/^[1-9][0-9]{0,15}$/.test(o.runId)&&
          o.url===`https://github.com/${CONTROL_SCOPE.repository}/actions/runs/${o.runId}`,'EXACT_OBSERVATION');
        const entry=await reads.loadPlan(sha),v=await validatePlan(entry.plan,m.binding.platform,entry.plan.preparedAt);
        must(v.planSha256===sha&&v.plan.sourceCommit===m.sourceCommit&&v.plan.jobId===CYCLE.jobId&&v.plan.mode==='Review'&&
          ['ACKNOWLEDGED','OBSERVED'].includes(entry.attempt?.state)&&entry.attempt.runId===o.runId&&entry.attempt.proofSha256===null,'OBSERVATION_LEDGER');
        await guard();return writer.query(OBSERVE_SQL,[sha,o.runId,'completed','success']);
      },
      async close(){gate.halt();await close();},
    });
}
export async function openCycleDatabase({auth,contract,manifest:m,guard,assertClaim,inspect=false}){
  const gate=cycleSqlGate({inspect}),counts={configReads:0,connections:0},opened=[];let config;
  const close=async()=>{for(const c of opened)try{await c.end();}catch{/* no reconnect */}};
  try{
    await guard();counts.configReads++;let url=await readAuthV6(auth);config=await publisherDatabaseConfigV6(url);url=undefined;
    const connect=async label=>{const c=new pg.Client({...config,options:'',application_name:'Techlong-Reviewed-Cycle-'+label});opened.push(c);c.on('error',()=>gate.halt());
      counts.connections++;await c.connect();must(c.connection.stream.encrypted===true&&c.connection.stream.authorized===true,'DATABASE_TLS');return c;};
    const writer=inspect?null:await connect('Owner'),reader=await connect('IndependentRead');config=undefined;
    return await wireCycleDatabase({writer,reader,contract,manifest:m,guard,assertClaim,inspect,gate,counts,close});
  }catch{gate.halt();for(const c of opened)try{await c.end();}catch{/* no retry */}
    throw Object.assign(Error('HOSTED_CYCLE_DATABASE_OPEN_STOPPED'),{counts:{...counts,...gate.counts}});
  }finally{config=undefined;}
}
