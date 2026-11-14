import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import candidate from "../ops/releases/persistence.draft.template.json" with { type: "json" };
import baseline from "../ops/deployment-baseline/existing-tenant.template.json" with { type: "json" };
import { draftPersistenceIam, draftPersistenceTenant, type PersistenceTemplate } from "../ops/releases/persistence.ts";
import { variant } from "../ops/temporary-idle/environment-cfn.mjs";

const outputs = { MediaBucketName: candidate.Resources.MediaBucket.Properties.BucketName,
  MediaBucketArn: `arn:aws:s3:::${candidate.Resources.MediaBucket.Properties.BucketName}`,
  MediaPublicBaseUrl: "https://dsynthetic123.cloudfront.net" };
const ids = { role: "ApplicationRole", boundary: "RuntimeBoundary" };
const iam = (): PersistenceTemplate => ({ Parameters: { Original: { Type: "String" } }, Metadata: { original: true }, Resources: {
  RuntimeBoundary: { Type: "AWS::IAM::ManagedPolicy", Properties: { ManagedPolicyName: "TechlongSandboxServiceRoleBoundary",
    PolicyDocument: { Version: "2012-10-17", Statement: [{ Sid: "ExistingDatabaseCeiling", Effect: "Allow", Action: "rds-db:connect", Resource: "synthetic-db-user" },
      { Sid: "ExistingDeny", Effect: "Deny", Action: "secretsmanager:GetSecretValue", Resource: "synthetic-management-secret" }] } } },
  ApplicationRole: { Type: "AWS::IAM::Role", Properties: { RoleName: "TechlongSandboxTaskRole", PermissionsBoundary: { Ref: "RuntimeBoundary" },
    AssumeRolePolicyDocument: { Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: { Service: "ecs-tasks.amazonaws.com" }, Action: "sts:AssumeRole" }] },
    Policies: [{ PolicyName: "OriginalDatabaseConnect", PolicyDocument: { Version: "2012-10-17",
      Statement: [{ Effect: "Allow", Action: "rds-db:connect", Resource: "synthetic-db-user" }] } }] } },
  OtherRole: { Type: "AWS::IAM::Role", Properties: { RoleName: "OtherSyntheticRole", PermissionsBoundary: { Ref: "RuntimeBoundary" } } },
}, Outputs: { Original: { Value: "preserved" } } });
const tenant = (): PersistenceTemplate => {
  const t: PersistenceTemplate = { Metadata: { profile: "express_iam" },
    Parameters: Object.fromEntries(baseline.stacks.tenant.parameters.map(k => [k, { Type: "String" }])),
    Resources: Object.fromEntries(Object.entries(baseline.stacks.tenant.resources).map(([id, Type]) => [id, { Type, Properties: {} }])), Outputs: {} };
  t.Resources.TenantTaskDefinition.Properties = { TaskRoleArn: { Ref: "TaskRoleArn" }, ExecutionRoleArn: { Ref: "TaskExecutionRoleArn" },
    ContainerDefinitions: [{ Name: "speedfeast-backend", Image: { Ref: "ImageUri" },
      Secrets: [{ Name: "HMAC_SECRET_KEY", ValueFrom: "synthetic-fixed-version" }],
      Environment: [{ Name: "IMAGE_STORAGE_PROVIDER", Value: "local" }, { Name: "ALLOW_EPHEMERAL_IMAGE_STORAGE", Value: "true" },
        { Name: "AWS_REGION", Value: "ca-central-1" }, { Name: "APP_RUNTIME_MODE", Value: "aws_sandbox_ephemeral_canary" },
        { Name: "PG_DATABASE_BINDING_V2", Value: "synthetic-unchanged-binding" }, { Name: "PG_DATABASE_BINDING_SHA256", Value: "a".repeat(64) }] }] };
  t.Resources.TenantService.Properties = { DesiredCount: 1, TaskDefinition: { Ref: "TenantTaskDefinition" } };
  return t;
};
type Container = { Environment: { Name: string; Value: unknown }[] };
const container = (t: PersistenceTemplate) => (t.Resources.TenantTaskDefinition.Properties.ContainerDefinitions as Container[])[0];
const statements = (t: PersistenceTemplate) => (t.Resources.RuntimeBoundary.Properties.PolicyDocument as { Statement: Record<string, unknown>[] }).Statement;

