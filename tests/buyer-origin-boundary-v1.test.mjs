// Narrow regression for the real mainline blocker; no private files/network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {prepareCloudContextV5} from '../ops/cloud-worker/cloud-context-v5.mjs';
import {validateExternalParameter} from '../lib/deployments/execution/parameters.ts';
import {sha256Hex} from '../lib/deployments/execution/hash.ts';
const capsule=JSON.parse(await readFile(new URL('../ops/cloud-worker/material/public-capsule-v5.json',import.meta.url),'utf8'));
const context=await prepareCloudContextV5(capsule);
const validate=value=>validateExternalParameter({name:'CorsAllowedOrigins',value,environment:context.root.material.environment});
test('original two-origin material remains valid and unchanged',()=>{
  assert.equal(context.publicParameters.CorsAllowedOrigins,'https://first-acceptance.sandbox.techlong.cloud,https://techlong.cloud');
  assert.doesNotThrow(()=>validate(context.publicParameters.CorsAllowedOrigins));
});
test('raw CDN addition cannot pass the frozen renderer even when its capsule hash is reconstructed',()=>{
  assert.throws(()=>validate(context.publicParameters.CorsAllowedOrigins+',https://d3a0kml1xanzgt.cloudfront.net'),
    /must use the techlong\.cloud HTTPS boundary/);
});
test('a proposed same-boundary buyer hostname needs no validator exception; this does not prove DNS/CDN installation',()=>{
  assert.doesNotThrow(()=>validate(context.publicParameters.CorsAllowedOrigins+',https://buyer.sandbox.techlong.cloud'));
});
for(const origin of ['*','http://buyer.sandbox.techlong.cloud','https://buyer.sandbox.techlong.cloud.attacker.example',
  'https://buyer.sandbox.techlong.cloud/path','https://buyer.sandbox.techlong.cloud?query=1',
  'https://user:password@buyer.sandbox.techlong.cloud'])
  test('the boundary still rejects '+origin,()=>assert.throws(()=>validate(origin)));

const proposal=JSON.parse(await readFile(new URL('../ops/aws-sandbox/reviews/buyer-web-sandbox-v1.domain-template-proposal.json',import.meta.url),'utf8'));
const plan=JSON.parse(await readFile(new URL('../ops/aws-sandbox/reviews/buyer-web-sandbox-v1.domain-plan.json',import.meta.url),'utf8'));
const baselineText=(await readFile(new URL('../ops/aws-sandbox/cloudformation/buyer-web-sandbox-v1.candidate.template.json',import.meta.url),'utf8')).replaceAll('\r\n','\n');
const baseline=JSON.parse(baselineText);
test('domain proposal is unapproved, region-bound and has no invented certificate ARN or default',async()=>{
  assert.equal(proposal.executionAuthorized,false);assert.equal(plan.executionAuthorized,false);
  assert.equal(proposal.executionApprovalSha256,null);assert.equal(plan.executionApprovalSha256,null);
  assert.equal(proposal.actualCertificateArn,null);assert.equal(plan.certificate.actualArn,null);
  const parameter=proposal.parametersToAdd.SandboxBuyerCertificateArn;
  assert.equal(Object.hasOwn(parameter,'Default'),false);
  const pattern=new RegExp(parameter.AllowedPattern),arn='arn:aws:acm:us-east-1:402010193138:certificate/11111111-2222-3333-4444-555555555555';
  assert(pattern.test(arn));
  assert(!pattern.test(arn.replace('us-east-1','ca-central-1')));
  assert(!pattern.test(arn.replace('402010193138','111111111111')));
  assert.equal(plan.certificate.exportable,false);
  const {capsuleSha256,...body}=structuredClone(capsule);
  assert.equal(await sha256Hex(body),capsuleSha256);
  body.publicParameters.CorsAllowedOrigins=plan.backendFollowup.corsOrigins;
  validate(body.publicParameters.CorsAllowedOrigins);
  assert.equal(await sha256Hex(body),plan.backendFollowup.candidatePublicCapsuleBodySha256);
});
test('pure candidate composition is one distribution modify and two DNS additions; all IAM/bucket/OAC content is identical',()=>{
  assert.equal(createHash('sha256').update(baselineText).digest('hex'),proposal.baselineNormalizedLfSha256);
  const candidate=structuredClone(baseline);
  candidate.Parameters=structuredClone(proposal.parametersToAdd);
  Object.assign(candidate.Resources.BuyerDistribution.Properties.DistributionConfig,structuredClone(proposal.distributionConfigFieldsToSet));
  Object.assign(candidate.Resources,structuredClone(proposal.resourcesToAdd));
  Object.assign(candidate.Outputs,structuredClone(proposal.outputsToAdd));
  assert.equal(Object.keys(candidate.Resources).length,8);
  for(const [id,resource] of Object.entries(baseline.Resources))
    if(id!=='BuyerDistribution')assert.deepEqual(candidate.Resources[id],resource);
  const restored=structuredClone(candidate);
  delete restored.Parameters;
  delete restored.Resources.BuyerAliasIpv4;delete restored.Resources.BuyerAliasIpv6;
  delete restored.Outputs.BuyerCustomOrigin;
  restored.Resources.BuyerDistribution=structuredClone(baseline.Resources.BuyerDistribution);
  assert.deepEqual(restored,baseline);
  assert.deepEqual(Object.keys(proposal.distributionConfigFieldsToSet).sort(),['Aliases','Comment','ViewerCertificate']);
});
test('DNS aliases use the existing public zone and distribution; no new hosted zone or literal guessed target',()=>{
  assert.deepEqual(Object.keys(proposal.resourcesToAdd),['BuyerAliasIpv4','BuyerAliasIpv6']);
  assert.deepEqual(Object.values(proposal.resourcesToAdd).map(r=>r.Properties.Type),['A','AAAA']);
  for(const record of Object.values(proposal.resourcesToAdd)){
    assert.equal(record.Type,'AWS::Route53::RecordSet');
    assert.equal(record.Properties.HostedZoneId,plan.existingPublicHostedZoneId);
    assert.equal(record.Properties.Name,plan.domain+'.');
    assert.deepEqual(record.Properties.AliasTarget.DNSName,{'Fn::GetAtt':['BuyerDistribution','DomainName']});
    assert.equal(record.Properties.AliasTarget.HostedZoneId,'Z2FDTNDATAQYW2');
    assert.equal(record.Properties.AliasTarget.EvaluateTargetHealth,false);
  }
});
test('viewer remains HTTPS-only SNI, original origin/cache/objects and publisher remain untouched',()=>{
  const config=proposal.distributionConfigFieldsToSet;
  assert.deepEqual(config.Aliases,[plan.domain]);
  assert.equal(config.ViewerCertificate.SslSupportMethod,'sni-only');
  assert.equal(config.ViewerCertificate.MinimumProtocolVersion,'TLSv1.2_2021');
  assert.deepEqual(config.ViewerCertificate.AcmCertificateArn,{Ref:'SandboxBuyerCertificateArn'});
  assert.equal(baseline.Resources.BuyerDistribution.Properties.DistributionConfig.DefaultCacheBehavior.ViewerProtocolPolicy,'https-only');
  assert.equal(plan.futureReviewedDirectWriteLimitsNotAuthorizedNow.privateReadsUploadsDispatchesOrBackendCreates,0);
});
