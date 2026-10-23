// Existing identities only. Pure review/template logic; no credentials or I/O.
import {createHash} from 'node:crypto';
import {P,canonical,same,policySame,handoffPolicy} from '../platform-ecs-v1/contract.mjs';
import {accessTemplate,executionPolicy,trust,tags} from '../platform-ecs-v1/templates.mjs';
import {secretPolicyV6} from '../platform-activation-v6/credentials.mjs';
export {canonical,same,policySame};
export const H=Object.freeze({account:P.account,region:P.region,profile:P.profile,sourceArn:P.sourceArn,sourceId:P.sourceId,
  stackId:'arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-platform-access-v1/01b4bb80-ce60-11f1-9435-0e85c8c75895',
  baseNonce:'aca6c7934875a069a696bbe47d9b7b35',role:P.role,roleArn:P.roleArn,roleId:'AROAV3GNMXTZJ45S2ANZ7',
  boundaryArn:P.boundaryArn,boundaryId:'ANPAV3GNMXTZP7KMHXNYF',inline:P.inline,kmsArn:P.kmsArn,
  controllerArn:'arn:aws:secretsmanager:ca-central-1:402010193138:secret:techlong/sandbox/platform-controller/neon-v6-M4A08E',
  controllerVersion:'3574f24e-ecb3-476c-8f71-baa501fd129e',appName:'techlong/sandbox/platform-controller/github-app-v6',
  keyFile:'E:/NodejsProject/TechlongSoftware/techlong-sandbox-controller.2026-10-19.private-key.pem',
  slot:'F:/ChatGPT_workshop/techlong-platform-hosted-supply-v6.intent.json',
  riskFile:'docs/aws-auto-deployment-platform-w8d-supply-review.md',ciPath:'.github/workflows/platform-hosted-access-candidate.yml',
  validMs:48*3600000,runMs:20*60000});
export const SCOPE=Object.freeze({createEmptyAppSecret:1,protectAppSecret:1,putFixedAppVersion:1,
  createAccessChangeSet:1,executeAccessChangeSet:1,controllerReadHandoff:1,appReadHandoff:1,
  topLevelAwsWritesMax:7,keyFileReadsMax:1,secretValueReads:0,sqlConnections:0,newIamIdentities:0,
  githubTokenRequests:0,workflowDispatches:0,imagePublications:0,hostingDeployments:0,deletions:0,automaticWriteRetries:0});
export const must=(v,c)=>{if(!v)throw Error('HOSTED_SUPPLY_'+c);};
export const hash=v=>createHash('sha256').update(v).digest('hex');
export const safeCode=e=>/^(HOSTED_SUPPLY_[A-Z0-9_]+)$/.test(e?.message??'')?e.message:/^[A-Za-z0-9_]{1,80}$/.test(e?.name??'')?e.name:'OperationFailed';
export function appArn(arn){must(typeof arn==='string'&&new RegExp('^arn:aws:secretsmanager:'+H.region+':'+H.account+':secret:'+H.appName+'-[A-Za-z0-9]{6}$').test(arn),'APP_ARN');return arn;}
export function versionId(v){must(typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v),'VERSION_ID');return v;}
export function readPolicy(handoff=false){const p=secretPolicyV6();if(handoff){p.Statement[0].Sid='OnlySourceAndExecutionMayReadControllerCredential';
  p.Statement[0].Condition.ArnNotEquals['aws:PrincipalArn']=[H.sourceArn,H.roleArn];}return p;}
export function suppliedTemplate(arn,version){appArn(arn);versionId(version);const t=accessTemplate(H.baseNonce),p=executionPolicy();
  for(const [label,secret,id]of [['Controller',H.controllerArn,H.controllerVersion],['AppKey',arn,version]])p.Statement.push(
    {Sid:'Exact'+label+'SecretVersion',Effect:'Allow',Action:'secretsmanager:GetSecretValue',Resource:secret,
      Condition:{StringEquals:{'secretsmanager:VersionId':id}}},
    {Sid:'Exact'+label+'ForwardedDecrypt',Effect:'Allow',Action:'kms:Decrypt',Resource:H.kmsArn,Condition:{StringEquals:{
      'kms:ViaService':`secretsmanager.${H.region}.amazonaws.com`,'kms:CallerAccount':H.account,
      'kms:EncryptionContext:SecretARN':secret,'kms:EncryptionContext:SecretVersionId':id}}});
  t.Resources.ExecutionBoundary.Properties.PolicyDocument=p;t.Resources.ExecutionRole.Properties.Policies[0].PolicyDocument=structuredClone(p);return t;}
