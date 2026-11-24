import assert from "node:assert/strict";
import test from "node:test";
import { firstOpenBuyerSignerEnvName, firstOpenBuyerSignerSecretName } from "../lib/buyer-forward/signer-binding.ts";
import { sha256Hex } from "../lib/deployments/execution/hash.ts";
import { renderFirstOpenBuyerForwardHosting } from "../ops/aws-sandbox/buyer-forward-hosting.ts";
import hostingBase from "../ops/deployment-baseline/platform-idle-convergence.template.json" with { type: "json" };
import { H } from "../ops/platform-hosted-access-v6/contract.mjs";
import { canonical } from "../ops/platform-ecs-v1/contract.mjs";
import { accessTemplate } from "../ops/platform-ecs-v1/templates.mjs";
import { BILLING_REPAIR_CANDIDATE, BUYER_FORWARD_CANDIDATE } from "../ops/platform-registration-publish-v1/contract.mjs";
import billing from "../docs/evidence/sandbox-first-purchase-billing-continuation.verified.json" with { type: "json" };

test("first-open buyer signer adds one fixed VersionId to the existing execution role/boundary and ECS secret injection only", async () => {
  const access = accessTemplate(H.baseNonce);
  const args = {
    access: { stackId: H.stackId, template: access, canonicalSha256: await sha256Hex(canonical(access)) },
    hosting: { stackId: "arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-platform-hosting-v1/c4bf36b0-cf13-11f1-b94e-06ffda9fc5c7",
      template: hostingBase, canonicalSha256: await sha256Hex(canonical(hostingBase)) },
  };
  const locked = await renderFirstOpenBuyerForwardHosting(args);
  assert.equal(locked.signerConfigured, false);
  assert.equal(locked.executionAuthorized, false);
  assert.deepEqual(locked.access.template, access);
  assert.deepEqual(locked.hosting.template, hostingBase);
  assert.deepEqual([...locked.access.expectedChanges, ...locked.hosting.expectedChanges], []);

  const versionId = "54e22cf8-e142-4448-a175-a37eefa88611";
  const signer = { arn: `arn:aws:secretsmanager:ca-central-1:402010193138:secret:${firstOpenBuyerSignerSecretName}-Ab12Cd`, versionId };
  const candidate = await renderFirstOpenBuyerForwardHosting({ ...args, signer });
  assert.equal(candidate.signerConfigured, true);
  assert.equal(candidate.executionAuthorized, false);
  const expected = {
    Sid: "FirstOpenExactBuyerForwardSignerVersion", Effect: "Allow", Action: "secretsmanager:GetSecretValue", Resource: signer.arn,
    Condition: { StringEquals: { "secretsmanager:VersionId": signer.versionId } },
  };
  assert.deepEqual(candidate.access.template.Resources.ExecutionBoundary.Properties.PolicyDocument.Statement.pop(), expected);
  assert.deepEqual(candidate.access.template.Resources.ExecutionRole.Properties.Policies[0].PolicyDocument.Statement.pop(), expected);
  assert.deepEqual(candidate.access.template, access);
  assert.deepEqual(candidate.hosting.template.Resources.TaskDefinition.Properties.ContainerDefinitions[0].Secrets.pop(),
    { Name: firstOpenBuyerSignerEnvName, ValueFrom: `${signer.arn}:::${versionId}` });
  assert.deepEqual(candidate.hosting.template, hostingBase);

  const aliased = structuredClone(access);
  aliased.Resources.ExecutionRole.Properties.Policies[0].PolicyDocument = aliased.Resources.ExecutionBoundary.Properties.PolicyDocument;
  const aliasedDraft = await renderFirstOpenBuyerForwardHosting({ ...args,
    access: { ...args.access, template: aliased, canonicalSha256: await sha256Hex(canonical(aliased)) }, signer });
  const aliasedBoundary = aliasedDraft.access.template.Resources.ExecutionBoundary.Properties.PolicyDocument.Statement;
  const aliasedInline = aliasedDraft.access.template.Resources.ExecutionRole.Properties.Policies[0].PolicyDocument.Statement;
  assert.equal(aliasedBoundary.filter(statement => statement.Sid === expected.Sid).length, 1);
  assert.equal(aliasedInline.filter(statement => statement.Sid === expected.Sid).length, 1);

  for (const invalid of [
    { ...signer, versionId: "AWSCURRENT" },
    { ...signer, arn: signer.arn.replace("ca-central-1", "us-east-1") },
    { ...signer, arn: signer.arn.replace(firstOpenBuyerSignerSecretName, "techlong/sandbox/tenant/other/runtime/g1") },
    { ...signer, SecretString: "unreviewed" },
  ]) await assert.rejects(renderFirstOpenBuyerForwardHosting({ ...args, signer: invalid }), /SIGNER_PIN/);
  await assert.rejects(renderFirstOpenBuyerForwardHosting({ ...args, signer,
    hosting: { ...args.hosting, canonicalSha256: "0".repeat(64) } }), /BASELINE/);
  const wrongRole = structuredClone(hostingBase);
  wrongRole.Resources.TaskDefinition.Properties.ExecutionRoleArn += "-different";
  await assert.rejects(renderFirstOpenBuyerForwardHosting({ ...args, signer,
    hosting: { ...args.hosting, template: wrongRole, canonicalSha256: await sha256Hex(canonical(wrongRole)) } }), /RESOURCE_SCOPE/);
});

