import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {load} from 'js-yaml';
import {P,ACCESS_SCOPE,hash,canonical,handoffPolicy,policySame} from '../ops/platform-ecs-v1/contract.mjs';
import {accessTemplate,hostingTemplate,executionPolicy,trust,assertTemplates} from '../ops/platform-ecs-v1/templates.mjs';
import {installAccess} from '../ops/platform-ecs-v1/access.mjs';
import {estimate} from '../ops/platform-ecs-v1/prices.mjs';
import {assertPublicRoutes} from '../ops/platform-ecs-v1/cloud.mjs';
import {sourceOnlyPolicy} from '../ops/platform-web-credential-v1/contract.mjs';
import {CLOSED_BINDINGS} from '../ops/platform-hosting-v1/contract.mjs';
import {SOURCES,RISK,CI_PATH,validate,main} from '../ops/platform-ecs-v1/local.mjs';
const nonce='a'.repeat(32),issued='2026-10-22T21:00:00Z';
const artifactNames=['access-template.json','hosting-draft.json','execution-policy.json','trust.json','inventory.json','prices.json','service-validation.json','identity-validation.json','trust-validation.json'];
function manifest(){return {schema:'techlong/platform-ecs-access-review/v1',sourceCommit:'b'.repeat(40),nonce,issuedAt:issued,expiresAt:'2026-10-24T21:00:00Z',latestStartAt:'2026-10-24T20:40:00Z',
  scope:{...ACCESS_SCOPE},constants:{...P},accessTemplateSha256:hash(canonical(accessTemplate(nonce))),hostingDraftSha256:hash(canonical(hostingTemplate())),handoffPolicySha256:hash(canonical(handoffPolicy())),
  sourcePins:SOURCES.map(file=>({file,sha256:'c'.repeat(64)})),riskSha256:'c'.repeat(64),artifactDirectory:'F:/ChatGPT_workshop/techlong-platform-ecs-review-'+nonce,
  artifactPins:artifactNames.map(name=>({name,sha256:'d'.repeat(64)})),inventory:{accessNamesAbsent:true,hostingNamesAbsent:true,secret:{arn:P.secretArn,versionId:P.secretVersion}},
  ciReceipt:{runId:123,file:'F:/ChatGPT_workshop/techlong-platform-ecs-ci-123.json',sha256:'e'.repeat(64)}};}

