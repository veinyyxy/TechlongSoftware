import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../../..");
const paths = {
  core: path.join(
    repositoryRoot,
    "lib/deployments/execution/shared-cell-author-compensation.ts",
  ),
  test: path.join(
    repositoryRoot,
    "tests/shared-cell-author-compensation.test.ts",
  ),
  adapter: path.join(
    repositoryRoot,
    "lib/deployments/execution/aws-sdk-shared-cell-author-compensation.ts",
  ),
  adapterTest: path.join(
    repositoryRoot,
    "tests/aws-sdk-shared-cell-author-compensation.test.ts",
  ),
  wrapper: path.join(
    scriptDirectory,
    "s3-b5-shared-cell-author-compensation.ps1",
  ),
  runtime: path.join(
    repositoryRoot,
    "lib/deployments/execution/runtime-composition.ts",
  ),
};

const [core, testSource, adapter, adapterTestSource, wrapper, runtime] = await Promise.all(
  Object.values(paths).map((value) => readFile(value, "utf8")),
);

function assertIncludesAll(source, values, label) {
  for (const value of values) {
    assert.ok(source.includes(value), `${label} is missing ${value}`);
  }
}

assert.match(wrapper, /\[ValidateSet\('LocalValidate'\)\]/);
assert.match(wrapper, /\[string\]\$Mode = 'LocalValidate'/);
assert.match(wrapper, /validate-b5-shared-cell-author-compensation\.mjs/);
assert.match(wrapper, /LOCAL_ONLY_REVIEW_IN_PROGRESS_COMPENSATION_NOT_CLOUD_WIRED/);
assert.match(wrapper, /No cloud API was called; this wrapper exposes no online mode\./);
assert.doesNotMatch(wrapper, /\baws(?:\.exe)?\b/i);
assert.doesNotMatch(
  wrapper,
  /CreateChangeSet|ExecuteChangeSet|DeleteChangeSet|DeleteStack|PutItem/,
);

assertIncludesAll(
  core,
  [
    '"402010193138"',
    '"ca-central-1"',
    '"techlong-sandbox-cell-sandbox-1"',
    "SharedCellAuthorCompensationReadPort",
    "StrongSharedCellAuthorAuthorityReadPort",
    "SharedCellAuthorCompensationMutationPort",
    "SharedCellAuthorDeleteChangeSetMutationPort",
    "SharedCellAuthorDeleteStackMutationPort",
    "compileSharedCellAuthorCompensationPlan",
    "inspectSharedCellAuthorCompensation",
    "executeReviewedSharedCellAuthorDeleteChangeSet",
    "executeReviewedSharedCellAuthorDeleteStack",
    "executeReviewedSharedCellAuthorCompensation",
    "recoverSharedCellAuthorCompensation",
    '"REVIEW_IN_PROGRESS"',
    '"DELETE_IN_PROGRESS"',
    '"REVIEW_CHANGE_SET_MISSING"',
    "compensationGrant",
    "deleteChangeSetMinimumRemainingMs",
    "deleteStackMinimumRemainingMs",
    "assertMutationCaller",
    "SHARED_CELL_AUTHOR_COMPENSATION_CHANGE_SET_POST_SUBMIT_UNCERTAIN",
    "SHARED_CELL_AUTHOR_COMPENSATION_STACK_POST_SUBMIT_UNCERTAIN",
    "safeToAuthorRevoke",
    'DeletionMode: "STANDARD"',
    "deleteChangeSet",
    "deleteStack",
    "getChangeSetTemplate",
    "operationSha256",
    "phasePlanSha256",
  ],
  "author compensation core",
);
assert.match(core, /DescribeStacks[\s\S]*GetTemplate\(Original\)[\s\S]*ListStackResources/);
assert.match(core, /DescribeChangeSet\(exact ARN\)/);
assert.match(core, /b5-author-comp-\$\{operationSha256\.slice\(0, 32\)\}/);
assert.match(core, /CREATE_COMPLETE/);
assert.match(core, /AVAILABLE/);
assert.match(core, /authority[\s\S]*ABSENT/i);
assert.match(core, /stack\.roleArn\s*!==\s*candidate\.changeSet\.roleArn/);
assert.match(core, /\(item\s*===\s*null\)\s*!==\s*\(revision\s*===\s*0\)/);
assert.doesNotMatch(core, /from\s+["']@aws-sdk|node:child_process/);
assert.doesNotMatch(core, /ExecuteChangeSet|CreateChangeSet|PutItem|compareAndSet/);

assertIncludesAll(
  adapter,
  [
    "AwsSdkSharedCellAuthorCompensationEvidenceAdapter",
    "AwsSdkSharedCellAuthorDeleteChangeSetAdapter",
    "AwsSdkSharedCellAuthorDeleteStackAdapter",
    "createAwsSdkSharedCellAuthorCompensationRuntimeFromModules",
    "createAwsSdkSharedCellAuthorCompensationRuntime",
    'profile = "techlong-sandbox-cell-operator"',
    'mfaDeviceArn =',
    '"arn:aws:iam::402010193138:mfa/techlong-sandbox-dev"',
    "IncludePropertyValues: true",
    "TemplateStage: \"Original\"",
    'value.name === "ChangeSetNotFoundException"',
    "ARN_BOUND_CHANGE_SET_NOT_FOUND",
    "maxAttempts: 1",
    "ignoreConfiguredEndpointUrls: true",
  ],
  "author compensation AWS adapter",
);
assert.doesNotMatch(adapter, /process\.env|node:child_process/);

assertIncludesAll(
  testSource,
  [
    "inspectSharedCellAuthorCompensation",
    "executeReviewedSharedCellAuthorCompensation",
    "recoverSharedCellAuthorCompensation",
    "compileSharedCellAuthorCompensationPlan",
    "executeReviewedSharedCellAuthorDeleteChangeSet",
    "executeReviewedSharedCellAuthorDeleteStack",
    "safeToAuthorRevoke",
    "AccessDenied",
    "REVIEW_IN_PROGRESS",
    "DELETE_IN_PROGRESS",
    "compensationGrant",
    "Inspect can renew an exact CS-missing rollover window",
  ],
  "author compensation tests",
);
assertIncludesAll(
  adapterTestSource,
  [
    "DescribeChangeSet reads every page",
    "only exact target-bound provider errors prove missing",
    "narrow mutation adapters send only their exact reviewed envelopes",
    "dormant runtime shares one lazy MFA provider",
    "installed dormant runtime construction performs no AWS request",
  ],
  "author compensation AWS adapter tests",
);
assert.doesNotMatch(
  runtime,
  /shared-cell-author-compensation/,
  "offline compensation must remain absent from the runtime root",
);

const tests = spawnSync(
  process.execPath,
  [
    "--experimental-loader",
    "./tests/cloudflare-loader.mjs",
    "--test",
    "tests/shared-cell-author-compensation.test.ts",
    "tests/aws-sdk-shared-cell-author-compensation.test.ts",
  ],
  {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  },
);
assert.equal(
  tests.status,
  0,
  `Shared Cell author compensation tests failed.\n${tests.stdout}\n${tests.stderr}`,
);

console.log(
  "B5 Shared Cell author compensation validated locally (provider-observable evidence, split DeleteChangeSet/DeleteStack phase capabilities, stable operation identity, dormant exact-envelope AWS SDK adapters, stable four-way MISSING proof, separate revoke, no default runtime wiring or AWS call).",
);
