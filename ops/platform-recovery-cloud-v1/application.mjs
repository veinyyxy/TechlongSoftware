// Concrete recovery composition. Explicit temporary cloud credentials only.
// Construction performs no network, secret read or database connection.
import {SecretsManagerClient,GetSecretValueCommand} from '@aws-sdk/client-secrets-manager';
import {CloudFormationClient,DescribeStacksCommand,ListStackResourcesCommand} from '@aws-sdk/client-cloudformation';
import {STSClient,GetCallerIdentityCommand} from '@aws-sdk/client-sts';
import {openDynamoCloudWorkerJournalV1} from '../../lib/deployments/execution/cloud-worker-journal-v1.ts';
import {createCloudSessionV5} from '../cloud-worker/cloud-session-v5.mjs';
import {createCloudInitializedAwsV5} from '../cloud-worker/aws-initialized-workload-v5.mjs';
import {createFixedControlSecretLoaderV5} from '../cloud-worker/cloud-control-v5.mjs';
import {createCloudEvidenceV5} from '../cloud-worker/cloud-evidence-v5.mjs';
import {loadNeonContractV5} from '../cloud-worker/neon-contract-v5.mjs';
import {createNeonRpcTransportV5,createNarrowNeonV5} from '../cloud-worker/neon-persistence-v5.mjs';
import {assertInstallationV5} from '../cloud-worker/cloud-worker-root-v5.mjs';
import {validateDatabaseMaterialV5} from '../cloud-worker/cloud-application-v5.mjs';
import {CLOUD_V6} from '../platform-cloud-v6/contract.mjs';
import {createRecoveryWorker} from '../platform-recovery-v1/worker.mjs';
import {recoveryData,must,same} from '../platform-recovery-v1/basis-core.mjs';

// CFN SDK Dates and archived CLI ISO text have different formatting, not facts.
const instant=v=>{const n=v instanceof Date?v.getTime():Date.parse(v);must(Number.isSafeInteger(n),'RETIREMENT_TIMESTAMP');return n;};
const resource=r=>({...r,...(r.LastUpdatedTimestamp?{LastUpdatedTimestamp:instant(r.LastUpdatedTimestamp)}:{})});
export async function readRecoveryRetirement({basis,send,signal,now=Date.now}){
  const startedAt=now(),d=recoveryData(basis,startedAt),input={StackName:d.target.stackId};
  const s=await send(new DescribeStacksCommand(input),signal),r=await send(new ListStackResourcesCommand(input),signal);
  const stack=s.Stacks?.[0];must(s.Stacks?.length===1&&stack.StackId===d.target.stackId&&stack.StackStatus==='DELETE_COMPLETE'&&
    !r.NextToken&&r.StackResourceSummaries?.length===7&&instant(stack.DeletionTime)===instant(d.retirement.deletionTime)&&
    same(r.StackResourceSummaries.map(resource).sort((a,b)=>a.LogicalResourceId.localeCompare(b.LogicalResourceId)),
      d.retirement.resources.map(resource).sort((a,b)=>a.LogicalResourceId.localeCompare(b.LogicalResourceId))),'LIVE_RETIREMENT_DRIFT');
  // Original bytes remain the hash anchor; all corresponding live facts above
  // were independently checked. Namespace/authority still checked by V5.
  const observedAt=now();must(observedAt>=startedAt&&observedAt-startedAt<30000,'RETIREMENT_READ_WINDOW');
  return {retirement:d.retirement,observedAt};
}
export async function createRecoveryApplication({basis,installation:raw,run,code,credentials,mode,approvedRecoveryReviewSha256}){
  const d=recoveryData(basis,Date.now());must(code.commitSha===run.commitSha,'APPLICATION_CODE_BINDING');
  const contract=await loadNeonContractV5(),installation=await assertInstallationV5(raw,CLOUD_V6.installationSha256,contract);
  const session=createCloudSessionV5({credentials,expected:{...run,roleId:installation.roleId}}),cfg=session.clientConfig();
  const sm=new SecretsManagerClient({...cfg,endpoint:'https://secretsmanager.ca-central-1.amazonaws.com'}),
    cfn=new CloudFormationClient({...cfg,endpoint:'https://cloudformation.ca-central-1.amazonaws.com'}),
    provider=createCloudInitializedAwsV5(d.context.base,session),evidence=createCloudEvidenceV5(session);
  let databaseOpened=false,retirementCalls=0;
  const secretRead=(reference,signal)=>sm.send(new GetSecretValueCommand({SecretId:reference.arn,VersionId:reference.versionId,VersionStage:'AWSCURRENT'}),
    {abortSignal:AbortSignal.any([signal,AbortSignal.timeout(30000)])});
  const worker=createRecoveryWorker({basis,authorize:async a=>must(a.mode===mode&&a.jobId===d.target.newJobId&&
      a.basisSha256===basis.basisSha256&&a.reviewSha256===approvedRecoveryReviewSha256,'APPLICATION_EXACT_APPROVAL'),
    observeRetirement:()=>readRecoveryRetirement({basis,signal:AbortSignal.timeout(30000),send:async(command,signal)=>{
      must(++retirementCalls<=2,'RETIREMENT_READ_BUDGET');return cfn.send(command,{abortSignal:signal});}}),
    dependencies:{installation,contract,code,run,provider,evidence,
      async openDatabase(signal){
        must(!databaseOpened,'DATABASE_SECRET_ONCE');databaseOpened=true;
        const sts=new STSClient({...cfg,endpoint:'https://sts.ca-central-1.amazonaws.com'});
        try{session.assertIdentity(await sts.send(new GetCallerIdentityCommand({}),{abortSignal:signal}));}finally{sts.destroy();}
        const reference=installation.databaseSecret,r=await secretRead(reference,signal);
        must(r.ARN===reference.arn&&r.VersionId===reference.versionId&&r.Name==='techlong/sandbox/deployment-worker/neon-control-v1'&&
          r.VersionStages?.length===1&&r.VersionStages[0]==='AWSCURRENT'&&!r.SecretBinary&&typeof r.SecretString==='string'&&
          Buffer.byteLength(r.SecretString)<=12000,'DATABASE_SECRET_FIXED_VERSION');
        const url=await validateDatabaseMaterialV5(JSON.parse(r.SecretString),installation.neon.endpointSha256);
        return createNarrowNeonV5({transport:createNeonRpcTransportV5(url),contract,expected:installation.neon});
      },
      async loadControl({beforeRead,signal}){return createFixedControlSecretLoaderV5({reference:installation.controlSecret,
        expected:d.context.controlFingerprints,getSecretValue:input=>secretRead({arn:input.SecretId,versionId:input.VersionId},signal),beforeRead}).loadOnce(signal);},
      openJournal:(binding,signal)=>openDynamoCloudWorkerJournalV1({binding,tableId:installation.tableId,signal,credentials:cfg.credentials})}});
  return Object.freeze({...worker,dispose(){provider.dispose();evidence.dispose();sm.destroy();cfn.destroy();}});
}
