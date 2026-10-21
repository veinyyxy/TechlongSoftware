import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {load} from 'js-yaml';
import {imageReceipt,verifyReceipt,main} from '../ops/platform-hosting-v1/image-artifact.mjs';
import {lockedImageFoundation,IMAGE_FOUNDATION as S} from '../ops/platform-hosting-v1/image-foundation.mjs';
import {WEB_DATABASE_PROFILE as D,WEB_DATABASE_CATALOG_SQL} from '../ops/platform-hosting-v1/database-profile.mjs';
import {checkCandidateScan,scanCandidate} from '../ops/platform-hosting-v1/security-scan.mjs';
const context={CI:'true',GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'veinyyxy/TechlongSoftware',GITHUB_EVENT_NAME:'push',
  GITHUB_REF:'refs/heads/main',GITHUB_RUN_ATTEMPT:'1',GITHUB_SHA:'a'.repeat(40),GITHUB_RUN_ID:'123456789'};
const inspect=[{Id:'sha256:'+'b'.repeat(64),Os:'linux',Architecture:'amd64',Config:{User:'node',WorkingDir:'/app',
  Cmd:['node','ops/platform-hosting-v1/start.mjs'],Entrypoint:['docker-entrypoint.sh'],
  Env:['PATH=/usr/bin','NODE_VERSION=24.18.0','YARN_VERSION=1.22.22','NODE_ENV=production','PORT=3000'],Volumes:null,OnBuild:null}}];