test("the fixed published buyer-forward image and signer are rendered as one hosting change", async () => {
  const access = accessTemplate(H.baseNonce);
  const hosting = structuredClone(hostingBase);
  const { account, region, ecrRepository, imageConfigDigest, sourceRecipeSha256, artifactId, sourceTreeOid } = BUYER_FORWARD_CANDIDATE;
  const uri = `${account}.dkr.ecr.${region}.amazonaws.com/${ecrRepository}@`;
  const web = hosting.Resources.TaskDefinition.Properties.ContainerDefinitions[0];
  web.Image = uri + billing.publication.manifestDigest;
  hosting.Metadata.ImageSource = "sha256:" + BILLING_REPAIR_CANDIDATE.sourceRecipeSha256;
  hosting.Metadata.ImageConfigDigest = BILLING_REPAIR_CANDIDATE.imageConfigDigest;
  const input = {
    access: { stackId: H.stackId, template: access, canonicalSha256: await sha256Hex(canonical(access)) },
    hosting: { stackId: "arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-platform-hosting-v1/c4bf36b0-cf13-11f1-b94e-06ffda9fc5c7",
      template: hosting, canonicalSha256: await sha256Hex(canonical(hosting)) },
  };
  const signer = {
    arn: `arn:aws:secretsmanager:ca-central-1:402010193138:secret:${firstOpenBuyerSignerSecretName}-Ab12Cd`,
    versionId: "54e22cf8-e142-4448-a175-a37eefa88611",
  };
  const published = { locked: true, artifactId, sourceRecipeSha256, sourceTreeOid, imageConfigDigest, manifestDigest: "sha256:" + "e".repeat(64) };
  const target = await renderFirstOpenBuyerForwardHosting({ ...input, signer, published });
  assert.equal(target.executionAuthorized, false);
  assert.deepEqual(target.hosting.expectedChanges, ["TaskDefinition:Modify:True", "Service:Modify:False"]);
  const next = target.hosting.template;
  const box = next.Resources.TaskDefinition.Properties.ContainerDefinitions[0];
  assert.equal(box.Image, uri + published.manifestDigest);
  assert.equal(next.Metadata.ImageSource, "sha256:" + sourceRecipeSha256);
  assert.equal(next.Metadata.ImageConfigDigest, imageConfigDigest);
  assert.equal(box.Secrets.pop()?.ValueFrom, `${signer.arn}:::${signer.versionId}`);
  box.Image = web.Image;
  next.Metadata = structuredClone(hosting.Metadata);
  assert.deepEqual(next, hosting);
  await assert.rejects(renderFirstOpenBuyerForwardHosting({ ...input, published }), /IMAGE_REQUIRES_SIGNER/);
  for (const bad of [{ ...published, locked: false }, { ...published, artifactId: artifactId + 1 },
    { ...published, manifestDigest: billing.publication.manifestDigest }]) {
    await assert.rejects(renderFirstOpenBuyerForwardHosting({ ...input, signer, published: bad }), /REPAIR_PUBLISHER_PROOF/);
  }
});
