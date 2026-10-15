import {parseDatabaseBindingV2,databaseBindingDigestV2,type DatabaseBindingV2} from './aurora-database-v2.ts';

/** Data-only wiring for an initialized tenant. OIDs must come from an approved
 * independent SQL observation; this function cannot prove or mint that evidence.
 * No SDK, Secret, database or CloudFormation operation is constructed here.
 */
export function buildTenantReadinessConfigurationV1(input:{
  binding:DatabaseBindingV2; databaseOid:string; roleOid:string; appInstanceId:string; configurationHash:string;
}){
  const binding=parseDatabaseBindingV2(input.binding);
  if(Object.keys(input).sort().join(',')!=='appInstanceId,binding,configurationHash,databaseOid,roleOid'||
    typeof input.databaseOid!=='string'||!/^[1-9][0-9]{0,9}$/.test(input.databaseOid)||
    typeof input.roleOid!=='string'||!/^[1-9][0-9]{0,9}$/.test(input.roleOid)||
    typeof input.appInstanceId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(input.appInstanceId)||
    typeof input.configurationHash!=='string'||!/^[a-f0-9]{64}$/.test(input.configurationHash))throw Error('TENANT_READINESS_CONFIGURATION_REJECTED');
  const environment=Object.entries({APP_READINESS_MODE:'tenant-v1',PG_EXPECTED_DATABASE_OID:input.databaseOid,
    PG_EXPECTED_ROLE_OID:input.roleOid,SAAS_INSTANCE_ID:input.appInstanceId,APP_EXPECTED_CONFIGURATION_HASH:input.configurationHash})
    .map(([name,value])=>Object.freeze({name,value}));
  return Object.freeze({schema:'techlong/tenant-readiness-configuration/v1',profile:binding.profile,
    databaseBindingSha256:databaseBindingDigestV2(binding),environment:Object.freeze(environment),
    bootstrapPath:'/bootstrap-ready',initializedReadinessPath:'/ready',
    ecsAndTargetGroupHealthPath:'/bootstrap-ready',healthMeansBootstrapOnly:true,
    businessInitializationPath:'/api/saas/provision',existingProvisionAuthenticationAndEpochRequired:true,
    deploymentReadyRequiresInitializedReadinessAndAuthenticatedControlReconciliation:true,
    // Candidate paths are not registered TaskDefinition/ALB settings or evidence.
    executionAuthorized:false,cloudConfigurationInstalled:false,ecsTaskRoleVerified:false,readyVerified:false});
}
