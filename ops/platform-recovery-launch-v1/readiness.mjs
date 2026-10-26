// Future window preflight only: one config read/one verified TLS connection.
import pg from 'pg';
import {readAuthV6} from '../platform-local-v6/local.mjs';
import {publisherDatabaseConfigV6} from '../platform-publisher-v6/io.mjs';
import {sqlContract,I} from '../platform-controller-review-v6/install.mjs';
import {readText,ROOT} from '../platform-image-source-v2/files.mjs';
import {readLaunchSnapshot,sqlGate} from './io.mjs';
import {verifyBaseline,must} from './operation.mjs';
export async function confirmNeonReadiness({manifest:m,basis,binding,guard,record,now=Date.now}){
  const counts={configReads:0,connections:0,queries:0,writes:0};let c;
  try{
    await guard();counts.configReads++;let url=await readAuthV6(m.auth),config=await publisherDatabaseConfigV6(url);url=undefined;
    c=new pg.Client({...config,options:'',application_name:'Techlong-Readonly-Continuation-Preflight'});config=undefined;
    const gate=sqlGate('PublishReview');c.on('error',()=>gate.halt());counts.connections++;await c.connect();
    must(c.connection.stream.encrypted===true&&c.connection.stream.authorized===true,'CONTINUATION_TLS');
    const reader={async query(text,values){must(++counts.queries<=45,'CONTINUATION_QUERY_BUDGET');gate.check(text,true);await guard();return c.query(text,values);}};
    const contract=sqlContract((await readText(ROOT+'/'+I.sql,3000000)).replaceAll('\r\n','\n'));
    const state=await readLaunchSnapshot(reader,{contract});await record('neon-preflight-state',state);
    await verifyBaseline(basis,state,'PublishReview',binding,m.requestEvidence);await guard();
    return {neonReadinessVerified:true,...counts,checkedAt:now(),baselineChanged:false};
  }finally{try{await c?.end();}finally{await record('neon-preflight-counts',counts);}}
}
