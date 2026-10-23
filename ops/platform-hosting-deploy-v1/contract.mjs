import {P,hash,canonical,same,handoffPolicy} from '../platform-ecs-v1/contract.mjs';
import {hostingTemplate} from '../platform-ecs-v1/templates.mjs';
export {P,hash,canonical,same,handoffPolicy};
export const B=Object.freeze({accessNonce:'aca6c7934875a069a696bbe47d9b7b35',
  accessStackId:'arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-platform-access-v1/01b4bb80-ce60-11f1-9435-0e85c8c75895',
  roleId:'AROAV3GNMXTZJ45S2ANZ7',boundaryId:'ANPAV3GNMXTZP7KMHXNYF',
  parentManifestSha256:'9cdfcdc03a33cbcc22ca749bbb84294054bdeb58439447656e337ae4ad592e09',
  parentResultSha256:'a1777458e1da3b3979110d3065b09d4ad9ac5c6eed523fcceda20e4514b9ce61',
  parentObservationSha256:'2f943c2ddff1f71b0a229b9102c3e8034b8722612787e2136ea1678f6c26e597',
  parentIntentSha256:'572ed1b9c0f47bf57e1063a2767e410f1bd464ba0baed504db6d6ecce3323b48'});
export const SCOPE=Object.freeze({cloudFormationCreateStack:1,hostingLogicalResources:11,newIamResources:0,secretPolicyWrites:0,
  directSecretValueReads:0,directSqlConnections:0,directHttpRequests:0,oldResourceDeletes:0,applicationWriteRetries:0,
  ecsManagedTaskStartsAndSecretRetrievals:true,publicApplicationExposure:true,automaticCleanup:false});
export const must=(v,c)=>{if(!v)throw Error('PLATFORM_HOSTING_DEPLOY_'+c);};
export const safeCode=e=>/^PLATFORM_(?:HOSTING_DEPLOY|ECS)_[A-Z0-9_]+$/.test(e?.message??'')?e.message:
  /^[A-Za-z0-9_]{1,80}$/.test(e?.name??'')?e.name:'HOSTING_OPERATION_FAILED';
export function template(nonce){must(/^[a-f0-9]{32}$/.test(nonce),'NONCE');const t=hostingTemplate();
  t.Description='Platform Web HTTPS hosting, two-hour intent; no automatic cleanup or application controller';
  t.Metadata={ReviewPhase:'W7o',ReviewNonce:nonce,ExecutionRoleId:B.roleId,BoundaryId:B.boundaryId};return t;}
export const stackTags=(nonce,expiry)=>[{Key:'Environment',Value:'aws-sandbox'},{Key:'Purpose',Value:'platform-web-two-hour'},
  {Key:'ReviewNonce',Value:nonce},{Key:'HostingExpiresAt',Value:expiry}];
export function assertAccess(a){must(a?.stackId===B.accessStackId&&a.stackStatus==='CREATE_COMPLETE'&&a.roleId===B.roleId&&a.roleArn===P.roleArn&&
  a.boundaryId===B.boundaryId&&a.boundaryArn===P.boundaryArn&&a.defaultVersion==='v1','ACCESS_IDENTITY');}
export function assertInventory(x,review){assertAccess(x.access);must(x.hostingNamesAbsent===true&&x.secret?.arn===P.secretArn&&x.secret.versionId===P.secretVersion&&
  x.image?.digest===P.imageDigest&&x.budget?.limitUsd===50&&x.source?.Arn===P.sourceArn&&x.source.UserId===P.sourceId&&x.source.Account===P.account,'INVENTORY');
  if(review)must(same(x.network,review.network)&&same(x.serviceLinkedRoles,review.serviceLinkedRoles),'BASELINE_DRIFT');}