const archive={bytes:42,sha256:'c'.repeat(64)};
const expected={sourceCommit:context.GITHUB_SHA,runId:context.GITHUB_RUN_ID};
test('receipt binds exact image config, archive bytes, push source and first run',()=>{
  const r=imageReceipt(inspect,archive,context);assert.equal(r.imageConfigDigest,inspect[0].Id);
  assert.equal(verifyReceipt(r,archive,expected).registryManifestVerified,false);
  for(const field of ['GITHUB_REPOSITORY','GITHUB_EVENT_NAME','GITHUB_REF','GITHUB_RUN_ATTEMPT','GITHUB_SHA','GITHUB_RUN_ID','CI','GITHUB_ACTIONS'])
    assert.throws(()=>imageReceipt(inspect,archive,{...context,[field]:'unapproved'}));
});
test('private environment, root, alternate command, architecture and injected startup refuse artifact export',()=>{
  const configs=[{User:'root'},{WorkingDir:'/other'},{Cmd:['sh']},{Entrypoint:['sh']},{Volumes:{'/private':{}}},
    {OnBuild:['unreviewed']},{Env:[...inspect[0].Config.Env,'DATABASE_URL=synthetic-private']},
    {Env:[...inspect[0].Config.Env,'NODE_OPTIONS=synthetic-private']},
    {Env:[...inspect[0].Config.Env,'PORT=3100']}];
  for(const config of configs){const i=structuredClone(inspect);Object.assign(i[0].Config,config);assert.throws(()=>imageReceipt(i,archive,context));}
  for(const delta of [{Os:'windows'},{Architecture:'arm64'},{Id:'not-a-digest'}])assert.throws(()=>imageReceipt([{...inspect[0],...delta}],archive,context));
  assert.throws(()=>imageReceipt([],archive,context));
});
test('no self-approved receipt, changed bytes, oversized archive, source/run substitution or extra keys',()=>{
  const r=imageReceipt(inspect,archive,context);
  for(const delta of [{sourceCommit:'d'.repeat(40)},{runId:'987654321'},{runAttempt:2},{archiveSha256:'d'.repeat(64)},
    {archiveBytes:43},{archiveFile:'../private.env'},{approved:true}])assert.throws(()=>verifyReceipt({...r,...delta},archive,expected));
  assert.throws(()=>verifyReceipt(r,{...archive,bytes:0},expected));
  assert.throws(()=>imageReceipt(inspect,{...archive,bytes:1610612736},context));
  assert.throws(()=>verifyReceipt(r,archive,{...expected,runId:'987654321'}));
});
test('real seal/verify CLI core creates exclusive receipts and detects changed local bytes without cloud access',async t=>{
  const prefix=path.join(tmpdir(),'techlong-image-artifact-test-'),dir=await mkdtemp(prefix);
  t.after(async()=>{assert(dir.startsWith(prefix)&&path.dirname(dir)===path.resolve(tmpdir()));await rm(dir,{recursive:true,force:true});});
  await writeFile(path.join(dir,'image.tar.gz'),'synthetic fixture bytes, not a real image');
  await writeFile(path.join(dir,'image-inspect.json'),JSON.stringify(inspect));
  const r=await main(['seal',dir],context);assert.equal(r.registryManifestVerified,false);
  const v=await main(['verify',dir,context.GITHUB_SHA,context.GITHUB_RUN_ID],{});assert.deepEqual(v,r);
  const receipt=await readFile(path.join(dir,'image-receipt.json'));
  assert((await readFile(path.join(dir,'SHA256SUMS'),'utf8')).includes(createHash('sha256').update(receipt).digest('hex')));
  await assert.rejects(main(['seal',dir],context),/EEXIST/);
  await writeFile(path.join(dir,'image.tar.gz'),'changed');
  await assert.rejects(main(['verify',dir,context.GITHUB_SHA,context.GITHUB_RUN_ID],{}),/RECEIPT/);
  await assert.rejects(main(['deploy',dir],context),/ARGUMENTS/);
});
test('foundation creates exactly independent ECR, boundary and publisher with deny-all trust and retained images',()=>{
  const t=lockedImageFoundation(),r=t.Resources;assert.deepEqual(Object.keys(r),['PlatformWebRepository','PlatformImageBoundary','PlatformImagePublisher']);
  assert.equal(t.Parameters,undefined);assert.equal(t.Metadata.executionApproved,false);
  const repo=r.PlatformWebRepository;assert.equal(repo.Properties.RepositoryName,S.repository);
  assert.equal(repo.DeletionPolicy,'Retain');assert.equal(repo.UpdateReplacePolicy,'Retain');assert.equal(repo.Properties.EmptyOnDelete,false);
  assert.equal(repo.Properties.ImageTagMutability,'IMMUTABLE');assert.equal(repo.Properties.ImageScanningConfiguration.ScanOnPush,true);
  assert.equal(repo.Properties.EncryptionConfiguration.EncryptionType,'AES256');assert.equal(repo.Properties.LifecyclePolicy,undefined);
  const role=r.PlatformImagePublisher.Properties;assert.deepEqual(role.PermissionsBoundary,{Ref:'PlatformImageBoundary'});
  assert(role.AssumeRolePolicyDocument.Statement.every(s=>s.Effect==='Deny'));assert.equal(role.RoleName,S.role);
  assert.equal(role.ManagedPolicyArns,undefined);assert.equal(role.Policies.length,1);
});
test('boundary and inline permit only repository-scoped push/read, no IAM/CFN/ECS/Secret/delete escalation',()=>{
  const r=lockedImageFoundation().Resources,p=r.PlatformImageBoundary.Properties.PolicyDocument;
  assert.deepEqual(r.PlatformImagePublisher.Properties.Policies[0].PolicyDocument,p);
  const [auth,repo]=p.Statement;assert.deepEqual(auth.Action,['ecr:GetAuthorizationToken']);assert.equal(auth.Resource,'*');
  assert.deepEqual(auth.Condition,{StringEquals:{'aws:RequestedRegion':S.region}});
  assert.equal(repo.Resource,`arn:aws:ecr:${S.region}:${S.account}:repository/${S.repository}`);
  assert(repo.Action.every(a=>/^ecr:(BatchCheckLayerAvailability|InitiateLayerUpload|UploadLayerPart|CompleteLayerUpload|PutImage|BatchGetImage|GetDownloadUrlForLayer|DescribeImages|DescribeRepositories|DescribeImageScanFindings)$/.test(a)));
  assert.doesNotMatch(JSON.stringify(p),/iam:|cloudformation:|ecs:|secretsmanager:|Delete|Create|\"ecr:\*\"/);
  r.PlatformImagePublisher.Properties.Policies[0].PolicyDocument.Statement[0].Action.push('synthetic-mutation');
  assert.equal(p.Statement[0].Action.length,1);assert.equal(lockedImageFoundation().Resources.PlatformImagePublisher.Properties.Policies[0].PolicyDocument.Statement[0].Action.length,1);
});
test('acceptance database profile allows only session writes and lock counters, never passwords/business/authority',()=>{
  assert.equal(D.installed,false);assert.equal(D.catalogVerified,false);assert.equal(D.rowIsolation,false);
  assert.deepEqual(D.credentialsUpdateColumns,['failed_attempts','locked_until','updated_at']);
  assert.deepEqual(D.sessionPrivileges,['SELECT','INSERT','DELETE']);
  assert(D.credentialsSelectColumns.includes('password_hash'));
  assert(!D.selectTables.some(n=>/authority|control_v|compensation|tenant_resource|cleanup|invitation/.test(n)));
  assert.equal(new Set(D.selectTables).size,D.selectTables.length);
});
test('proposed read tables actually exist in tracked schema/migrations; catalog query is metadata-only',async()=>{
  const schema=await readFile(new URL('../db/postgres-schema.sql',import.meta.url),'utf8');
  const migrations=await Promise.all(['0002_app_instance_deployment_planning.sql','0003_deployment_execution_foundation.sql'].map(n=>readFile(new URL('../db/postgres-migrations/'+n,import.meta.url),'utf8')));
  for(const table of D.selectTables)assert.match([schema,...migrations].join('\n'),new RegExp('CREATE TABLE (?:IF NOT EXISTS )?'+table+'\\s*\\('));
  assert.match(WEB_DATABASE_CATALOG_SQL,/transaction_read_only/);
  assert.doesNotMatch(WEB_DATABASE_CATALOG_SQL,/\b(?:INSERT|UPDATE|DELETE|GRANT|REVOKE|ALTER|CREATE|DROP|CALL|DO)\b|rolpassword|prosrc|FROM public\./i);
  assert.match(WEB_DATABASE_CATALOG_SQL,/pg_roles/);assert.match(WEB_DATABASE_CATALOG_SQL,/pg_auth_members/);
});
test('only successful first main push can export/upload three fixed files, never AWS credentials or registry publication',async()=>{
  const w=load(await readFile(new URL('../.github/workflows/platform-hosting-candidate.yml',import.meta.url),'utf8'));
  assert.deepEqual(w.permissions,{contents:'read'});assert.equal(w.jobs.candidate.environment,undefined);
  const exportStep=w.jobs.candidate.steps.find(s=>s.name?.startsWith('Export the checked'));
  assert.match(exportStep.if,/github.run_attempt == 1/);assert.match(exportStep.if,/github.event_name == 'push'/);
  const upload=w.jobs.candidate.steps.find(s=>s.uses?.startsWith('actions/upload-artifact@'));
  assert.equal(upload.with['retention-days'],3);assert.equal(upload.with.overwrite,false);
  assert.deepEqual(upload.with.path.trim().split('\n').map(x=>x.split('/').at(-1)),['image.tar.gz','image-receipt.json','SHA256SUMS']);
  assert.doesNotMatch(w.jobs.candidate.steps.map(s=>s.run??'').join('\n'),/docker push|configure-aws|aws ecr|id-token|secrets\./);
});

function scanned(){return {report:{ArtifactName:inspect[0].Id,ArtifactType:'container_image',
  Metadata:{ImageID:inspect[0].Id,OS:{Family:'alpine',Name:'3.24.2',EOSL:false}},
  Results:[{Class:'os-pkgs',Packages:Array.from({length:15},(_,i)=>({Name:'synthetic-'+i})),Vulnerabilities:[]}]},
  db:{Version:2,UpdatedAt:'2026-10-21T22:00:00Z'}};}
const scanNow=Date.parse('2026-10-21T23:00:00Z');
test('new Alpine candidate requires exact image, OS inventory, supported release and fresh scanner database',()=>{
  let s=scanned();assert.equal(checkCandidateScan(s.report,s.db,inspect[0].Id,scanNow).outcome,'OS_HIGH_CRITICAL_ZERO');
  for(const change of [s=>{s.report.Metadata.ImageID='sha256:'+'a'.repeat(64);},s=>{s.report.ArtifactName='other';},
    s=>{s.report.Metadata.OS.Family='debian';},s=>{s.report.Metadata.OS.Name='3.23';},s=>{s.report.Metadata.OS.EOSL=true;},
    s=>{s.report.Results=[];},s=>{s.report.Results[0].Packages=[];},s=>{s.db.UpdatedAt='invalid';},
    s=>{s.db.UpdatedAt='2026-10-19T00:00:00Z';},s=>{s.db.UpdatedAt='2026-10-22T00:00:00Z';}]){
    s=scanned();change(s);assert.throws(()=>checkCandidateScan(s.report,s.db,inspect[0].Id,scanNow));
  }
});
test('candidate scan saves failure evidence exclusively and refuses credential-bearing callers before reading files',async t=>{
  const prefix=path.join(tmpdir(),'techlong-scan-test-'),dir=await mkdtemp(prefix);
  t.after(()=>{assert(dir.startsWith(prefix)&&path.dirname(dir)===path.resolve(tmpdir()));return rm(dir,{recursive:true,force:true});});
  const {mkdir}=await import('node:fs/promises');await mkdir(path.join(dir,'db'));
  const s=scanned();s.db.UpdatedAt=new Date().toISOString();s.report.Results[0].Vulnerabilities=[{Severity:'HIGH',PkgName:'synthetic'}];
  await writeFile(path.join(dir,'image-inspect.json'),JSON.stringify(inspect));
  await writeFile(path.join(dir,'image-receipt.json'),JSON.stringify(imageReceipt(inspect,archive,context)));
  await writeFile(path.join(dir,'os-scan.json'),JSON.stringify(s.report));
  await writeFile(path.join(dir,'db/metadata.json'),JSON.stringify(s.db));await writeFile(path.join(dir,'db/trivy.db'),'synthetic DB bytes');
  await assert.rejects(scanCandidate(dir,dir,{...context,AWS_PROFILE:'synthetic'}),/CREDENTIAL_OR_OVERRIDE/);
  await assert.rejects(scanCandidate(dir,dir,context),/SECURITY_SCAN_FINDINGS/);
  const bytes=await readFile(path.join(dir,'os-scan-summary.json'),'utf8');assert.equal(JSON.parse(bytes).outcome,'HIGH_CRITICAL_FINDINGS');
  await assert.rejects(scanCandidate(dir,dir,context),/EEXIST/);assert.equal(await readFile(path.join(dir,'os-scan-summary.json'),'utf8'),bytes);
});
test('unfixed HIGH and CRITICAL remain blocking, without ignoring or asserting application exploitability',()=>{
  const s=scanned();s.report.Results[0].Vulnerabilities=[{VulnerabilityID:'CVE-synthetic',PkgName:'synthetic',InstalledVersion:'1',Severity:'HIGH'},
    {VulnerabilityID:'CVE-synthetic-critical',PkgName:'synthetic',InstalledVersion:'1',FixedVersion:'2',Severity:'CRITICAL'}];
  const r=checkCandidateScan(s.report,s.db,inspect[0].Id,scanNow);
  assert.equal(r.outcome,'HIGH_CRITICAL_FINDINGS');assert.deepEqual(r.findingSeverityCounts,{HIGH:1,CRITICAL:1});
  assert.equal(r.findings[0].fixedVersion,null);assert.equal(r.ignoreUnfixedAllowed,false);
  s.report.Results[0].Vulnerabilities=[{Severity:'LOW'}];assert.throws(()=>checkCandidateScan(s.report,s.db,inspect[0].Id,scanNow));
});
test('producer scans sealed exact image before upload, keeps evidence on failure and has no security bypass',async()=>{
  const text=await readFile(new URL('../.github/workflows/platform-hosting-candidate.yml',import.meta.url),'utf8'),w=load(text),steps=w.jobs.candidate.steps;
  const scanIndex=steps.findIndex(s=>s.name?.startsWith('Fresh OS HIGH'));
  const imageUpload=steps.findIndex(s=>s.uses?.startsWith('actions/upload-artifact'));
  assert(scanIndex>0&&scanIndex<imageUpload);assert.match(steps[scanIndex].if,/github.run_attempt == 1/);
  const scan=steps[scanIndex].run;
  for(const value of ['env -i','--list-all-pkgs','--ignorefile','security-scan.mjs','test "$scan_exit" -eq 0'])assert(scan.includes(value));
  assert.doesNotMatch(scan,/ignore-unfixed|skip-db-update|skip-files|skip-dirs|\.trivyignore|\.env/);
  assert.match(steps.at(-1).if,/always\(\)/);assert.match(steps.at(-1).with.path,/os-scan-summary\.json$/);
});