test("persistence stack has exactly five resources, retained private versioned storage and no compute or IAM", () => {
  assert.deepEqual(Object.values(candidate.Resources).map(r => r.Type).sort(), ["AWS::S3::Bucket", "AWS::S3::BucketPolicy",
    "AWS::CloudFront::Distribution", "AWS::CloudFront::OriginAccessControl", "AWS::CloudFront::ResponseHeadersPolicy"].sort());
  const b = candidate.Resources.MediaBucket;
  assert.equal(b.DeletionPolicy, "Retain"); assert.equal(b.UpdateReplacePolicy, "Retain");
  assert.equal(b.Properties.VersioningConfiguration.Status, "Enabled");
  assert.equal(b.Properties.BucketEncryption.ServerSideEncryptionConfiguration[0].ServerSideEncryptionByDefault.SSEAlgorithm, "AES256");
  assert.ok(Object.values(b.Properties.PublicAccessBlockConfiguration).every(v => v === true));
  assert.equal(b.Properties.OwnershipControls.Rules[0].ObjectOwnership, "BucketOwnerEnforced");
  assert.ok(!("WebsiteConfiguration" in b.Properties) && !("LifecycleConfiguration" in b.Properties));
  assert.ok(!b.Properties.Tags.some(t => /expires|ttl/i.test(t.Key)));
  assert.equal(candidate.Metadata.StackTerminationProtectionRequired, true);
});

test("image CDN uses OAC/default HTTPS only and propagates all CORS preflight/cache inputs", () => {
  const d = candidate.Resources.MediaDistribution.Properties.DistributionConfig, c = d.DefaultCacheBehavior;
  const oac = candidate.Resources.MediaOriginAccessControl.Properties.OriginAccessControlConfig;
  assert.equal(oac.SigningBehavior, "always"); assert.equal(oac.SigningProtocol, "sigv4");
  assert.deepEqual(d.Origins[0].DomainName, { "Fn::GetAtt": ["MediaBucket", "RegionalDomainName"] });
  assert.equal(d.ViewerCertificate.CloudFrontDefaultCertificate, true); assert.equal(c.ViewerProtocolPolicy, "https-only");
  assert.deepEqual(c.AllowedMethods, ["GET", "HEAD", "OPTIONS"]); assert.deepEqual(c.CachedMethods, c.AllowedMethods);
  assert.deepEqual(c.ForwardedValues.Headers, ["Origin", "Access-Control-Request-Method", "Access-Control-Request-Headers"]);
  assert.equal(c.ForwardedValues.Cookies.Forward, "none"); assert.equal(c.ForwardedValues.QueryString, false); assert.equal(c.MaxTTL, 86400);
  const cors = candidate.Resources.MediaResponseHeadersPolicy.Properties.ResponseHeadersPolicyConfig.CorsConfig;
  assert.equal(cors.AccessControlAllowCredentials, false); assert.equal(cors.OriginOverride, true);
  assert.deepEqual(cors.AccessControlAllowOrigins.Items, candidate.Resources.MediaBucket.Properties.CorsConfiguration.CorsRules[0].AllowedOrigins);
  assert.deepEqual(candidate.Resources.MediaBucket.Properties.CorsConfiguration.CorsRules[0].AllowedMethods, ["GET", "HEAD"]);
  assert.ok(!("Aliases" in d) && !("CustomErrorResponses" in d) && !("LambdaFunctionAssociations" in c));
});

test("bucket policy exposes only product-image reads to its exact distribution, never anonymous writes", () => {
  const [deny, allow] = candidate.Resources.MediaBucketPolicy.Properties.PolicyDocument.Statement;
  assert.equal(deny.Effect, "Deny"); assert.deepEqual(deny.Condition, { Bool: { "aws:SecureTransport": "false" } });
  assert.equal(allow.Effect, "Allow"); assert.deepEqual(allow.Principal, { Service: "cloudfront.amazonaws.com" });
  assert.equal(allow.Action, "s3:GetObject"); assert.deepEqual(allow.Resource, { "Fn::Sub": "${MediaBucket.Arn}/products/*" });
  assert.deepEqual(allow.Condition, { StringEquals: { "AWS:SourceArn": {
    "Fn::Sub": "arn:${AWS::Partition}:cloudfront::${AWS::AccountId}:distribution/${MediaDistribution}" } } });
});

