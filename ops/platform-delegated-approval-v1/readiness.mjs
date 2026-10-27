// Separately authorized preparation only: one owner config read/one TLS connection.
import pg from 'pg';
import {readAuthV6} from '../platform-local-v6/local.mjs';
import {publisherDatabaseConfigV6,createPublisherDatabaseV6,DATABASE_V6} from '../platform-publisher-v6/io.mjs';
import {sqlContract,I} from '../platform-controller-review-v6/install.mjs';
import {ROOT,readText} from '../platform-image-source-v2/files.mjs';
import {RECOVERY_CONTROL_BINDING as B} from '../platform-recovery-control-v1/binding.mjs';
import {D,must,historyProof} from './policy.mjs';
export function readonlyQuery(text){must(!/^SELECT deployment_control_v6\./.test(text)||text==='SELECT deployment_control_v6.status() AS value','READONLY_RPC');
  must(/^SELECT\b/.test(text)||['BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY','SET LOCAL search_path=pg_catalog','COMMIT','ROLLBACK'].includes(text),'READONLY_SQL');}
export async function captureReadiness({auth,guard,record}){let c;const counts={configReads:0,connections:0,queries:0,writes:0};
  try{await guard();counts.configReads++;let url=await readAuthV6(auth),config={...await publisherDatabaseConfigV6(url),application_name:'Techlong-Delegation-Readiness-V1'};url=undefined;
    c=new pg.Client(config);config=undefined;counts.connections++;await c.connect();must(c.connection.stream.encrypted===true&&c.connection.stream.authorized===true,'READINESS_TLS');
    const client={async query(t,v){must(++counts.queries<=25,'READINESS_QUERY_BUDGET');readonlyQuery(t);await guard();return c.query(t,v);}};
    const contract=sqlContract((await readText(ROOT+'/'+I.sql,3000000)).replaceAll('\r\n','\n'));
    await createPublisherDatabaseV6({client,expected:DATABASE_V6,contract,release:B.release,maxWrites:1}).verify();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await client.query('SET LOCAL search_path=pg_catalog');
    const rows=await client.query('SELECT deployment_control_v6.status() AS value');const plans=rows.rows?.[0]?.value;historyProof(plans);
    const admin=await client.query('SELECT id,status,is_platform_admin FROM public.users WHERE id=$1',[D.admin]);
    must(admin.rows?.length===1&&admin.rows[0].status==='active'&&Number(admin.rows[0].is_platform_admin)===1,'DELEGATOR_INACTIVE');
    const job=await client.query('SELECT id,job_type,status,attempts,max_attempts,available_at,lease_owner,payload FROM public.deployment_jobs WHERE id=$1',[D.jobId]);
    const j=job.rows?.[0];must(job.rows?.length===1&&j.id===D.jobId&&j.job_type==='reconcile'&&j.status==='pending'&&Number(j.attempts)===0&&Number(j.max_attempts)===1&&
      Number(j.available_at)===Number.MAX_SAFE_INTEGER&&j.lease_owner===null&&JSON.parse(typeof j.payload==='string'?j.payload:JSON.stringify(j.payload)).kind==='express_initialized_request_v4','JOB_NOT_HELD');
    await client.query('COMMIT');const r={checkedAt:Date.now(),plans,delegatorActiveVerified:true,jobHeldVerified:true,counts:{...counts}};await record('ledger',r);return r;
  }finally{try{await c?.end();}finally{await record('readiness-counts',counts);}}
}
