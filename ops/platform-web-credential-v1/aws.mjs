import {execFileSync} from 'node:child_process';
import {fromLoginCredentials} from '@aws-sdk/credential-provider-login';
import {STSClient,GetCallerIdentityCommand} from '@aws-sdk/client-sts';
import {SecretsManagerClient,DescribeSecretCommand,ValidateResourcePolicyCommand,ListSecretVersionIdsCommand,GetResourcePolicyCommand,
  CreateSecretCommand,PutResourcePolicyCommand,PutSecretValueCommand,GetSecretValueCommand} from '@aws-sdk/client-secrets-manager';
import {C,SCOPE,sourceOnlyPolicy,secretArn,canonical,same,must} from './contract.mjs';
export function awsEnvironment(env=process.env){
  must(!['AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN','AWS_CONFIG_FILE','AWS_SHARED_CREDENTIALS_FILE','AWS_CA_BUNDLE',
    'AWS_PROFILE','AWS_DEFAULT_PROFILE','AWS_MAX_ATTEMPTS','AWS_RETRY_MODE'].some(k=>env[k])&&
    !Object.keys(env).some(k=>/^AWS_ENDPOINT_URL/.test(k)),'CREDENTIAL_AWS_ENVIRONMENT');
}
export function awsIo(){
  awsEnvironment();const credentials=fromLoginCredentials({profile:C.profile,ignoreCache:true}),cfg={region:C.region,credentials,maxAttempts:1,ignoreConfiguredEndpointUrls:true};
  const sts=new STSClient({...cfg,endpoint:'https://sts.ca-central-1.amazonaws.com'}),sm=new SecretsManagerClient({...cfg,endpoint:'https://secretsmanager.ca-central-1.amazonaws.com'});
  const calls={reads:0,writes:0,secretValueReads:0};
  const send=(client,command,write=false)=>{calls[write?'writes':'reads']++;must(calls.reads<=SCOPE.awsServiceReadsMax&&calls.writes<=SCOPE.awsWritesMax,'CREDENTIAL_AWS_CALL_LIMIT');
    return client.send(command,{abortSignal:AbortSignal.timeout(30000)});};
  async function source(){const r=await send(sts,new GetCallerIdentityCommand({}));must(r.Account===C.account&&r.Arn===C.sourceArn&&r.UserId===C.sourceId,'CREDENTIAL_SOURCE');
    return {Account:r.Account,Arn:r.Arn,UserId:r.UserId};}
  async function inventory(){const identity=await source();let absent=false;
    try{await send(sm,new DescribeSecretCommand({SecretId:C.secretName}));}catch(e){if(e.name!=='ResourceNotFoundException')throw e;absent=true;}
    must(absent,'CREDENTIAL_SECRET_OCCUPIED');
    const validation=await send(sm,new ValidateResourcePolicyCommand({ResourcePolicy:canonical(sourceOnlyPolicy())}));
    must(validation.PolicyValidationPassed===true&&!validation.ValidationErrors?.length,'CREDENTIAL_POLICY_VALIDATION');
    calls.reads++;
    const raw=execFileSync('aws.exe',['kms','describe-key','--key-id','alias/aws/secretsmanager','--profile',C.profile,'--region',C.region,
      '--endpoint-url','https://kms.ca-central-1.amazonaws.com','--output','json','--no-cli-pager'],{encoding:'utf8',windowsHide:true,timeout:30000,
      stdio:['ignore','pipe','ignore'],env:{...process.env,AWS_MAX_ATTEMPTS:'1',AWS_RETRY_MODE:'standard',AWS_PAGER:''}});
    const k=JSON.parse(raw).KeyMetadata;
    must(k?.KeyManager==='AWS'&&k.Enabled===true&&k.KeyState==='Enabled'&&new RegExp('^arn:aws:kms:'+C.region+':'+C.account+':key/[a-f0-9-]+$').test(k.Arn),'CREDENTIAL_KMS');
    return {source:identity,secretAbsent:true,policyValidated:true,kms:{arn:k.Arn,id:k.KeyId,keyManager:k.KeyManager},checkedAtUtc:new Date().toISOString()};
  }
  async function metadata(arn,reviewSha,versionId,kmsArn){secretArn(arn);
    const d=await send(sm,new DescribeSecretCommand({SecretId:arn})),p=await send(sm,new GetResourcePolicyCommand({SecretId:arn})),
      v=await send(sm,new ListSecretVersionIdsCommand({SecretId:arn,IncludeDeprecated:true,MaxResults:100}));
    const tags=[{Key:'Environment',Value:'aws-sandbox'},{Key:'Purpose',Value:'platform-web-neon-v1'},{Key:'ReviewSha256',Value:reviewSha}];
    must(d.ARN===arn&&d.Name===C.secretName&&!d.DeletedDate&&!d.RotationEnabled&&!d.ReplicationStatus?.length&&d.KmsKeyId===kmsArn&&
      same([...(d.Tags??[])].sort((a,b)=>a.Key.localeCompare(b.Key)),tags.sort((a,b)=>a.Key.localeCompare(b.Key)))&&
      p.ARN===arn&&p.Name===C.secretName&&same(JSON.parse(p.ResourcePolicy??'null'),sourceOnlyPolicy())&&
      v.ARN===arn&&v.Name===C.secretName&&!v.NextToken,'CREDENTIAL_SECRET_METADATA');
    const versions=v.Versions??[];
    must(versionId?(versions.length===1&&versions[0].VersionId===versionId&&same(versions[0].VersionStages,['AWSCURRENT'])&&
      same(d.VersionIdsToStages,{[versionId]:['AWSCURRENT']})):(versions.length===0&&Object.keys(d.VersionIdsToStages??{}).length===0),'CREDENTIAL_SECRET_VERSIONS');
    return {arn,name:d.Name,kmsArn,tags:d.Tags,policy:sourceOnlyPolicy(),versions:versions.map(x=>({id:x.VersionId,stages:x.VersionStages}))};
  }
  return {calls,source,inventory,metadata,
    async createEmpty(reviewSha,kmsArn){const r=await send(sm,new CreateSecretCommand({Name:C.secretName,KmsKeyId:kmsArn,
      Description:'Dedicated least-privilege platform Web Neon login; task handoff separately reviewed',
      Tags:[{Key:'Environment',Value:'aws-sandbox'},{Key:'Purpose',Value:'platform-web-neon-v1'},{Key:'ReviewSha256',Value:reviewSha}]}),true);
      must(r.Name===C.secretName&&!r.VersionId,'CREDENTIAL_EMPTY_CREATE_ACK');return secretArn(r.ARN);},
    async protect(arn){const r=await send(sm,new PutResourcePolicyCommand({SecretId:secretArn(arn),ResourcePolicy:canonical(sourceOnlyPolicy()),BlockPublicPolicy:true}),true);
      must(r.ARN===arn&&r.Name===C.secretName,'CREDENTIAL_POLICY_ACK');},
    async put(arn,versionId,value){const r=await send(sm,new PutSecretValueCommand({SecretId:secretArn(arn),ClientRequestToken:versionId,SecretString:JSON.stringify(value)}),true);
      must(r.ARN===arn&&r.Name===C.secretName&&r.VersionId===versionId&&same(r.VersionStages,['AWSCURRENT']),'CREDENTIAL_PUT_ACK');},
    async get(arn,versionId){must(calls.secretValueReads===0,'CREDENTIAL_VALUE_READ_ONCE');calls.secretValueReads++;
      const r=await send(sm,new GetSecretValueCommand({SecretId:secretArn(arn),VersionId:versionId,VersionStage:'AWSCURRENT'}));
      must(r.ARN===arn&&r.Name===C.secretName&&r.VersionId===versionId&&same(r.VersionStages,['AWSCURRENT'])&&
        typeof r.SecretString==='string'&&!r.SecretBinary&&r.SecretString.length<12000,'CREDENTIAL_VALUE_VERSION');return JSON.parse(r.SecretString);},
    dispose(){sm.destroy();sts.destroy();}
  };
}