test("IAM candidate changes exactly one role policy and one boundary statement without mutating original", () => {
  const original = iam(), before = structuredClone(original), result = draftPersistenceIam(original, ids, outputs);
  assert.deepEqual(original, before); assert.equal(result.executionAuthorized, false); assert.equal(result.liveOwnershipVerified, false);
  const restored = structuredClone(result.template);
  (restored.Resources.ApplicationRole.Properties.Policies as unknown[]).pop(); statements(restored).pop();
  assert.deepEqual(restored, original);
  const added = (result.template.Resources.ApplicationRole.Properties.Policies as { PolicyName: string; PolicyDocument: { Statement: unknown[] } }[]).at(-1)!;
  assert.equal(added.PolicyName, "WriteExactTenantProductImagesD2");
  assert.deepEqual(added.PolicyDocument.Statement, [{ Sid: "D2ProductImagesWrite", Effect: "Allow",
    Action: ["s3:PutObject", "s3:DeleteObject"], Resource: outputs.MediaBucketArn + "/products/*" }]);
});

test("shared boundary image allow is restricted to original application principal and keeps all old protection", () => {
  const original = iam(), t = draftPersistenceIam(original, ids, outputs).template;
  assert.deepEqual(statements(t).slice(0, -1), statements(original));
  assert.deepEqual(statements(t).at(-1), { Sid: "D2ProductImagesWrite", Effect: "Allow", Action: ["s3:PutObject", "s3:DeleteObject"],
    Resource: outputs.MediaBucketArn + "/products/*", Condition: { ArnEquals: { "aws:PrincipalArn": "arn:aws:iam::402010193138:role/TechlongSandboxTaskRole" } } });
  assert.deepEqual(t.Resources.OtherRole, original.Resources.OtherRole);
});

test("IAM candidate rejects another role/boundary layout rather than changing scope or creating a second owner", () => {
  for (const mutate of [
    (t: PersistenceTemplate) => { t.Resources.ApplicationRole.Properties.RoleName = "OtherRole"; },
    (t: PersistenceTemplate) => { t.Resources.ApplicationRole.Properties.PermissionsBoundary = { Ref: "DifferentBoundary" }; },
    (t: PersistenceTemplate) => { t.Resources.RuntimeBoundary.Properties.ManagedPolicyName = "AnotherBoundary"; },
  ]) { const t = iam(); mutate(t); assert.throws(() => draftPersistenceIam(t, ids, outputs), /PERSISTENCE_IAM_SCOPE/); }
});

test("already present image policies are not silently overwritten or treated as a new attempt", () => {
  const t = draftPersistenceIam(iam(), ids, outputs).template;
  assert.throws(() => draftPersistenceIam(t, ids, outputs), /PERSISTENCE_BOUNDARY_ALREADY_PRESENT/);
  statements(t).pop(); assert.throws(() => draftPersistenceIam(t, ids, outputs), /PERSISTENCE_ROLE_POLICY_ALREADY_PRESENT/);
});

test("idle tenant derivation changes exactly four environment values, leaving image/database/secrets/resources untouched", () => {
  const original = variant(tenant(), "tenant", "idle") as PersistenceTemplate, before = structuredClone(original);
  const result = draftPersistenceTenant(original, outputs); assert.equal(result.servicePresent, false);
  assert.equal(result.executionAuthorized, false); assert.deepEqual(original, before);
  const originalEnv = container(original).Environment, nextEnv = container(result.template).Environment;
  assert.deepEqual(Object.fromEntries(nextEnv.filter(e => ["IMAGE_STORAGE_PROVIDER", "IMAGE_S3_BUCKET", "IMAGE_PUBLIC_BASE_URL", "ALLOW_EPHEMERAL_IMAGE_STORAGE"].includes(e.Name)).map(e => [e.Name, e.Value])),
    { IMAGE_STORAGE_PROVIDER: "s3", IMAGE_S3_BUCKET: outputs.MediaBucketName, IMAGE_PUBLIC_BASE_URL: outputs.MediaPublicBaseUrl, ALLOW_EPHEMERAL_IMAGE_STORAGE: "false" });
  const restored = structuredClone(result.template); container(restored).Environment = originalEnv;
  assert.deepEqual(restored, original); assert.equal(Object.keys(result.template.Resources).length, 3);
});

