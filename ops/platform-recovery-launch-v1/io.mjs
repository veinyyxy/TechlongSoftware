// Used only by the explicitly approved CLI. No I/O happens on import.
import pg from 'pg';
import {fromLoginCredentials} from '@aws-sdk/credential-provider-login';
import {STSClient,GetCallerIdentityCommand} from '@aws-sdk/client-sts';
import {S3Client} from '@aws-sdk/client-s3';
import {readAuthV6} from '../platform-local-v6/local.mjs';
import {createPublisherDatabaseV6,publisherDatabaseConfigV6,createPublisherReadsV6,DATABASE_V6} from '../platform-publisher-v6/io.mjs';
import {readRecoveryRequestState} from '../platform-recovery-v1/request-state.mjs';
import {sqlContract,I} from '../platform-controller-review-v6/install.mjs';
import {readText,ROOT} from '../platform-image-source-v2/files.mjs';
import {P} from '../platform-recovery-hosting-v1/plan.mjs';
import {must} from './operation.mjs';
const OBSERVE='SELECT deployment_control_v6.observe_run($1,$2,$3,$4)';
export function sqlGate(operation){
  let halted=false;const counts={queries:0,observations:0};
  return {counts,halt:()=>{halted=true;},check(text,readOnly){
    must((!halted||text==='ROLLBACK')&&++counts.queries<=100,'SQL_BUDGET');
    const writes=/^SELECT deployment_control_v6\.(?:publish_plan|attest_evidence|observe_run)\(/.test(text);
    if(writes){must(!readOnly,'READ_CLIENT_WRITE');if(text===OBSERVE)must(['AdvanceReview','AdvanceRunOnce'].includes(operation)&&++counts.observations===1,'OBSERVATION_BUDGET');}
    else must(/^SELECT\b/.test(text)||['BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY','COMMIT','ROLLBACK','SET LOCAL search_path=pg_catalog'].includes(text),'SQL_OPERATION');
  }};
}
export async function readLaunchSnapshot(reader,{contract,readState=readRecoveryRequestState}){
  await reader.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try{
    // Match the original reviewed reader: object-definition fingerprints depend
    // on visibility/search_path. Do not normalize hashes or relax the baseline.
    await reader.query('SET LOCAL search_path=pg_catalog');
    const v=await readState(reader,{contract,expected:DATABASE_V6});
    await reader.query('COMMIT');return v;
  }catch(e){try{await reader.query('ROLLBACK');}catch{/* Read-only cleanup only. */}throw e;}
}
export function createLiveIo({manifest:m,packageValue,record,claim,assertSource,verifyCi,githubToken,readState=readRecoveryRequestState}){
  let s3,sts,reads,credentials,db,closed=false;const counts={sts:0,s3Gets:0,githubRunGets:0,configReads:0,connections:0};
  const gate=sqlGate(m.action.operation),assertOpen=()=>must(!closed,'CLOSED');
  return {
    record,claim,assertSource,verifyCi,
    async verifySourceIdentity(){assertOpen();must(++counts.sts===1,'STS_BUDGET');
      credentials=await fromLoginCredentials({profile:P.profile,ignoreCache:true})();
      must(credentials.expiration instanceof Date&&credentials.expiration.getTime()>Date.now()+180000,'SOURCE_EXPIRY');
      sts=new STSClient({region:P.region,endpoint:'https://sts.ca-central-1.amazonaws.com',ignoreConfiguredEndpointUrls:true,maxAttempts:1,credentials});
      const v=await sts.send(new GetCallerIdentityCommand({}),{abortSignal:AbortSignal.timeout(20000)});
      must(v.Account===P.account&&v.Arn===P.sourceArn&&v.UserId===P.sourceId,'SOURCE_IDENTITY');
      s3=new S3Client({region:P.region,endpoint:'https://s3.ca-central-1.amazonaws.com',ignoreConfiguredEndpointUrls:true,maxAttempts:1,credentials});
      reads=createPublisherReadsV6({s3,fetch,githubToken:typeof githubToken==='function'?githubToken():githubToken});githubToken=undefined;
    },
    async installationReference(){return JSON.parse(packageValue.inputs.execution.plan.inputs.installation);},
    async readObject(r){assertOpen();must(reads&&++counts.s3Gets<=6,'S3_BUDGET');return reads.readObject(r);},
    async readRun(id){assertOpen();must(reads&&++counts.githubRunGets<=2,'GITHUB_BUDGET');return reads.readRun(id);},
    async open(){assertOpen();must(!db&&++counts.configReads===1,'CONFIG_BUDGET');
      let url=await readAuthV6(m.auth),config=await publisherDatabaseConfigV6(url);url=undefined;
      const clients=[];
      const connect=async readOnly=>{
        const raw=new pg.Client(config);clients.push(raw);raw.on('error',()=>gate.halt());counts.connections++;
        await raw.connect();must(raw.connection.stream.encrypted===true&&raw.connection.stream.authorized===true,'TLS');
        return {async query(text,values){gate.check(text,readOnly);await assertSource(m);
          try{return await raw.query(text,values);}catch{gate.halt();throw Error('RECOVERY_LAUNCH_SQL_REQUIRES_READBACK');}}};
      };
      const close=async()=>{gate.halt();for(const c of clients)try{await c.end();}catch{/* No reconnect/retry. */}};
      try{
        const writer=await connect(false),reader=await connect(true);config=undefined;
        const contract=sqlContract((await readText(ROOT+'/'+I.sql,3000000)).replaceAll('\r\n','\n'));
        const write=createPublisherDatabaseV6({client:writer,contract,expected:DATABASE_V6,release:m.binding.release,maxWrites:m.action.operation==='PublishReview'?1:2});
        const read=createPublisherDatabaseV6({client:reader,contract,expected:DATABASE_V6,release:m.binding.release,maxWrites:1});
        await write.verify();await read.verify();
        db={close,loadPlan:read.loadPlan,readHeldJob:read.readHeldJob,writeOwner:write.writeOwner,
          snapshot:()=>readLaunchSnapshot(reader,{contract,readState}),
          async observe(sha,id){must(['AdvanceReview','AdvanceRunOnce'].includes(m.action.operation)&&sha===m.action.planSha256&&id===m.action.runId,'EXACT_OBSERVATION');
            return writer.query(OBSERVE,[sha,id,'completed','success']);}};return db;
      }catch(e){await close();throw e;}
    },
    async close(){if(closed)return;closed=true;reads?.dispose();sts?.destroy();s3?.destroy();credentials=undefined;githubToken=undefined;
      await record('io-counts',{...counts,...gate.counts,awsWrites:0,dispatches:0,privateKeyReads:0,secretValueReads:0,automaticRetries:0});},
  };
}
