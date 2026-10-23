// Metadata discovery and seven allow-listed mutations. No Secret value reads/SQL.
import {Agent} from 'node:https';
import {execFileSync} from 'node:child_process';
import {createPrivateKey} from 'node:crypto';
import {NodeHttpHandler} from '@smithy/node-http-handler';
import {fromLoginCredentials} from '@aws-sdk/credential-provider-login';
import {STSClient,GetCallerIdentityCommand} from '@aws-sdk/client-sts';
import * as I from '@aws-sdk/client-iam';
import * as C from '@aws-sdk/client-cloudformation';
import {SecretsManagerClient,DescribeSecretCommand,GetResourcePolicyCommand,ListSecretVersionIdsCommand,
  CreateSecretCommand,PutResourcePolicyCommand,PutSecretValueCommand,ValidateResourcePolicyCommand} from '@aws-sdk/client-secrets-manager';
import {awsEnvironment} from '../platform-web-credential-v1/aws.mjs';
import {P} from '../platform-ecs-v1/contract.mjs';
import {trust} from '../platform-ecs-v1/templates.mjs';
import {readKeyOnce} from '../platform-identity-review-v6/dispatch-local.mjs';
import {H,must,appArn,canonical,same,policySame,readPolicy,suppliedTemplate,verifyAccess,verifySecret,verifyChangeSet,changeSetName} from './contract.mjs';
const decode=v=>typeof v==='string'?JSON.parse(decodeURIComponent(v)):v;
export function createCloud(){
  awsEnvironment();const config={region:H.region,maxAttempts:1,ignoreConfiguredEndpointUrls:true,
    credentials:fromLoginCredentials({profile:H.profile,ignoreCache:true})};
  const sdk=(endpoint,region=H.region)=>({...config,endpoint,region,requestHandler:new NodeHttpHandler({
    httpsAgent:new Agent({family:4,keepAlive:false}),connectionTimeout:5000,socketTimeout:20000})});
  const clients=()=>({sts:new STSClient(sdk('https://sts.ca-central-1.amazonaws.com')),
    iam:new I.IAMClient(sdk('https://iam.amazonaws.com','us-east-1')),
    sm:new SecretsManagerClient(sdk('https://secretsmanager.ca-central-1.amazonaws.com')),
    cfn:new C.CloudFormationClient(sdk('https://cloudformation.ca-central-1.amazonaws.com'))});
  const writer=clients(),attempts=new Set(),counts={metadata:0,writes:0,keyReads:0};let createdArn,writeDeadline=0;
  const dispose=c=>Object.values(c).forEach(x=>x.destroy());
  const get=(c,x)=>{counts.metadata++;return c.send(x,{abortSignal:AbortSignal.timeout(30000)});};
  async function once(label,c,x){must(Date.now()<writeDeadline,'WRITE_WINDOW');must(!attempts.has(label)&&counts.writes<7,'WRITE_ALREADY_ATTEMPTED');attempts.add(label);counts.writes++;
    return c.send(x,{abortSignal:AbortSignal.timeout(30000)});}
  async function source(c){const v=await get(c.sts,new GetCallerIdentityCommand({}));
    must(v.Account===H.account&&v.Arn===H.sourceArn&&v.UserId===H.sourceId,'SOURCE');return {Account:v.Account,Arn:v.Arn,UserId:v.UserId};}
  async function secret(c,id,optional=false){let d;
    try{d=await get(c.sm,new DescribeSecretCommand({SecretId:id}));}catch(e){if(optional&&e.name==='ResourceNotFoundException')return null;throw e;}
    const [p,v]=await Promise.all([get(c.sm,new GetResourcePolicyCommand({SecretId:d.ARN})),
      get(c.sm,new ListSecretVersionIdsCommand({SecretId:d.ARN,IncludeDeprecated:true,MaxResults:100}))]);
    return {arn:d.ARN,name:d.Name,kmsArn:d.KmsKeyId??null,deleted:!!d.DeletedDate,rotation:!!d.RotationEnabled,
      replicas:d.ReplicationStatus?.length??0,complete:!v.NextToken,stages:d.VersionIdsToStages??{},
      versions:(v.Versions??[]).map(x=>({id:x.VersionId,stages:x.VersionStages??[]})),policy:p.ResourcePolicy?JSON.parse(p.ResourcePolicy):null,
      tags:[...(d.Tags??[])].sort((a,b)=>a.Key.localeCompare(b.Key))};
  }
  async function access(c){
    const [r,b,inline,names,managed,versions,st,t,resources]=await Promise.all([
      get(c.iam,new I.GetRoleCommand({RoleName:H.role})),get(c.iam,new I.GetPolicyCommand({PolicyArn:H.boundaryArn})),
      get(c.iam,new I.GetRolePolicyCommand({RoleName:H.role,PolicyName:H.inline})),get(c.iam,new I.ListRolePoliciesCommand({RoleName:H.role})),
      get(c.iam,new I.ListAttachedRolePoliciesCommand({RoleName:H.role})),get(c.iam,new I.ListPolicyVersionsCommand({PolicyArn:H.boundaryArn})),
      get(c.cfn,new C.DescribeStacksCommand({StackName:H.stackId})),get(c.cfn,new C.GetTemplateCommand({StackName:H.stackId,TemplateStage:'Original'})),
      get(c.cfn,new C.ListStackResourcesCommand({StackName:H.stackId}))]);
    must(st.Stacks?.length===1&&r.Role&&b.Policy,'METADATA_SHAPE');
    const d=await get(c.iam,new I.GetPolicyVersionCommand({PolicyArn:H.boundaryArn,VersionId:b.Policy.DefaultVersionId}));
    must(d.PolicyVersion?.IsDefaultVersion===true&&d.PolicyVersion.VersionId===b.Policy.DefaultVersionId,'BOUNDARY_VERSION');
    const role=r.Role,policy=b.Policy,stack=st.Stacks[0];
    return {stackId:stack.StackId,status:stack.StackStatus,stackRoleArn:stack.RoleARN??null,parameters:stack.Parameters??[],
      template:decode(t.TemplateBody),roleId:role.RoleId,roleArn:role.Arn,path:role.Path,maxSessionDuration:role.MaxSessionDuration,
      roleBoundaryArn:role.PermissionsBoundary?.PermissionsBoundaryArn??null,roleTags:[...(role.Tags??[])].sort((a,b)=>a.Key.localeCompare(b.Key)),trust:decode(role.AssumeRolePolicyDocument),
      policyId:policy.PolicyId,boundaryArn:policy.Arn,attachmentCount:policy.AttachmentCount,boundaryUsageCount:policy.PermissionsBoundaryUsageCount,
      defaultVersion:policy.DefaultVersionId,policyVersions:(versions.Versions??[]).map(x=>x.VersionId).sort(),
      inline:decode(inline.PolicyDocument),boundary:decode(d.PolicyVersion.Document),inlineNames:names.PolicyNames??[],managed:managed.AttachedPolicies??[],
      listsComplete:names.IsTruncated===false&&managed.IsTruncated===false&&versions.IsTruncated===false&&!resources.NextToken,
      resources:(resources.StackResourceSummaries??[]).map(x=>({logicalId:x.LogicalResourceId,type:x.ResourceType,physicalId:x.PhysicalResourceId,status:x.ResourceStatus})).sort((a,b)=>a.logicalId.localeCompare(b.logicalId))};
  }
  function kms(){counts.metadata++;let r;
    try{r=JSON.parse(execFileSync('aws.exe',['kms','describe-key','--key-id','alias/aws/secretsmanager','--profile',H.profile,'--region',H.region,
      '--endpoint-url','https://kms.ca-central-1.amazonaws.com','--output','json','--no-cli-pager'],{encoding:'utf8',timeout:20000,windowsHide:true,
      stdio:['ignore','pipe','pipe'],env:{...process.env,AWS_MAX_ATTEMPTS:'1',AWS_RETRY_MODE:'standard',AWS_PAGER:''}}));}catch{must(false,'KMS_METADATA');}
    return {arn:r.KeyMetadata?.Arn,manager:r.KeyMetadata?.KeyManager,enabled:r.KeyMetadata?.Enabled===true&&r.KeyMetadata?.KeyState==='Enabled'};
  }
  async function snapshot(){const c=clients();try{
    const who=await source(c),[a,web,controller,app,pending]=await Promise.all([access(c),secret(c,P.secretArn),secret(c,H.controllerArn),
      secret(c,H.appName,true),get(c.cfn,new C.ListChangeSetsCommand({StackName:H.stackId}))]);
    return {source:who,access:a,web,controller,app,kms:kms(),pendingComplete:!pending.NextToken,
      pendingChangeSets:(pending.Summaries??[]).map(x=>({id:x.ChangeSetId,status:x.Status,execution:x.ExecutionStatus})).sort((a,b)=>a.id.localeCompare(b.id))};
  }finally{dispose(c);}}
  async function roleGuard(){await source(writer);const r=(await get(writer.iam,new I.GetRoleCommand({RoleName:H.role}))).Role;
    must(r?.RoleId===H.roleId&&r.Arn===H.roleArn&&r.PermissionsBoundary?.PermissionsBoundaryArn===H.boundaryArn&&policySame(r.AssumeRolePolicyDocument,trust()),'ROLE_ID_OR_TRUST');}
  async function reviewChangeSet(id,arn,m){
    must(new RegExp('^arn:aws:cloudformation:'+H.region+':'+H.account+':changeSet/'+changeSetName(m.nonce)+'/[a-f0-9-]{36}$').test(id),'CHANGE_SET_ARN');
    for(let n=0;n<37;n++){
      const c=await get(writer.cfn,new C.DescribeChangeSetCommand({StackName:H.stackId,ChangeSetName:id,IncludePropertyValues:true}));
      if(c.Status==='CREATE_COMPLETE'){
        const t=await get(writer.cfn,new C.GetTemplateCommand({StackName:H.stackId,ChangeSetName:id,TemplateStage:'Original'}));
        verifyChangeSet(c,decode(t.TemplateBody),m,arn);return {changeSet:c,template:decode(t.TemplateBody)};
      }
      must(['CREATE_PENDING','CREATE_IN_PROGRESS'].includes(c.Status),'CHANGE_SET_TERMINAL');await new Promise(r=>setTimeout(r,10000));
    }must(false,'CHANGE_SET_TIMEOUT');
  }
  return {counts,snapshot,source:()=>source(writer),roleGuard,
    startWrites(deadline){must(writeDeadline===0&&Number.isSafeInteger(deadline)&&deadline>Date.now()&&deadline-Date.now()<=H.runMs,'WRITE_WINDOW');writeDeadline=deadline;},
    async verifyApp(arn,m,{empty,handoff}){appArn(arn);const s=await secret(writer,arn);verifySecret(s,{arn,version:m.versionId,policy:readPolicy(handoff),empty,kmsDefault:true});
      must(s.name===H.appName&&same(s.tags,[{Key:'Environment',Value:'aws-sandbox'},{Key:'Purpose',Value:'platform-controller-github-app-v6'},{Key:'ReviewNonce',Value:m.nonce}]),'APP_TAGS');},
    async createEmpty(m){const r=await once('create',writer.sm,new CreateSecretCommand({Name:H.appName,
      Description:'Reviewed V6 hosted controller GitHub App signing key; no deployment enabled',
      Tags:[{Key:'Environment',Value:'aws-sandbox'},{Key:'Purpose',Value:'platform-controller-github-app-v6'},{Key:'ReviewNonce',Value:m.nonce}]}));
      must(r.Name===H.appName,'CREATE_NAME');createdArn=appArn(r.ARN);return createdArn;},
    async putPolicy(arn,p){must(arn===H.controllerArn||arn===createdArn,'POLICY_TARGET');must(same(p,readPolicy())||same(p,readPolicy(true)),'POLICY_DOCUMENT');
      const label=arn===H.controllerArn?'controller-handoff':same(p,readPolicy())?'protect':'app-handoff';
      const r=await once(label,writer.sm,new PutResourcePolicyCommand({SecretId:arn,ResourcePolicy:canonical(p),BlockPublicPolicy:true}));must(r.ARN===arn,'POLICY_ACK');},
    async putKey(arn,m){must(arn===createdArn&&counts.keyReads===0,'KEY_ONCE');counts.keyReads++;
      let pem=await readKeyOnce(m.keyMetadata),value;
      try{must(typeof pem==='string'&&pem.length>0&&pem.length<=16000,'KEY_LENGTH');const k=createPrivateKey(pem);
        must(k.asymmetricKeyType==='rsa'&&k.asymmetricKeyDetails?.modulusLength>=2048,'KEY_FORMAT');
        value=JSON.stringify({schema:'techlong/platform-controller-github-app-material/v6',privateKey:pem});
        const r=await once('value',writer.sm,new PutSecretValueCommand({SecretId:arn,ClientRequestToken:m.versionId,SecretString:value,VersionStages:['AWSCURRENT']}));
        must(r.ARN===arn&&r.VersionId===m.versionId&&same(r.VersionStages,['AWSCURRENT']),'VALUE_ACK');
      }finally{pem=undefined;value=undefined;}},
    async createChangeSet(arn,m){must(arn===createdArn,'CHANGE_SET_TARGET');const r=await once('create-cs',writer.cfn,new C.CreateChangeSetCommand({
      StackName:H.stackId,ChangeSetName:changeSetName(m.nonce),ChangeSetType:'UPDATE',TemplateBody:canonical(suppliedTemplate(arn,m.versionId)),
      Capabilities:['CAPABILITY_NAMED_IAM'],ClientToken:'hosted-supply-'+m.nonce,Parameters:[],IncludeNestedStacks:false}));
      must(r.StackId===H.stackId&&typeof r.Id==='string','CHANGE_SET_ACK');return r.Id;},
    reviewChangeSet,
    async assertBaseAccess(){verifyAccess(await access(writer));},
    async executeChangeSet(cs,m){await reviewChangeSet(cs,createdArn,m);await roleGuard();
      const list=await get(writer.cfn,new C.ListChangeSetsCommand({StackName:H.stackId}));
      must(!list.NextToken&&list.Summaries?.length===1&&list.Summaries[0].ChangeSetId===cs&&
        list.Summaries[0].Status==='CREATE_COMPLETE'&&list.Summaries[0].ExecutionStatus==='AVAILABLE','OTHER_CHANGE_SET_PRESENT');
      await once('execute',writer.cfn,new C.ExecuteChangeSetCommand({
      StackName:H.stackId,ChangeSetName:cs,ClientRequestToken:'hosted-supply-execute-'+m.nonce,DisableRollback:true}));},
    async waitAccess(arn,m){for(let n=0;n<61;n++){
      const s=await get(writer.cfn,new C.DescribeStacksCommand({StackName:H.stackId}));must(s.Stacks?.length===1&&s.Stacks[0].StackId===H.stackId,'WAIT_STACK');
      if(s.Stacks[0].StackStatus==='UPDATE_COMPLETE'){
        for(let k=0;k<6;k++){try{verifyAccess(await access(writer),{arn,version:m.versionId,installed:true});return;}
          catch(e){if(e.message!=='HOSTED_SUPPLY_ACCESS_DRIFT'||k===5)throw e;await new Promise(r=>setTimeout(r,5000));}}
      }
      must(['UPDATE_IN_PROGRESS','UPDATE_COMPLETE_CLEANUP_IN_PROGRESS'].includes(s.Stacks[0].StackStatus),'ACCESS_TERMINAL');await new Promise(r=>setTimeout(r,10000));
    }must(false,'ACCESS_TIMEOUT');},
    async verifyControllerSourceOnly(){verifySecret(await secret(writer,H.controllerArn),{arn:H.controllerArn,version:H.controllerVersion,policy:readPolicy(),kmsDefault:true});},
    async validatePolicies(){for(const p of[readPolicy(),readPolicy(true)]){const r=await get(writer.sm,new ValidateResourcePolicyCommand({ResourcePolicy:canonical(p)}));
      must(r.PolicyValidationPassed===true&&!r.ValidationErrors?.length,'RESOURCE_POLICY_VALIDATION');}},
    close(){dispose(writer);}
  };
}
