// Read-only metadata for the exact independently installed W5p correction.
import {readFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {neon} from '@neondatabase/serverless';
import {fromLoginCredentials} from '@aws-sdk/credential-provider-login';
import {S3Client,GetObjectCommand,GetBucketPolicyCommand} from '@aws-sdk/client-s3';
import {SecretsManagerClient,DescribeSecretCommand,GetResourcePolicyCommand,ListSecretVersionIdsCommand} from '@aws-sdk/client-secrets-manager';
import {canonicalJson,sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {readAwsInstallInventoryV5,INSTALL_CANDIDATE_V5 as C} from './install/inventory-v5.mjs';
import {RECOVERY_ANCHOR_V5 as R} from './install/recovery-v5.mjs';
import {ACTIVATION_V5 as A,verifyEnvironmentV5} from './activation/release-v5.mjs';
import {evidenceBucketPolicyV5} from './install/plan-v5.mjs';
import {assessContinuationSecretV5} from './install/continuation-secrets-v5.mjs';
import {createEvidencePortV5} from './cloud-evidence-v5.mjs';
import {NEON_CATALOG_SQL_V5,verifyNeonCatalogV5} from './neon-persistence-v5.mjs';
import {loadNeonContractV5} from './neon-contract-v5.mjs';
import {createTaskDefinitionPermissionIoV5} from './task-definition-permission-local-v5.mjs';
import {taskDefinitionPermissionChangeV5} from './task-definition-permission-v5.mjs';
import {assertCorrectedJobLayoutV5,CORRECTED_JOB_DISPATCH_V5 as V} from './corrected-job-dispatch-v5.mjs';
import {requireActivationV5 as must} from './activation/errors-v5.mjs';
const same=(a,b)=>canonicalJson(a)===canonicalJson(b),repo='repos/veinyyxy/TechlongSoftware';
export function assertCorrectedAncillaryV5(a,template,bucketPolicy){
  const table=a.journal?.value?.Table;
  must(a.source?.Arn==='arn:aws:iam::402010193138:user/techlong-sandbox-dev'&&a.preservedIam?.iamLayoutUnchanged===true&&
    table?.TableId===R.tableId&&table.DeletionProtectionEnabled===true&&table.TableStatus==='ACTIVE'&&
    table.BillingModeSummary?.BillingMode==='PAY_PER_REQUEST'&&same(table.KeySchema,template.Resources.Journal.Properties.KeySchema)&&
    !table.GlobalSecondaryIndexes?.length&&!table.LocalSecondaryIndexes?.length&&a.journal.ttl?.value?.TimeToLiveDescription?.TimeToLiveStatus==='DISABLED'&&
    same(JSON.parse(bucketPolicy.Policy),evidenceBucketPolicyV5()),'CORRECTED_JOB_ANCILLARY_LAYOUT');
}
export async function createCorrectedJobMetadataV5(output,context,gh){
  const capsule=JSON.parse(await readFile(new URL('./material/public-capsule-v5.json',import.meta.url),'utf8')),
    binding=JSON.parse(await readFile(new URL('../aws-sandbox/reviews/cloud-worker-v5.installed-binding.json',import.meta.url),'utf8')),
    layoutIo=await createTaskDefinitionPermissionIoV5(output,{...context,capsule}),
    cfg={region:'ca-central-1',maxAttempts:1,ignoreConfiguredEndpointUrls:true,credentials:fromLoginCredentials({profile:'techlong-sandbox-user',ignoreCache:true})},
    s3=new S3Client(cfg),sm=new SecretsManagerClient(cfg),template=taskDefinitionPermissionChangeV5(capsule).template,
    allowed=new Set(['GetObjectCommand','GetBucketPolicyCommand','HeadBucketCommand','GetPublicAccessBlockCommand','GetBucketEncryptionCommand',
      'GetBucketOwnershipControlsCommand','GetBucketVersioningCommand','DescribeSecretCommand','GetResourcePolicyCommand','ListSecretVersionIdsCommand']);
  const send=(client,q,signal)=>{must(allowed.has(q.constructor.name),'CORRECTED_JOB_METADATA_READ_ONLY');
    return client.send(q,{abortSignal:signal??AbortSignal.timeout(30000)});};
  return {
    async read(){
      const [layout,a,bucketPolicy,oidc,env,branches]=await Promise.all([layoutIo.readLayout('new'),readAwsInstallInventoryV5(),
        send(s3,new GetBucketPolicyCommand({Bucket:C.bucket,ExpectedBucketOwner:'402010193138'})),
        gh(repo+'/actions/oidc/customization/sub'),gh(repo+'/environments/'+A.environment),
        gh(repo+'/environments/'+A.environment+'/deployment-branch-policies?per_page=100')]);
      assertCorrectedJobLayoutV5(layout,context.history.correctedLayoutAnchor,context.source.commit);
      assertCorrectedAncillaryV5(a,template,bucketPolicy);
      must(same(oidc,context.old.prestate.github.oidcSubject),'CORRECTED_JOB_OIDC_SUBJECT');
      const environment=verifyEnvironmentV5(env,branches);must(environment.environmentId===V.environmentId,'CORRECTED_JOB_ENVIRONMENT');
      await createEvidencePortV5((q,signal)=>send(s3,q,signal)).verify(AbortSignal.timeout(60000));
      const ref={...V.publication,installationSha256:V.installationSha256};
      must(ref.key===A.bindingKey&&ref.installationSha256===binding.installationSha256,'CORRECTED_JOB_PUBLIC_BINDING');
      const o=await send(s3,new GetObjectCommand({Bucket:C.bucket,ExpectedBucketOwner:'402010193138',Key:ref.key,VersionId:ref.versionId}));
      must(o.VersionId===ref.versionId&&o.ServerSideEncryption==='AES256'&&o.ContentLength>0&&o.ContentLength<10000,'CORRECTED_JOB_BINDING_METADATA');
      const published=JSON.parse(await o.Body.transformToString());
      must(same(published,binding)&&await sha256Hex(published)===ref.sha256,'CORRECTED_JOB_BINDING_BODY');
      for(const [index,r]of R.secrets.entries()){
        const [d,p,v]=await Promise.all([send(sm,new DescribeSecretCommand({SecretId:r.arn})),send(sm,new GetResourcePolicyCommand({SecretId:r.arn})),
          send(sm,new ListSecretVersionIdsCommand({SecretId:r.arn,IncludeDeprecated:true,MaxResults:100}))]);
        assessContinuationSecretV5(index,d,p,v,'fixed');
      }
      const ownerUrl=parseEnv(await readFile(new URL('../../.env.local',import.meta.url),'utf8')).DATABASE_URL,u=new URL(ownerUrl);
      must(['postgres:','postgresql:'].includes(u.protocol)&&decodeURIComponent(u.username)==='neondb_owner'&&u.password&&
        /^ep-[a-z0-9-]+\.[a-z0-9.-]+\.neon\.tech$/.test(u.hostname)&&(!u.port||u.port==='5432')&&/^\/[A-Za-z0-9_-]{1,63}$/.test(u.pathname)&&
        ['require','verify-full'].includes(u.searchParams.get('sslmode'))&&await sha256Hex({host:u.hostname,port:5432,database:u.pathname.slice(1),
          role:'techlong_cloud_worker_v5',transport:'NeonHTTPS'})===binding.neon.endpointSha256,'CORRECTED_JOB_NEON_ENDPOINT');
      const query=NEON_CATALOG_SQL_V5.replace('current_user AS current_user, session_user AS session_user','r.rolname::text AS current_user, r.rolname::text AS session_user')
        .replace('r.rolname=current_user',"r.rolname='techlong_cloud_worker_v5'"),sql=neon(ownerUrl,{fullResults:true});
      const [v]=await sql.transaction(tx=>[tx.query(query,[])],{isolationLevel:'RepeatableRead',readOnly:true,fetchOptions:{signal:AbortSignal.timeout(30000)}});
      must(v.rowCount===1,'CORRECTED_JOB_NEON_ROW');await verifyNeonCatalogV5(v.rows[0],await loadNeonContractV5(),binding.neon);
      return {environment,publication:{key:ref.key,versionId:ref.versionId,sha256:ref.sha256},main:context.source.commit,
        foundation:{roleId:R.roleId,tableId:R.tableId,stackId:R.stackId,trustReusesCommit:V.reusable,oldIamUnchanged:true,boundaryVersion:'v1',
          secretsFixedVersionsVerified:true,neonMetadataVerified:true,secretValueReads:0},correctedLayout:layout,workflowDispatched:false,secretValueReads:0};
    },dispose(){layoutIo.dispose();s3.destroy();sm.destroy();},
  };
}
