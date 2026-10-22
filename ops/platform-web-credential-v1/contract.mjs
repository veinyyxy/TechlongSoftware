// One existing Web identity; no IAM grant or hosting deployment in this stage.
import {ROLE,PROFILE,canonical,same,hash,must,normalized} from '../platform-web-database-role-v1/contract.mjs';
import {assertEffective} from '../platform-web-database-role-v1/effective.mjs';
export {ROLE,PROFILE,canonical,same,hash,must};
export const C=Object.freeze({account:'402010193138',region:'ca-central-1',profile:'techlong-sandbox-user',
  sourceArn:'arn:aws:iam::402010193138:user/techlong-sandbox-dev',sourceId:'AIDAV3GNMXTZEO7SHLC2X',roleOid:'196608',
  secretName:PROFILE.secretName,materialSchema:'techlong/platform-web-neon/v1',validMs:48*3600000});
export const SCOPE=Object.freeze({createEmptySecrets:1,putResourcePolicies:1,putSecretValues:1,awsWritesMax:3,awsServiceReadsMax:20,
  rolePasswordLoginStatementsMax:1,passwordRandomBytes:48,secretValueReadsMax:1,ownerConnectionsMax:2,
  dedicatedRoleConnectionsMax:1,totalDatabaseConnectionsMax:3,businessRowReads:0,businessDataWrites:0,
  iamChanges:0,deployments:0,deletions:0,applicationRetries:0});
export function sourceOnlyPolicy(){return {Version:'2012-10-17',Statement:[
  {Sid:'OnlySourceMayReadBeforeTaskHandoff',Effect:'Deny',Principal:'*',Action:'secretsmanager:GetSecretValue',Resource:'*',
    Condition:{ArnNotEquals:{'aws:PrincipalArn':C.sourceArn}}},
  {Sid:'OnlySourceMayManageCredential',Effect:'Deny',Principal:'*',Action:['secretsmanager:PutSecretValue','secretsmanager:UpdateSecret',
    'secretsmanager:DeleteSecret','secretsmanager:RestoreSecret','secretsmanager:PutResourcePolicy','secretsmanager:DeleteResourcePolicy',
    'secretsmanager:RotateSecret','secretsmanager:CancelRotateSecret','secretsmanager:UpdateSecretVersionStage','secretsmanager:TagResource',
    'secretsmanager:UntagResource','secretsmanager:ReplicateSecretToRegions','secretsmanager:RemoveRegionsFromReplication',
    'secretsmanager:StopReplicationToReplica'],Resource:'*',Condition:{ArnNotEquals:{'aws:PrincipalArn':C.sourceArn}}}
]};}
export function secretArn(arn){must(typeof arn==='string'&&new RegExp('^arn:aws:secretsmanager:'+C.region+':'+C.account+':secret:'+C.secretName+'-[A-Za-z0-9]{6}$').test(arn),'CREDENTIAL_SECRET_ARN');return arn;}
export const isUuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
export function passwordSql(password){must(typeof password==='string'&&/^[A-Za-z0-9_-]{64}$/.test(password),'CREDENTIAL_PASSWORD_FORMAT');
  return `ALTER ROLE "${ROLE}" WITH LOGIN PASSWORD '${password}'`;}
export function material(target,password){passwordSql(password);const u=new URL('postgresql://'+target.host+':5432/'+target.database);
  u.username=ROLE;u.password=password;u.searchParams.set('sslmode','verify-full');u.searchParams.set('channel_binding','require');
  return {schema:C.materialSchema,databaseUrl:u.toString()};}
export function parseMaterial(value,target){
  must(value&&same(Object.keys(value).sort(),['databaseUrl','schema'])&&value.schema===C.materialSchema&&typeof value.databaseUrl==='string','CREDENTIAL_MATERIAL');
  let u;try{u=new URL(value.databaseUrl);}catch{must(false,'CREDENTIAL_MATERIAL_URL');}
  const password=decodeURIComponent(u.password);passwordSql(password);
  must(u.protocol==='postgresql:'&&u.hostname===target.host&&u.port==='5432'&&u.pathname==='/'+target.database&&
    decodeURIComponent(u.username)===ROLE&&!u.hash&&u.searchParams.size===2&&u.searchParams.get('sslmode')==='verify-full'&&
    u.searchParams.get('channel_binding')==='require','CREDENTIAL_MATERIAL_TARGET');return password;
}
export function assertWebSnapshot(catalog,effective,baseline,login){
  const c=structuredClone(catalog),r=c.identity.candidate_role,expectedOid=baseline.identity.candidate_role.oid;
  must(r?.oid===expectedOid&&r.name===ROLE&&r.login===login,'CREDENTIAL_ROLE_ID_LOGIN');r.login=false;
  must(same(normalized(c),normalized(baseline)),'CREDENTIAL_DATABASE_DRIFT');
  assertEffective(effective,catalog,expectedOid);return {roleOid:expectedOid,login,grantsUnchanged:true,effectivePrivilegesExact:true};
}
export function taskSecretReference(arn,versionId){secretArn(arn);must(isUuid(versionId),'CREDENTIAL_VERSION');
  return {name:'DATABASE_URL',valueFrom:arn+':databaseUrl::'+versionId};}
export const safeCode=e=>/^WEB_ROLE_[A-Z0-9_]+$/.test(e?.message??'')?e.message:
  /^[A-Za-z0-9_]{1,80}$/.test(e?.code??e?.name??'')?(e.code??e.name):'CREDENTIAL_OPERATION_FAILED';
