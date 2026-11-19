// Pure template assembly. The activation caller must bind the private workspace
// and plan and prove the publisher and Secret receipts under the approved SHA.
import { readFileSync } from 'node:fs';
import { validSandboxPurchaseScope } from '../../lib/purchases/sandbox-first-purchase-config.ts';
import { P, canonical, hash, handoffPolicy } from './contract.mjs';
import { suppliedTemplate, versionId } from '../platform-hosted-access-v6/contract.mjs';
import { DAHLIA_FIRST_PURCHASE_CANDIDATE, CHECKOUT_REPAIR_CANDIDATE, BILLING_REPAIR_CANDIDATE } from '../platform-registration-publish-v1/contract.mjs';

const json = path => JSON.parse(readFileSync(new URL(`../../${path}`,import.meta.url),'utf8'));
const evidence = 'docs/evidence/';
export const {scope} = json(evidence+'sandbox-first-purchase-activation.prepared.json');
export const draft = json(evidence+'sandbox-first-purchase-activation-consolidated.prepared.json');
const registration = json(evidence+'sandbox-registration-ecr-publication.prepared.json');
const accessHistory = json('ops/aws-sandbox/reviews/platform-hosted-access-w8d.review.json');
const digest = /^sha256:[a-f0-9]{64}$/;
const sha = value => hash(canonical(value));
const check = (ok,reason) => { if(!ok) throw Error('FIRST_PURCHASE_ACTIVATION_'+reason); };
const arnPrefix=`arn:aws:secretsmanager:${P.region}:${P.account}:secret:${draft.runtimeMaterial.newSecretName}-`;
export function exactSecretArn(arn){
  check(typeof arn==='string' && arn.startsWith(arnPrefix) && /^[A-Za-z0-9]{6}$/.test(arn.slice(arnPrefix.length)),'SECRET_ARN');
  return arn;
}

export function firstPurchaseSecretProtection(arn){
  const policy=handoffPolicy();
  for(const statement of policy.Statement)statement.Resource=exactSecretArn(arn);
  return policy;
}

export function firstPurchaseOriginalTemplates(){
  const access=suppliedTemplate(accessHistory.appSecret.arn,accessHistory.appSecret.versionId);
  const hosting=json('ops/deployment-baseline/platform-idle-convergence.template.json');
  const box=hosting.Resources.TaskDefinition.Properties.ContainerDefinitions[0];
  hosting.Resources.Service.Properties.DesiredCount=1;
  box.Image=box.Image.split('@')[0]+'@'+scope.observedWebRegistryManifest;
  hosting.Metadata.ImageSource='sha256:'+registration.source.sourceRecipeSha256;
  hosting.Metadata.ImageConfigDigest=registration.source.artifact.imageConfigDigest;
  check(sha(access)===draft.originalSnapshot.accessTemplateCanonicalSha256 &&
    sha(hosting)===draft.originalSnapshot.hostingTemplateCanonicalSha256,'ORIGINAL_TEMPLATES_CHANGED');
  return {access,hosting};
}

