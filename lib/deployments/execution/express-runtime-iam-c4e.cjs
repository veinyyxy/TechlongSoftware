'use strict';
/* eslint-disable @typescript-eslint/no-require-imports -- Pure fixed reviewed IAM compiler; no AWS client. */
const db=require('./aurora-database-contract-v2.cjs');
const BOUNDARY='arn:aws:iam::402010193138:policy/TechlongSandboxServiceRoleBoundary';
const SECRET='arn:aws:secretsmanager:ca-central-1:402010193138:secret:techlong/sandbox/tenant/a4377bce498b9c5ee9e64509dcad_a0da1748bc/runtime/g1-T9CqN5';
const VERSION='0f45d29f-02d4-4117-99b1-c06645aa3c6e';
const DB_ROOT='arn:aws:rds-db:ca-central-1:402010193138:dbuser:cluster-XBWGLIW2B3HPGX3ROHYJA7CNPM/';
const APP='TechlongSandboxTaskRole',LIFE='TechlongSandboxTenantLifecycleTaskRole',EXEC='TechlongSandboxTaskExecutionRole';
const ROLE_IDS={[APP]:'AROAV3GNMXTZLH2AU5I5G',[LIFE]:'AROAV3GNMXTZDIWVT3BKN',[EXEC]:'AROAV3GNMXTZJHJWAN4IR'};
const CONSUMERS={...ROLE_IDS,TechlongSandboxJanitorExecutionRole:'AROAV3GNMXTZBRVMWJVKS',TechlongSandboxCodeBuildRole:'AROAV3GNMXTZOK74TOJ7W',
  TechlongSandboxSchedulerInvokeRole:'AROAV3GNMXTZA6QTHNW3I',TechlongSandboxDeploymentWorkerRole:'AROAV3GNMXTZMR72QS7FW'};
