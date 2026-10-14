// Prepare-only. No mode Run, no SQL/SDK client, no credentials or Secret values.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {readFile,mkdir,open,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import db from '../../../lib/deployments/execution/aurora-database-contract-v2.cjs';
import {buildExpressSecretCreateCandidateV6} from '../../../lib/deployments/execution/express-runtime-candidate-v6.ts';
const base=await realpath('F:/ChatGPT_workshop'),backend='E:/NodejsProject/SpeedFeast_Backend_main';
const platform=fileURLToPath(new URL('../../../',import.meta.url)),cli=promisify(execFile);
const hash=v=>createHash('sha256').update(v).digest('hex'),fail=()=>{throw Error('EXPRESS_C4A_PREPARE_REJECTED');};
if(process.argv.length!==4||process.argv[2]!=='--output')fail();
const output=path.resolve(process.argv[3]);
if(path.dirname(output).toLowerCase()!==base.toLowerCase()||!/^techlong-d002-express-c4a-[a-z0-9-]+$/.test(path.basename(output)))fail();
await mkdir(output);
const save=async(name,value)=>{const f=await open(path.join(output,name),'wx');try{await f.writeFile(JSON.stringify(value,null,2)+'\n');await f.sync();}finally{await f.close();}};
try {
  const legacy=JSON.parse(await readFile(path.join(base,'techlong-d002-express-c3g-run-20261014-r1/code-binding.json'),'utf8'));
  if(legacy.pins.length!==236||legacy.tools.length!==2||db.digest({pins:legacy.pins,tools:legacy.tools})!=='d588ae8af11d72d606506b8cdcecc5aa1c613c6a0e432357c370bb6444f90dc2')fail();
  const workflow='.github/workflows/backend-image-candidate.yml';
  const oldWorkflow=(await cli('git',['show','12400d40b0fea58ce5d502a1082e39e6c18ddef6:'+workflow],
    {cwd:backend,windowsHide:true,maxBuffer:100000})).stdout;
  const pins=[];
  for(const p of legacy.pins){
    const bytes=await readFile(path.join(p.repo,p.name),'utf8'),changed=p.repo===backend&&p.name===workflow;
    if(hash((changed?oldWorkflow:bytes).replace(/\r\n/g,'\n'))!==p.sha256)fail();
    pins.push({...p,sha256:hash(bytes.replace(/\r\n/g,'\n'))});
  }
  // The bundled Python was updated since C3g. Preserve its historical pin;
  // only this inert C4a preparation binds the current, independently read
  // local bundle 26.1013.11914 / Python 3.12.14. This is not execution approval.
  const currentTools=legacy.tools.map(t=>({...t,sha256:t.filename.endsWith('/python/python.exe')
    ?'b847bb9f4e48c19f585c8bf7d8b355f3f8c6d2125717ece9c9d7e16fb9f09de8':t.sha256}));
  for(const t of currentTools)if(hash(await readFile(t.filename))!==t.sha256)fail();
  for(const [repo,names]of [[platform,['ops/aws-sandbox/scripts/prepare-express-application-c4a.mjs','lib/deployments/execution/express-runtime-candidate-v6.ts']],
    [backend,['services/saas/aurora-express-application-v6.cjs','services/saas/aurora-express-application-v6-check.cjs']]])
    for(const name of names)pins.push({repo,name,sha256:hash((await readFile(path.join(repo,name),'utf8')).replace(/\r\n/g,'\n'))});
  const evidence=[
    ['techlong-d002-express-c3g-run-20261014-r1/result.json','3ec0a90c18920a0625a5857f05b4b1d86da483f9e1915ef718b122a72894fd00'],
    ['techlong-d002-express-c3g-inspect-20261014-r1/result.json','f7040b664ce600c521dd37af9140941bd48de4fc66568538b878ab28cbccce03'],
    ['techlong-d002-express-c3-restore-only-v5.permanent-slot.json','52ed41f01de5988093a3939ef68cd85f06cf44279dd20d7ac1907e8f2238311a'],
    ['techlong-d002-express-c3-restore-only-v5-inspect.permanent-slot.json','69865304f48d1f9807e88330a09d971322090a6678e41603d7b1793d5dc7bcc9'],
    ['techlong-d002-express-c3g-run-20261014-r1/catalog-baseline-before-verifier.json','ac64ee11f78f4219229e3f53d08a589d8aca2953ad71e3a89d3ef909e2502ce9'],
    ['techlong-d002-express-c3g-run-20261014-r1/catalog-migrated-before-verifier.json','9cd4f1d68aa552359b130ee570c5d63d5f00bb4031efe5b77dd83120357a7beb'],
    ['techlong-d002-express-c3g-inspect-20261014-r1/catalog-independent-final.json','9a93c4f72bde5cb35a9f4b0ad33200e6f68d01060d996451cbb5b242214e1ab2']];
  for(const [name,sha]of evidence)if(hash(await readFile(path.join(base,name)))!==sha)fail();
  const codeBindingSha256=db.digest({pins,tools:currentTools}),historySha256=db.digest(evidence);
  await save('code-binding.json',{codeBindingSha256,pins,tools:currentTools,predecessorTools:legacy.tools,historySha256,evidence});
  const requireBackend=createRequire(path.join(backend,'package.json'));
  const original=JSON.parse(await readFile(path.join(base,'techlong-d002-express-c3d-review-20261014-r2/manifest.json'),'utf8'));
  const {compile}=requireBackend('./scripts/prepare-aurora-express-sql-v5');
  const built=await compile({continuationInput:original.continuationInput,
    baselineDirectory:path.join(base,'techlong-empty-baseline-20261005-f2a4'),pgRestorePath:currentTools.find(t=>t.filename.endsWith('pg_restore.exe')).filename,
    pythonPath:currentTools.find(t=>t.filename.endsWith('python.exe')).filename,workspace:path.join(output,'compiled')});
  const run=JSON.parse(await readFile(path.join(base,evidence[0][0]),'utf8'));
  const inspection=JSON.parse(await readFile(path.join(base,evidence[1][0]),'utf8'));
  const {compileApplicationCandidateV6,assertCompiledApplicationCandidateV6}=requireBackend('./services/saas/aurora-express-application-v6.cjs');
  const applicationCandidate=compileApplicationCandidateV6({bootstrapProgram:built.bootstrap,baselineProgram:built.baseline,run,inspection});
  assertCompiledApplicationCandidateV6(applicationCandidate);
  // The private brand cannot be restored from JSON, even with identical bytes.
  let rejected=false;try{assertCompiledApplicationCandidateV6(structuredClone(applicationCandidate));}catch{rejected=true;}if(!rejected)fail();
  const secretCandidate=buildExpressSecretCreateCandidateV6({stableIdentity:built.bootstrap.target.stableIdentity,resourceGeneration:1});
  await save('application-candidate.json',applicationCandidate);await save('secret-candidate.json',secretCandidate);
  const body={schema:'techlong/express-application-runtime-prepared/c4a',preparedAt:new Date().toISOString(),
    codeBindingSha256,historySha256,applicationCandidateSha256:db.digest(applicationCandidate),secretCandidateSha256:db.digest(secretCandidate),
    target:{databaseOid:'16459',roleOid:'16456',migratedCatalogSha256:applicationCandidate.migratedCatalogSha256},
    proposedSqlStatements:applicationCandidate.statements.length,tables:applicationCandidate.tables.length,sequences:applicationCandidate.sequences.length,
    schemaArchiveCompiledAndBranded:true,serializedProgramRejected:true,actualSecretArnVersionBound:false,
    privateSecretMaterialPrepared:false,privateMaterialReads:0,taskRoleMetadataVerified:false,currentIsolationVerified:false,
    configurationFinalized:false,executionRootAvailable:false,executionAuthorized:false,
    sqlConnections:0,sqlCalls:0,awsCalls:0,awsWrites:0,secretValueReads:0,newSlotsConsumed:0,runtimeEnabled:false,readyVerified:false};
  await save('result.json',{...body,candidateSha256:db.digest(body)});
  process.stdout.write(JSON.stringify({directory:output,candidateSha256:db.digest(body),proposedSqlStatements:body.proposedSqlStatements,
    tables:body.tables,sequences:body.sequences,sqlConnections:0,awsCalls:0,newSlotsConsumed:0,executionAuthorized:false})+'\n');
}catch{
  await save('stopped.json',{code:'EXPRESS_C4A_PREPARE_REJECTED',sqlConnections:0,sqlCalls:0,awsCalls:0,awsWrites:0,newSlotsConsumed:0,
    privateMaterialReads:0,retryAuthorized:false,executionAuthorized:false,runtimeEnabled:false});process.stderr.write('EXPRESS_C4A_PREPARE_REJECTED\n');process.exitCode=1;
}