test("running-shape tenant remains exactly the same service and requires separate deployment review", () => {
  const original = tenant(), r = draftPersistenceTenant(original, outputs);
  assert.equal(r.servicePresent, true); assert.deepEqual(r.template.Resources.TenantService, original.Resources.TenantService);
  assert.deepEqual(r.template.Parameters, original.Parameters);
});

test("ambiguous containers/environment or an already S3 baseline are rejected, not normalized away", () => {
  const duplicate = tenant(); container(duplicate).Environment.push({ Name: "IMAGE_STORAGE_PROVIDER", Value: "local" });
  assert.throws(() => draftPersistenceTenant(duplicate, outputs), /PERSISTENCE_AMBIGUOUS_ENVIRONMENT/);
  const changed = tenant(); container(changed).Environment[0].Value = "s3";
  assert.throws(() => draftPersistenceTenant(changed, outputs), /PERSISTENCE_LOCAL_BASELINE_REQUIRED/);
  const wrong = tenant(); wrong.Resources.TenantTaskDefinition.Properties.ContainerDefinitions = [{ Name: "other" }];
  assert.throws(() => draftPersistenceTenant(wrong, outputs), /PERSISTENCE_TENANT_CONTAINER_MISMATCH/);
});

test("another bucket, wildcard ARN, insecure URL or non-CDN origin cannot enter either candidate", () => {
  for (const change of [{ MediaBucketName: "other-bucket" }, { MediaBucketArn: "arn:aws:s3:::*" },
    { MediaPublicBaseUrl: "http://dsynthetic123.cloudfront.net" }, { MediaPublicBaseUrl: "https://other.example" }]) {
    assert.throws(() => draftPersistenceIam(iam(), ids, { ...outputs, ...change }), /PERSISTENCE_OUTPUT_SCOPE/);
    assert.throws(() => draftPersistenceTenant(tenant(), { ...outputs, ...change }), /PERSISTENCE_OUTPUT_SCOPE/);
  }
});

test("existing temporary full/idle derivation preserves S3 environment without owning the data stack", () => {
  const full = draftPersistenceTenant(tenant(), outputs).template;
  const idle = variant(full, "tenant", "idle") as PersistenceTemplate;
  const restored = variant(full, "tenant", "full", 1) as PersistenceTemplate;
  assert.deepEqual(container(full), container(idle)); assert.deepEqual(container(full), container(restored));
  assert.equal(Object.keys(idle.Resources).length, 3); assert.equal(Object.keys(restored.Resources).length, 7);
  assert.ok(!Object.hasOwn(idle.Resources, "MediaBucket"));
});

test("persistence material fingerprints and CI remain offline; no runtime installer or source credentials", async () => {
  const prepared = JSON.parse(await readFile(new URL("../ops/releases/persistence.prepared.json", import.meta.url), "utf8"));
  assert.equal(prepared.executionAuthorized, false); assert.equal(prepared.installationManifestSha256, null);
  assert.equal(prepared.artifacts.length, 2);
  for (const a of prepared.artifacts) {
    const bytes = (await readFile(new URL("../" + a.path, import.meta.url), "utf8")).replaceAll("\r\n", "\n");
    assert.equal(createHash("sha256").update(bytes).digest("hex"), a.sha256, a.path);
  }
  const source = await readFile(new URL("../ops/releases/persistence.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /process\.env|@aws-sdk|fetch\(|writeFile|execFile|readFile/);
  const checks = await readFile(new URL("../.github/workflows/instance-release-checks.yml", import.meta.url), "utf8");
  assert.ok(checks.includes("tests/instance-release-persistence.test.ts")); assert.ok(!checks.includes("id-token: write"));
});