export function verifyAccess(a,{arn,version,installed=false}={}){
  const t=installed?suppliedTemplate(arn,version):accessTemplate(H.baseNonce),p=t.Resources.ExecutionBoundary.Properties.PolicyDocument;
  must(a?.stackId===H.stackId&&a.status===(installed?'UPDATE_COMPLETE':'CREATE_COMPLETE')&&same(a.template,t)&&
    a.stackRoleArn===null&&a.parameters.length===0&&
    a.roleId===H.roleId&&a.roleArn===H.roleArn&&a.policyId===H.boundaryId&&a.boundaryArn===H.boundaryArn&&
    a.path==='/'&&a.maxSessionDuration===3600&&a.roleBoundaryArn===H.boundaryArn&&
    policySame(a.trust,trust())&&policySame(a.inline,p)&&policySame(a.boundary,p)&&
    same(a.inlineNames,[H.inline])&&a.managed.length===0&&a.listsComplete===true&&
    same(a.roleTags.filter(t=>!t.Key.startsWith('aws:')).sort((a,b)=>a.Key.localeCompare(b.Key)),tags(H.baseNonce).sort((a,b)=>a.Key.localeCompare(b.Key)))&&
    a.roleTags.filter(t=>t.Key.startsWith('aws:')).every(t=>({'aws:cloudformation:stack-id':H.stackId,
      'aws:cloudformation:stack-name':P.accessStack,'aws:cloudformation:logical-id':'ExecutionRole'})[t.Key]===t.Value)&&
    new Set(a.roleTags.map(t=>t.Key)).size===a.roleTags.length&&a.attachmentCount===0&&a.boundaryUsageCount===1&&a.defaultVersion===(installed?'v2':'v1')&&
    a.policyVersions.every(v=>(installed?['v1','v2']:['v1']).includes(v))&&a.policyVersions.includes(a.defaultVersion)&&
    a.resources.length===2&&a.resources.every(r=>['CREATE_COMPLETE','UPDATE_COMPLETE'].includes(r.status))&&
    a.resources.some(r=>r.logicalId==='ExecutionRole'&&r.type==='AWS::IAM::Role'&&r.physicalId===H.role)&&
    a.resources.some(r=>r.logicalId==='ExecutionBoundary'&&r.type==='AWS::IAM::ManagedPolicy'&&r.physicalId===H.boundaryArn),'ACCESS_DRIFT');
  return true;
}
export function verifySecret(s,{arn,version,policy,empty=false,kmsDefault=false}){
  must(s?.arn===arn&&!s.deleted&&!s.rotation&&s.replicas===0&&s.complete&&
    (kmsDefault?s.kmsArn===null||s.kmsArn===H.kmsArn:s.kmsArn===H.kmsArn)&&policySame(s.policy,policy)&&
    (empty?s.versions.length===0&&Object.keys(s.stages).length===0:s.versions.length===1&&s.versions[0].id===version&&
      same(s.versions[0].stages,['AWSCURRENT'])&&same(s.stages,{[version]:['AWSCURRENT']})),'SECRET_DRIFT');return true;
}
export function verifyBaseline(v){
  must(v?.source?.Account===H.account&&v.source.Arn===H.sourceArn&&v.source.UserId===H.sourceId&&v.app===null&&
    v.pendingChangeSets.length===0&&v.pendingComplete===true&&v.kms?.arn===H.kmsArn&&v.kms.manager==='AWS'&&v.kms.enabled===true,'PRESTATE');
  verifyAccess(v.access);verifySecret(v.controller,{arn:H.controllerArn,version:H.controllerVersion,policy:readPolicy(),kmsDefault:true});
  verifySecret(v.web,{arn:P.secretArn,version:P.secretVersion,policy:handoffPolicy()});return true;
}
export function verifyInstalled(v,arn,version){
  must(v.source?.Account===H.account&&v.source.Arn===H.sourceArn&&v.source.UserId===H.sourceId,'SOURCE');verifyAccess(v.access,{arn,version,installed:true});
  verifySecret(v.controller,{arn:H.controllerArn,version:H.controllerVersion,policy:readPolicy(true),kmsDefault:true});
  verifySecret(v.web,{arn:P.secretArn,version:P.secretVersion,policy:handoffPolicy()});
  verifySecret(v.app,{arn:appArn(arn),version:versionId(version),policy:readPolicy(true),kmsDefault:true});return true;
}
export function changeSetName(nonce){must(/^[a-f0-9]{32}$/.test(nonce),'NONCE');return 'hosted-supply-'+nonce;}
export function verifiedCreatedArn(record,m,sha){must(record?.manifestSha256===sha&&record.nonce===m.nonce&&record.versionId===m.versionId,'CREATE_ACK_BINDING');return appArn(record.arn);}
export function verifyChangeSet(c,template,m,arn){
  // DescribeChangeSet does NOT echo ChangeSetType. UPDATE is fixed in the
  // reviewed creation request; verify actual existing physical Modify targets.
  must(c?.StackId===H.stackId&&c.StackName===P.accessStack&&c.ChangeSetName===changeSetName(m.nonce)&&c.Status==='CREATE_COMPLETE'&&
    c.ExecutionStatus==='AVAILABLE'&&!c.NextToken&&!c.RoleARN&&!c.ParentChangeSetId&&!c.RootChangeSetId&&
    !c.IncludeNestedStacks&&!c.ImportExistingResources&&!c.DeploymentMode&&same(c.Capabilities,['CAPABILITY_NAMED_IAM'])&&
    c.Changes?.length===2&&(c.Parameters??[]).length===0&&same(template,suppliedTemplate(arn,m.versionId)),'CHANGE_SET');
  must(new Set(c.Changes.map(x=>x.ResourceChange?.LogicalResourceId)).size===2&&c.Changes.every(x=>{
    const r=x.ResourceChange,role=r?.LogicalResourceId==='ExecutionRole';return ['ExecutionRole','ExecutionBoundary'].includes(r?.LogicalResourceId)&&
      x.Type==='Resource'&&r.Action==='Modify'&&r.Replacement==='False'&&
      r.ResourceType===(role?'AWS::IAM::Role':'AWS::IAM::ManagedPolicy')&&
      r.PhysicalResourceId===(role?H.role:H.boundaryArn)&&r.Scope?.length===1&&r.Scope[0]==='Properties'&&
      r.Details?.length>0&&r.Details.every(d=>d.ChangeSource==='DirectModification'&&d.Evaluation==='Static'&&
        d.Target?.Attribute==='Properties'&&d.Target.Name===(role?'Policies':'PolicyDocument')&&d.Target.RequiresRecreation==='Never');
  }),'CHANGE_SET_SCOPE');return true;
}
export function makeReview({sourceCommit,pins,ci,prestate,keyMetadata,nonce,versionId:version,issuedAt,riskSha256}){
  verifyBaseline(prestate);versionId(version);changeSetName(nonce);
  must(/^[a-f0-9]{40}$/.test(sourceCommit)&&ci?.sourceCommit===sourceCommit&&ci.path===H.ciPath&&ci.status==='completed'&&
    ci.conclusion==='success'&&ci.attempt===1&&Number.isSafeInteger(ci.runId)&&ci.runId>0&&/^[a-f0-9]{64}$/.test(riskSha256)&&
    Number.isSafeInteger(issuedAt)&&issuedAt>0&&Array.isArray(pins)&&pins.length>5&&new Set(pins.map(p=>p.file)).size===pins.length&&
    pins.every(p=>typeof p.file==='string'&&/^[a-f0-9]{64}$/.test(p.sha256))&&
    keyMetadata?.protectedThreePrincipalAcl===true&&keyMetadata.keyContentRead===false&&
    Number.isSafeInteger(keyMetadata.length)&&keyMetadata.length>0&&keyMetadata.length<=16000&&/^[a-f0-9]{64}$/.test(keyMetadata.aclSha256),'REVIEW_INPUT');
  return {schema:'techlong/platform-hosted-supply-review/v6',sourceCommit,pins,ci,prestate,keyMetadata,nonce,versionId:version,issuedAt,
    expiresAt:issuedAt+H.validMs,latestStartAt:issuedAt+H.validMs-H.runMs,riskSha256,scope:{...SCOPE},constants:{...H},
    appArnBinding:'Only exact creation-returned ARN of the fixed name/account/region; never wildcard or replacement',
    templateFactory:'suppliedTemplate(exactReturnedArn,approvedVersionId)',permanentSlot:H.slot,preparationIsNotApproval:true};
}
export function validate(text,sha,now=Date.now(),audit=false){
  must(typeof text==='string'&&text.length<200000&&/^[a-f0-9]{64}$/.test(sha??'')&&hash(text)===sha,'APPROVAL_SHA');
  const m=JSON.parse(text);must(same(m,makeReview(m)),'MANIFEST_DRIFT');
  if(!audit)must(Number.isSafeInteger(now)&&now>=m.issuedAt&&now<=m.latestStartAt,'EXPIRED');return m;
}
export async function install({text,sha,io,now=Date.now}){
  const m=validate(text,sha,now()),freshStart=now(),before=await io.preflight(m);verifyBaseline(before);
  must(same(before,m.prestate)&&now()-freshStart<120000,'FRESH_DRIFT');validate(text,sha,now());
  await io.consume({manifestSha256:sha,nonce:m.nonce,versionId:m.versionId,startedAtUtc:new Date(now()).toISOString(),retryAllowed:false});
  const started=now();let phase='SLOT_CONSUMED',arn=null,cs=null,writes=0;const errors=[];
  let last=started;
  const guard=async()=>{const t=now();must(t>=last&&t<m.expiresAt&&t-started<H.runMs,'ACTIVE_WINDOW');last=t;await io.assertCurrent(m);};
  const write=async(name,action)=>{phase=name;await guard();must(++writes<=7,'WRITE_LIMIT');await io.record(name+'-intent',{phase:name,attempt:writes,retryAllowed:false});return action();};
  try{
    phase='START_WRITE_WINDOW';io.startWrites(Math.min(m.expiresAt,started+H.runMs));
    arn=appArn(await write('create-empty',()=>io.createEmpty(m)));await io.record('app-created',{arn,versionId:m.versionId,manifestSha256:sha,nonce:m.nonce});
    await write('protect-app',()=>io.putPolicy(arn,readPolicy()));await io.verifyApp(arn,m,{empty:true,handoff:false});
    await guard();phase='PRIVATE_KEY_READ_AND_FIXED_PUT';
    // One read, strictly after empty/protected metadata proof. No value in receipts.
    await write('put-fixed-version',()=>io.putKey(arn,m));await io.verifyApp(arn,m,{empty:false,handoff:false});
    cs=await write('create-access-change-set',()=>io.createChangeSet(arn,m));await io.record('change-set-created',{arn:cs});
    phase='STRICT_CHANGE_SET_REVIEW';await io.reviewChangeSet(cs,arn,m);await io.assertBaseAccess();
    await write('execute-access-change-set',()=>io.executeChangeSet(cs,m));
    phase='WAIT_AND_VERIFY_ACCESS';await io.waitAccess(arn,m);await io.verifyControllerSourceOnly();
    await write('controller-read-handoff',()=>io.putPolicy(H.controllerArn,readPolicy(true)));
    await io.verifyApp(arn,m,{empty:false,handoff:false});
    await write('app-read-handoff',()=>io.putPolicy(arn,readPolicy(true)));
  }catch(e){errors.push({phase,code:safeCode(e)});}
  let observed=false;
  try{const state=await io.independentSnapshot();await io.record('independent-observation',state);verifyInstalled(state,arn,m.versionId);observed=true;}
  catch(e){errors.push({phase:'INDEPENDENT_METADATA',code:safeCode(e)});}
  const result={schema:'techlong/platform-hosted-supply-result/v6',manifestSha256:sha,nonce:m.nonce,appArn:arn,versionId:m.versionId,
    changeSetArn:cs,outcome:errors.length===0&&writes===7&&observed?'SUPPLY_METADATA_INDEPENDENTLY_VERIFIED':'SUPPLY_REQUIRES_INSPECT_NO_RETRY',
    topLevelWritesAttempted:writes,awsCalls:io.counts?{...io.counts}:null,errors,retryAllowed:false,privateValueRecorded:false,runtimeEnabled:false,hostingDeployed:false};
  await io.record('result',result);return result;
}