test('access stack creates exactly one role plus boundary, no reuse/hosting or broad AWS managed policy',()=>{
  const a=accessTemplate(nonce);assert.deepEqual(Object.keys(a.Resources),['ExecutionBoundary','ExecutionRole']);assert.equal(Object.keys(hostingTemplate().Resources).length,11);
  assert.equal(a.Resources.ExecutionBoundary.Type,'AWS::IAM::ManagedPolicy');assert.equal(a.Resources.ExecutionBoundary.Properties.Tags,undefined);
  assert.deepEqual(a.Resources.ExecutionRole.Properties.PermissionsBoundary,{Ref:'ExecutionBoundary'});assert.equal(a.Resources.ExecutionRole.Properties.ManagedPolicyArns,undefined);
  assert.deepEqual(a.Resources.ExecutionRole.Properties.Policies,[{PolicyName:P.inline,PolicyDocument:executionPolicy()}]);assertTemplates(a,hostingTemplate(),nonce);
  const b=structuredClone(a);b.Resources.ExecutionRole.Properties.AssumeRolePolicyDocument.Statement[0].Principal={AWS:'*'};assert.throws(()=>assertTemplates(b,hostingTemplate(),nonce));
});
test('execution maximum is exact repo/stream/secret/Key-context, ECS trust is same-account region, not app access',()=>{
  const p=executionPolicy(),s=p.Statement;assert.equal(s.length,5);assert.equal(s.filter(s=>s.Resource==='*').length,1);assert.equal(s[0].Action,'ecr:GetAuthorizationToken');
  assert.equal(s.find(s=>s.Sid==='ExactWebSecret').Resource,P.secretArn);assert.match(s.find(s=>s.Sid==='ExactWebLogStreams').Resource,/:log-stream:web\/\*$/);
  const k=s.find(s=>s.Action==='kms:Decrypt');assert.equal(k.Resource,P.kmsArn);assert.equal(k.Condition.StringEquals['kms:EncryptionContext:SecretVersionId'],P.secretVersion);
  assert.equal(k.Condition.StringEquals['kms:EncryptionContext:SecretARN'],P.secretArn);assert.equal(trust().Statement[0].Principal.Service,'ecs-tasks.amazonaws.com');
  assert.equal(trust().Statement[0].Condition.StringEquals['aws:SourceAccount'],P.account);
  assert.doesNotMatch(JSON.stringify(p),/PutSecretValue|UpdateSecret|CreateLogGroup|iam:|cloudformation:|ecs:RunTask|ecr:PutImage/);
});
test('handoff changes read exception only; management remains Source-only and single-value serialization is normalized',()=>{
  const old=sourceOnlyPolicy(),next=handoffPolicy();assert.deepEqual(next.Statement[1],old.Statement[1]);
  assert.deepEqual(next.Statement[0].Condition.ArnNotEquals['aws:PrincipalArn'],[P.sourceArn,P.roleArn]);assert(next.Statement.every(s=>s.Effect==='Deny'));
  const equivalent=structuredClone(next);equivalent.Statement[0].Action=[equivalent.Statement[0].Action];equivalent.Statement[0].Resource=['*'];assert(policySame(next,equivalent));
  equivalent.Statement[1].Effect='Allow';assert(!policySame(next,equivalent));
});
test('hosting draft fixes digest/Secret version, no app task role, closed runtime, public-IP route but only ALB ingress',()=>{
  const h=hostingTemplate(),r=h.Resources,d=r.TaskDefinition.Properties,c=d.ContainerDefinitions[0];assert.equal(d.TaskRoleArn,undefined);assert.equal(d.ExecutionRoleArn,P.roleArn);
  assert.equal(c.Image,P.image);assert.equal(c.User,'1000:1000');assert.equal(c.ReadonlyRootFilesystem,false);assert.deepEqual(c.LinuxParameters.Capabilities.Drop,['ALL']);
  assert.deepEqual(c.Secrets,[{Name:'DATABASE_URL',ValueFrom:P.secretArn+':databaseUrl::'+P.secretVersion}]);
  const env=Object.fromEntries(c.Environment.map(x=>[x.Name,x.Value]));for(const [k,v]of Object.entries(CLOSED_BINDINGS))assert.equal(env[k],v);
  assert.equal(env.DATABASE_URL,undefined);assert.equal(env.TECHLONG_PLATFORM_PUBLIC_ORIGIN,'https://'+P.domain);assert.equal(r.Service.Properties.EnableExecuteCommand,false);
  assert.equal(r.Service.Properties.DesiredCount,1);assert.equal(r.Service.Properties.NetworkConfiguration.AwsvpcConfiguration.AssignPublicIp,'ENABLED');
  assert.deepEqual(r.TaskIngress.Properties.SourceSecurityGroupId,{Ref:'AlbSecurityGroup'});assert.equal(r.AlbSecurityGroup.Properties.SecurityGroupIngress[0].FromPort,443);
  assert.equal(r.TaskSecurityGroup.Properties.SecurityGroupEgress[0].ToPort,443);assert.equal(r.LogGroup.Properties.RetentionInDays,7);
  assert(Object.values(r).every(x=>!['AWS::EC2::VPC','AWS::EC2::NatGateway','AWS::IAM::Role','AWS::SecretsManager::Secret','AWS::RDS::DBCluster'].includes(x.Type)));
});
test('all internal references resolve and security-group dependency graph is acyclic',()=>{
  const h=hostingTemplate(),names=new Set([...Object.keys(h.Resources),...Object.keys(h.Parameters)]),edges=new Map();
  for(const [name,r]of Object.entries(h.Resources)){const deps=new Set(r.DependsOn??[]);const walk=x=>{if(!x||typeof x!=='object')return;
    if(x.Ref){assert(names.has(x.Ref));if(h.Resources[x.Ref])deps.add(x.Ref);}if(x['Fn::GetAtt']){const n=x['Fn::GetAtt'][0];assert(names.has(n));deps.add(n);}
    for(const v of Object.values(x))if(typeof v==='object')for(const y of Array.isArray(v)?v:[v])walk(y);};walk(r.Properties);edges.set(name,deps);}
  const done=new Set(),active=new Set();function visit(n){if(done.has(n))return;assert(!active.has(n),'dependency cycle');active.add(n);for(const d of edges.get(n))visit(d);active.delete(n);done.add(n);}
  for(const n of edges.keys())visit(n);assert.equal(done.size,11);
});
test('one create and one handoff, role-id drift and ambiguous write stop without replay; independent read still runs',async()=>{
  for(const failure of [null,'create','role-id','handoff']){const events=[],m=manifest();let state='SOURCE_ONLY';
    const role={roleId:'AROA12345678901234567',roleArn:P.roleArn},c={counts:{reads:0,writes:0},source:async()=>{},
      accessPrestate:async()=>({accessNamesAbsent:true,secret:{arn:P.secretArn},kms:{arn:P.kmsArn}}),
      createAccess:async()=>{events.push('create');c.counts.writes++;if(failure==='create')throw Error('lost');return 'stack-id';},
      stack:async()=>({StackId:'stack-id',StackStatus:'CREATE_COMPLETE'}),inspectAccess:async()=>role,
      secret:async expected=>{events.push('metadata');return {policy:expected??(state==='HANDOFF'?handoffPolicy():sourceOnlyPolicy())};},
      assertRoleId:async()=>{if(failure==='role-id')throw Error('changed');},putHandoff:async()=>{events.push('put');c.counts.writes++;state='HANDOFF';if(failure==='handoff')throw Error('ACK lost');}};
    const result=await installAccess({manifest:m,sha:'f'.repeat(64),now:()=>Date.parse(issued),io:{cloud:c,consume:async()=>events.push('consume'),record:async()=>{},pause:async()=>{}}});
    assert.equal(events[0],'consume');assert.equal(events.filter(e=>e==='create').length,1);assert(events.filter(e=>e==='put').length<=1);
    assert.equal(result.outcome,failure?'ACCESS_REQUIRES_REVIEW_NO_RETRY':'ACCESS_HANDOFF_INDEPENDENTLY_VERIFIED');assert.equal(result.secretValueReads,0);assert.equal(result.hostingDeployed,false);
    assert(events.includes('metadata'));if(failure==='role-id')assert(!events.includes('put'));
  }
});
test('exact raw SHA/48h/20min margin/template/scope/pins are binding; invalid CLI cannot access cloud',async()=>{
  const m=manifest(),raw=JSON.stringify(m),now=Date.parse(issued);validate(raw,hash(raw),now);
  for(const change of [v=>v.scope.hostingDeployments=1,v=>v.constants.secretVersion='other',v=>v.accessTemplateSha256='0'.repeat(64),v=>v.sourcePins.pop(),v=>v.artifactPins.pop()]){
    const v=structuredClone(m);change(v);const t=JSON.stringify(v);assert.throws(()=>validate(t,hash(t),now));}
  assert.throws(()=>validate(raw,'0'.repeat(64),now));assert.throws(()=>validate(raw,hash(raw),Date.parse(m.latestStartAt)));
  await assert.rejects(main(['InstallAccessReviewed','bad','a'.repeat(64)]),/INSTALL_ARGUMENTS/);assert(SOURCES.includes(RISK));
});
test('current price estimate is an explicit example, not account forecast or automatic cost cap',()=>{
  const e=estimate({vcpuHour:.04456,gbHour:.004865,albHour:.02475,lcuHour:.0088,ipv4Hour:.005,secretMonth:.4});
  assert(Math.abs(e.exampleTwoHoursUsd-.13555)<1e-10);assert(Math.abs(e.core730HoursUsd-49.87575)<1e-10);assert(e.notAHardCap);
});
test('implicit main route is valid only without a conflicting explicit subnet association',()=>{
  const main={RouteTableId:P.routeTable,VpcId:P.vpc,Associations:[{Main:true,AssociationState:{State:'associated'}}],Routes:[{DestinationCidrBlock:'0.0.0.0/0',GatewayId:P.igw,State:'active'}]};
  assertPublicRoutes([main]);const other={RouteTableId:'rtb-other',VpcId:P.vpc,Associations:[{SubnetId:P.subnets[0],AssociationState:{State:'associated'}}],Routes:[]};
  assert.throws(()=>assertPublicRoutes([main,other]),/SUBNET_ROUTE_OVERRIDE/);const stale=structuredClone(main);stale.Routes[0].State='blackhole';assert.throws(()=>assertPublicRoutes([stale]),/PUBLIC_ROUTES/);
});
test('No-AWS workflow and new client have no Secret-value, SQL, task-run or compute-create path',async()=>{
  const w=load(await readFile(new URL('../'+CI_PATH,import.meta.url),'utf8'));assert.deepEqual(w.permissions,{contents:'read'});assert.equal(w.jobs.candidate.environment,undefined);
  assert.doesNotMatch(JSON.stringify(w),/secrets\.|id-token|aws-actions|upload-artifact|workflow_dispatch|docker|InstallAccessReviewed/);
  const c=await readFile(new URL('../ops/platform-ecs-v1/cloud.mjs',import.meta.url),'utf8');assert.doesNotMatch(c,/GetSecretValueCommand|RunTaskCommand|new pg\./);
  assert.match(c,/DisableRollback:true/);assert.match(c,/Capabilities:\['CAPABILITY_NAMED_IAM'\]/);
  console.log('PLATFORM_ECS_ACCESS_AND_DRAFT_CONTRACTS_VERIFIED_NO_AWS');
});