const RUN_SLOT='techlong-d002-express-c4e-iam-install-v1.permanent-slot.json',INSPECT_SLOT='techlong-d002-express-c4e-iam-inspect-v1.permanent-slot.json';
const arn=name=>'arn:aws:iam::402010193138:role/'+name,same=(a,b)=>db.canonicalJson(a)===db.canonicalJson(b);
function fail(code){throw Object.assign(Error(code),{code,retryable:false});}
function freeze(v){if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;}
function common(i){
  if(i.roles?.length!==3||i.boundary?.arn!==BOUNDARY||i.boundary.id!=='ANPAV3GNMXTZHXSTCQBZC'||
    !same(i.boundary.boundaryConsumers,{roles:Object.entries(CONSUMERS).map(([name,id])=>({name,id})).sort((a,b)=>a.name.localeCompare(b.name)),users:[],groups:[]})||
    !same(i.boundary.permissionConsumers,{roles:[],users:[],groups:[]}))fail('C4E_CONSUMER_OR_BOUNDARY_CHANGED');
  for(const r of i.roles)if(r.id!==ROLE_IDS[r.name]||r.arn!==arn(r.name)||r.boundaryArn!==BOUNDARY||r.attached?.length||
    db.digest(r.trust)!=='9ec5e1fb535016888f55f2c41f2a93c05b1e2eebf6215874025d02940c0bfb33')fail('C4E_ROLE_ID_OR_TRUST_CHANGED');
  if(new Set(i.roles.map(r=>r.name)).size!==3||i.boundary.versions?.length<1||i.boundary.versions.length>5||
    i.boundary.versions.some(v=>!/^v[1-9][0-9]*$/.test(v.id))||new Set(i.boundary.versions.map(v=>v.id)).size!==i.boundary.versions.length||
    i.boundary.versions.filter(v=>v.isDefault).length!==1||!i.boundary.versions.some(v=>v.id===i.boundary.defaultVersion&&v.isDefault))fail('C4E_POLICY_VERSION_STATE_CHANGED');
}
function compile(i){
  common(i);const find=n=>i.roles.find(r=>r.name===n),app=find(APP),life=find(LIFE),exec=find(EXEC);
  if(app.inline.length||life.inline.length!==1||life.inline[0].name!=='ImmutableReceiptsAndGenerationSecretRead'||
    exec.inline.length!==1||exec.inline[0].name!=='PullSandboxImageAndRuntimeSecrets'||
    db.digest(life.inline[0].document)!=='a49a6343396c4c7ebe465a8bec2a9f3d7e8e5981049d6cc93c049a2e8d47148b'||
    db.digest(exec.inline[0].document)!=='e7b9ca6f4633ea706d99c337e0b728b2c625017b7de9f552126895eef1276199'||
    db.digest(i.boundary.document)!=='f2d2533515558b1afbca3e275f530c9a6cbf4421fac68581a496cc4939abb89f'||i.boundary.defaultVersion!=='v3'||i.boundary.versions.length>4)
    fail('C4E_BASELINE_OR_VERSION_CAPACITY_CHANGED');
  const connect=(name,user,Sid)=>({Sid,Effect:'Allow',Action:'rds-db:connect',Resource:DB_ROOT+user,Condition:{ArnEquals:{'aws:PrincipalArn':arn(name)}}});
  const appConnect=connect(APP,'tenant_a0da1748bc4d5419_role','C4eAppConnect'),managementConnect=connect(LIFE,'postgres','C4eMgmtConnect');
  const pinnedRead={Sid:'C4eSecretRead',Effect:'Allow',Action:'secretsmanager:GetSecretValue',Resource:SECRET,Condition:{StringEquals:{'secretsmanager:VersionId':VERSION}}};
  const versionDeny={Sid:'C4eOtherSecretVersion',Effect:'Deny',Action:'secretsmanager:GetSecretValue',Resource:SECRET,Condition:{StringNotEquals:{'secretsmanager:VersionId':VERSION}}};
  const boundary=structuredClone(i.boundary.document);boundary.Statement.push(appConnect,managementConnect,versionDeny);
  const lifecycle=structuredClone(life.inline[0].document);lifecycle.Statement.push(managementConnect,pinnedRead);
  const application={Version:'2012-10-17',Statement:[appConnect]};
  const size=Buffer.byteLength(JSON.stringify(boundary),'utf8');if(size>6144||Buffer.byteLength(JSON.stringify(lifecycle),'utf8')>10240)fail('C4E_POLICY_SIZE_LIMIT');
  return freeze({schema:'techlong/express-runtime-iam-program/c4e',secretArn:SECRET,secretVersionId:VERSION,
    applicationConnectResource:appConnect.Resource,managementConnectResource:managementConnect.Resource,boundaryPolicyBytes:size,
    actions:[{api:'CreatePolicyVersion',input:{PolicyArn:BOUNDARY,PolicyDocument:JSON.stringify(boundary),SetAsDefault:true}},
      {api:'PutRolePolicy',input:{RoleName:LIFE,PolicyName:life.inline[0].name,PolicyDocument:JSON.stringify(lifecycle)}},
      {api:'PutRolePolicy',input:{RoleName:APP,PolicyName:'ConnectExactExpressTenantC4e',PolicyDocument:JSON.stringify(application)}}],
    documents:{boundary,lifecycle,application,execution:structuredClone(exec.inline[0].document)},
    sharedBoundaryConsumerCount:7,oldBoundaryStatementsPreserved:true,oldLifecycleStatementsPreserved:true,
    executionInlineUnchanged:true,trustAndAttachmentsUnchanged:true,noPolicyVersionDelete:true,executionAuthorized:false,runtimeEnabled:false});
}
function simulations(p){
  const context=(role,version)=>[{ContextKeyName:'aws:PrincipalArn',ContextKeyType:'string',ContextKeyValues:[arn(role)]},
    {ContextKeyName:'aws:RequestedRegion',ContextKeyType:'string',ContextKeyValues:['ca-central-1']},
    ...(version===null?[]:[{ContextKeyName:'secretsmanager:VersionId',ContextKeyType:'string',ContextKeyValues:[version]}])];
  const c=(name,document,action,resources,role,version,decisions)=>({name,input:{PolicyInputList:[JSON.stringify(document)],
    PermissionsBoundaryPolicyInputList:[JSON.stringify(p.documents.boundary)],ActionNames:[action],ResourceArns:resources,ContextEntries:context(role,version)},expected:decisions});
  return [c('application-connect',p.documents.application,'rds-db:connect',[p.applicationConnectResource,p.managementConnectResource],APP,VERSION,['allowed','implicitDeny']),
    c('management-connect',p.documents.lifecycle,'rds-db:connect',[p.managementConnectResource,p.applicationConnectResource],LIFE,VERSION,['allowed','implicitDeny']),
    c('execution-pinned-read',p.documents.execution,'secretsmanager:GetSecretValue',[SECRET],EXEC,VERSION,['allowed']),
    c('lifecycle-pinned-read',p.documents.lifecycle,'secretsmanager:GetSecretValue',[SECRET],LIFE,VERSION,['allowed']),
    c('execution-wrong-version',p.documents.execution,'secretsmanager:GetSecretValue',[SECRET],EXEC,'00000000-0000-4000-8000-000000000000',['explicitDeny']),
    c('execution-missing-version',p.documents.execution,'secretsmanager:GetSecretValue',[SECRET],EXEC,null,['explicitDeny'])];
}
function simulationRows(result){
  if(!Array.isArray(result.EvaluationResults))fail('C4E_POLICY_SIMULATION_CHANGED');
  return result.EvaluationResults.flatMap(r=>Array.isArray(r.ResourceSpecificResults)&&r.ResourceSpecificResults.length?
    r.ResourceSpecificResults.map(x=>({EvalActionName:r.EvalActionName,EvalResourceName:x.EvalResourceName,EvalDecision:x.EvalResourceDecision,
      MissingContextValues:x.MissingContextValues||[],PermissionsBoundaryDecisionDetail:x.PermissionsBoundaryDecisionDetail})):r);
}
function checkSimulation(c,result){
  if(result.IsTruncated)fail('C4E_POLICY_SIMULATION_CHANGED');
  const rows=simulationRows(result);
  if(!Array.isArray(rows)||rows.length!==c.expected.length)fail('C4E_POLICY_SIMULATION_CHANGED');
  for(let n=0;n<c.expected.length;n++){
    const r=rows.find(r=>r.EvalResourceName===c.input.ResourceArns[n]&&r.EvalActionName===c.input.ActionNames[0]);
    if(!r||r.EvalDecision!==c.expected[n]||c.expected[n]==='allowed'&&r.MissingContextValues?.length)fail('C4E_POLICY_SIMULATION_CHANGED');
  }
}
function prepare({facts,inventory,codeBindingSha256,program,now}){
  if(!/^[a-f0-9]{64}$/.test(codeBindingSha256)||!same(compile(inventory),program)||!Number.isFinite(Date.parse(facts.observedAt))||
    now<Date.parse(facts.observedAt)||now-Date.parse(facts.observedAt)>30000)fail('C4E_REVIEW_INPUT_REJECTED');
  const body={schema:'techlong/express-runtime-iam-review/c4e',preparedAt:new Date(now).toISOString(),expiresAt:new Date(now+6*3600000).toISOString(),
    codeBindingSha256,facts,inventory,program,slots:{run:RUN_SLOT,inspect:INSPECT_SLOT},limits:{iamWrites:3,policyVersionDeletes:0,secretValueReads:0,sqlConnections:0,retries:0,metadataCallsPerModeMaximum:48},
    risks:['Three persistent IAM writes are not atomic/CAS. Failure can leave a new default boundary or some active inline grants; no automatic revoke, rollback, completion, version deletion or retry.',
      'Shared boundary has seven exact role consumers. New rds-db grants are principal-ARN scoped to app/lifecycle; the new exact-Secret version Deny affects all seven consumers for this Secret, including requests omitting VersionId. Old Full and other resources/statements stay unchanged.',
      'The lifecycle role receives postgres management connect and access to four private runtime keys; SQL rights and actual IAM/KMS/session/SCP behavior are not proved by policy simulation.',
      'Current execution prefix Secret read is retained, but boundary Deny restricts this new Secret to the approved VersionId. Other administrators/resource/session policies are not fully inventoried; this is not account-wide Secret isolation.',
      'ARN/RoleId checks and metadata have race windows; concurrent deletion/recreation, default-version changes, propagation lag or stale readback can remain inconclusive. No trust/role replacement is allowed.',
      'These direct IAM changes may drift infrastructure-managed policy/role resources; later CloudFormation or manual updates can overwrite grants/default versions. No old stack/template is updated or replayed here.',
      'Source remains an existing administrator. AWS Login refresh may fail; temporary snapshot must pass STS and have 120 seconds left. Provider logs can retain metadata.',
      'New permanent install/inspect slots never reset or retry. Lost responses/local persistence failures can leave unknown live permissions; only the single independent metadata Inspect is approved after a consumed install attempt.',
      'IAM does not create a paid Cell here, but existing Secret/Aurora/resources can accrue costs; 50 USD/month is a target, not a cap. No GetSecretValue, SQL LOGIN/GRANT, authority, ECS/Lambda/ECR deployment or runtime enablement is approved.'],
    simulationsAreNotLiveAccessProof:true,runtimeEnabled:false,readyVerified:false,executionAuthorized:false};
  return freeze({...body,manifestSha256:db.digest(body)});
}
function approval(m,sha,codeSha,now){
  const {manifestSha256,...body}=m;
  if(sha!==manifestSha256||db.digest(body)!==manifestSha256||m.codeBindingSha256!==codeSha||now<Date.parse(m.preparedAt)||now>=Date.parse(m.expiresAt))fail('C4E_FRESH_APPROVAL_REQUIRED');
  if(!same(prepare({facts:m.facts,inventory:m.inventory,codeBindingSha256:codeSha,program:m.program,now:Date.parse(m.preparedAt)}),m))fail('C4E_SCOPE_DRIFT');
}
function inspect(before,after,p){
  common(after);const wanted=structuredClone(before);wanted.roles.find(r=>r.name===APP).inline=[{name:'ConnectExactExpressTenantC4e',document:p.documents.application}];
  wanted.roles.find(r=>r.name===LIFE).inline[0].document=p.documents.lifecycle;
  const old=after.roles.every(r=>same(r,before.roles.find(x=>x.name===r.name))),updated=after.roles.every(r=>same(r,wanted.roles.find(x=>x.name===r.name)));
  const oldVersions=before.boundary.versions.map(v=>v.id),versions=after.boundary.versions.map(v=>v.id),extra=versions.filter(id=>!oldVersions.includes(id));
  if(!oldVersions.every(id=>versions.includes(id)))fail('C4E_OLD_POLICY_VERSION_MISSING');
  if(updated&&same(after.boundary.document,p.documents.boundary)&&extra.length===1&&after.boundary.defaultVersion===extra[0])return 'IAM_DOCUMENTS_INDEPENDENTLY_OBSERVED_NOT_RUNTIME_VERIFIED';
  if(old&&same(before,after))return 'IAM_ORIGINAL_STATE_OBSERVED_INSTALL_NOT_PROVED';
  return 'IAM_PARTIAL_OR_DIVERGENT_STATE_REQUIRES_REVIEW';
}
module.exports={BOUNDARY,SECRET,VERSION,APP,LIFE,EXEC,ROLE_IDS,CONSUMERS,RUN_SLOT,INSPECT_SLOT,compile,simulations,simulationRows,checkSimulation,prepare,approval,inspect};