export function buildFirstPurchaseActivationTemplates({workspaceId,planId,publisher,secret}){
  const purchaseScope={workspaceId,planId,releaseId:scope.tenantReleaseId,imageUri:scope.tenantReleaseImage};
  check(validSandboxPurchaseScope(purchaseScope),'BINDING');
  const expected=DAHLIA_FIRST_PURCHASE_CANDIDATE;
  check(publisher?.locked===true && publisher.artifactId===expected.artifactId && publisher.sourceRecipeSha256===expected.sourceRecipeSha256 &&
    publisher.sourceTreeOid===expected.sourceTreeOid && publisher.imageConfigDigest===expected.imageConfigDigest &&
    typeof publisher.manifestDigest==='string' && digest.test(publisher.manifestDigest) &&
    ![scope.observedWebRegistryManifest,expected.imageConfigDigest].includes(publisher.manifestDigest),'PUBLISHER_RECEIPT');
  const arn=exactSecretArn(secret?.arn);
  const version=versionId(secret.versionId);
  const {access,hosting}=firstPurchaseOriginalTemplates();
  const append=[
    {Sid:'ExactFirstPurchaseSecretVersion',Effect:'Allow',Action:'secretsmanager:GetSecretValue',Resource:arn,
      Condition:{StringEquals:{'secretsmanager:VersionId':version}}},
    {Sid:'ExactFirstPurchaseForwardedDecrypt',Effect:'Allow',Action:'kms:Decrypt',Resource:P.kmsArn,Condition:{StringEquals:{
      'kms:ViaService':`secretsmanager.${P.region}.amazonaws.com`,'kms:CallerAccount':P.account,
      'kms:EncryptionContext:SecretARN':arn,'kms:EncryptionContext:SecretVersionId':version}}},
  ];
  const r=access.Resources;
  r.ExecutionBoundary.Properties.PolicyDocument.Statement.push(...structuredClone(append));
  r.ExecutionRole.Properties.Policies[0].PolicyDocument.Statement.push(...structuredClone(append));

  const box=hosting.Resources.TaskDefinition.Properties.ContainerDefinitions[0];
  box.Image=box.Image.split('@')[0]+'@'+publisher.manifestDigest;
  hosting.Metadata.ImageSource='sha256:'+publisher.sourceRecipeSha256;
  hosting.Metadata.ImageConfigDigest=publisher.imageConfigDigest;
  const bindings={TECHLONG_SANDBOX_FIRST_PURCHASE:'true',AWS_SANDBOX_FIRST_ONBOARDING_WORKSPACE_ID:workspaceId,
    TECHLONG_SANDBOX_FIRST_PURCHASE_PLAN_ID:planId,AWS_SANDBOX_FIRST_ONBOARDING_RELEASE_ID:scope.tenantReleaseId,
    TECHLONG_SANDBOX_FIRST_PURCHASE_IMAGE_URI:scope.tenantReleaseImage};
  const fields=draft.runtimeMaterial.ecsSecretFields;
  check(!box.Environment.some(x=>Object.hasOwn(bindings,x.Name)) && !box.Secrets.some(x=>Object.hasOwn(fields,x.Name)),'DUPLICATE_RUNTIME_BINDING');
  box.Environment.push(...Object.entries(bindings).map(([Name,Value])=>({Name,Value})));
  box.Secrets.push(...Object.entries(fields).map(([Name,key])=>({Name,ValueFrom:`${arn}:${key}::${version}`})));
  return {
    access:{stackId:scope.expectedAccessStackId,template:access,canonicalSha256:sha(access),expectedChanges:draft.offlineTemplateShapeWitnesses.accessExpectedChangeSet},
    hosting:{stackId:scope.expectedHostingStackId,template:hosting,canonicalSha256:sha(hosting),expectedChanges:draft.offlineTemplateShapeWitnesses.hostingExpectedChangeSet},
  };
}

export function checkoutRepairHostingTarget(installed,publisher,baselineDigest){
  return imageOnlyHostingTarget(installed,publisher,baselineDigest,DAHLIA_FIRST_PURCHASE_CANDIDATE,CHECKOUT_REPAIR_CANDIDATE);
}

export function billingRepairHostingTarget(installed,publisher,baselineDigest){
  return imageOnlyHostingTarget(installed,publisher,baselineDigest,CHECKOUT_REPAIR_CANDIDATE,BILLING_REPAIR_CANDIDATE);
}

function imageOnlyHostingTarget(installed,publisher,baselineDigest,previous,c){
  check(publisher?.locked===true&&publisher.artifactId===c.artifactId&&publisher.sourceRecipeSha256===c.sourceRecipeSha256&&
    publisher.sourceTreeOid===c.sourceTreeOid&&publisher.imageConfigDigest===c.imageConfigDigest&&digest.test(publisher.manifestDigest??'')&&
    ![baselineDigest,c.imageConfigDigest].includes(publisher.manifestDigest),'REPAIR_PUBLISHER_PROOF');
  const template=structuredClone(installed.template);
  const box=template.Resources.TaskDefinition.Properties.ContainerDefinitions[0];
  const uri=`${c.account}.dkr.ecr.${c.region}.amazonaws.com/${c.ecrRepository}@`;
  check(installed.stackId===scope.expectedHostingStackId&&box.Image===uri+baselineDigest&&
    template.Metadata.ImageSource==='sha256:'+previous.sourceRecipeSha256&&
    template.Metadata.ImageConfigDigest===previous.imageConfigDigest,'REPAIR_BASE_TEMPLATE');
  box.Image=uri+publisher.manifestDigest;
  template.Metadata.ImageSource='sha256:'+c.sourceRecipeSha256;
  template.Metadata.ImageConfigDigest=c.imageConfigDigest;
  return {stackId:installed.stackId,template,canonicalSha256:sha(template),expectedChanges:['TaskDefinition:Modify:True','Service:Modify:False']};
}
