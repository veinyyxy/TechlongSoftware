import { STACK_CONTROL_RETIREMENT as r, closedGeneration5Descriptor, compileStackControlRetirement, type StackControlRetirementIntent,
  type StackControlRetirementObservation } from "../../lib/deployments/execution/arn-probe-stack-control-generation5-retirement.ts";

// Complete already-published Locked/v7 snapshot; no SDK, secret or live file.
const management = {
  schemaVersion: 1, accountId: "402010193138", region: "ca-central-1", callerArn: "arn:aws:iam::402010193138:user/techlong-sandbox-dev",
  rendererShape: "Locked", cellStackState: "MISSING", authorityState: "ABSENT", observedAt: "2026-10-05T04:35:20.785Z",
  policies: [
    { arn: "arn:aws:iam::402010193138:policy/TechlongSandboxCellOperatorBoundary", attachmentCount: 1,
      boundaryRoleArns: ["arn:aws:iam::402010193138:role/TechlongSandboxCellOperatorRole"], defaultDocumentSha256: "2d0664ef47efebdbc9e06038562d116bc2307a8b940f0042d0942a1b18d75938",
      defaultVersionId: "v7", identityRoleArns: ["arn:aws:iam::402010193138:role/TechlongSandboxCellOperatorRole"], logicalId: "CellOperatorBoundary",
      name: "TechlongSandboxCellOperatorBoundary", permissionsBoundaryUsageCount: 1, versionIds: ["v6", "v7"] },
    { arn: "arn:aws:iam::402010193138:policy/TechlongSandboxCellCloudFormationExecutionBoundary", attachmentCount: 0,
      boundaryRoleArns: ["arn:aws:iam::402010193138:role/TechlongSandboxCellCloudFormationExecutionRole"], defaultDocumentSha256: "6693c48a9826ccd3259730d37ec47d31711679e428179120b28d1aa034e787e8",
      defaultVersionId: "v1", identityRoleArns: [], logicalId: "CellCloudFormationExecutionBoundary", name: "TechlongSandboxCellCloudFormationExecutionBoundary",
      permissionsBoundaryUsageCount: 1, versionIds: ["v1"] },
  ],
  roles: [
    { arn: "arn:aws:iam::402010193138:role/TechlongSandboxCellOperatorRole", attachedPolicyArns: ["arn:aws:iam::402010193138:policy/TechlongSandboxCellOperatorBoundary"],
      inlinePolicyNames: [], logicalId: "CellOperatorRole", name: "TechlongSandboxCellOperatorRole", permissionsBoundaryArn: "arn:aws:iam::402010193138:policy/TechlongSandboxCellOperatorBoundary",
      trustPolicySha256: "50ae144b92892fa96d3f60b710bdec378a5d277f09c811473245e3ed1c90b754" },
    { arn: "arn:aws:iam::402010193138:role/TechlongSandboxCellCloudFormationExecutionRole", attachedPolicyArns: [], inlinePolicyNames: [], logicalId: "CellCloudFormationExecutionRole",
      name: "TechlongSandboxCellCloudFormationExecutionRole", permissionsBoundaryArn: "arn:aws:iam::402010193138:policy/TechlongSandboxCellCloudFormationExecutionBoundary",
      trustPolicySha256: "9807ebf5cf955270cb96973d9512cfefa44bf1d342556d22f16700959955df18" },
  ],
  stack: { id: r.stackId, name: "techlong-s3-b5-cell-lifecycle-management", parentId: null, rootId: null, roleArn: null, terminationProtection: false,
    status: "UPDATE_COMPLETE", safetyState: "LOCKED_IAM_MANAGEMENT_ROOT_APPLY_ENABLED_EXECUTION_NOT_APPROVED_NO_PAID_CELL",
    templateCanonicalSha256: "803f28a0741f411493852dbaa2282fba2aa109b4f64b4986ee85d97e39eccda5", templateRawSha256: "acaa2b5e65361b84ed8fd3fb55d5a512b64bbf51b9fd855837d0adeef2f06bc1",
    resources: [
      { logicalId: "CellOperatorBoundary", physicalResourceId: "arn:aws:iam::402010193138:policy/TechlongSandboxCellOperatorBoundary", resourceStatus: "UPDATE_COMPLETE", resourceType: "AWS::IAM::ManagedPolicy" },
      { logicalId: "CellOperatorRole", physicalResourceId: "TechlongSandboxCellOperatorRole", resourceStatus: "CREATE_COMPLETE", resourceType: "AWS::IAM::Role" },
      { logicalId: "CellCloudFormationExecutionBoundary", physicalResourceId: "arn:aws:iam::402010193138:policy/TechlongSandboxCellCloudFormationExecutionBoundary", resourceStatus: "CREATE_COMPLETE", resourceType: "AWS::IAM::ManagedPolicy" },
      { logicalId: "CellCloudFormationExecutionRole", physicalResourceId: "TechlongSandboxCellCloudFormationExecutionRole", resourceStatus: "CREATE_COMPLETE", resourceType: "AWS::IAM::Role" },
    ] },
} as const;
const fixture = { state: "READY_UNEXECUTED", resourceCount: 0,
  stackId: "arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-arn-compatibility-probe/e5fcb450-bf3d-11f1-8f15-02cdaaa60ec7",
  changeSetArn: "arn:aws:cloudformation:ca-central-1:402010193138:changeSet/techlong-sandbox-arn-compatibility-probe-08b7955eb7029b3a/ffac6957-44d4-4485-9d08-d018a0be3f11",
  templateCanonicalSha256: "00bba9b57a32c6b777a2afb1079f8303821e550162fc720af69099c6d301ba75" } as const;
export function generation5Observation(at: number, missing = false): StackControlRetirementObservation {
  const time = (offset: number) => new Date(at - offset).toISOString(), proof = "a".repeat(64);
  return { managementBefore: { ...structuredClone(management), observedAt: time(6000) }, managementAfter: { ...structuredClone(management), observedAt: time(1000) },
    fixture: { ...fixture, observedAt: time(5000) }, fixtureInventory: { stackId: fixture.stackId, changeSetArn: fixture.changeSetArn,
      changeSetName: "techlong-sandbox-arn-compatibility-probe-08b7955eb7029b3a", status: "CREATE_COMPLETE", executionStatus: "AVAILABLE", complete: true, count: 1,
      observedAt: time(4000), providerEvidenceSha256: proof },
    inventory: { stackId: r.stackId, complete: true, observedAt: time(3000), providerEvidenceSha256: proof,
      objects: missing ? [] : [{ kind: "CURRENT_GRANT", arn: r.grantArn, status: "CREATE_COMPLETE", executionStatus: "AVAILABLE" }] } };
}
export async function generation5RetirementFixture() {
  let current = Date.parse("2026-10-05T05:00:00.000Z"), intent: StackControlRetirementIntent | null = null, missing = false;
  const predecessor = await closedGeneration5Descriptor(), events: string[] = [];
  const manifest = await compileStackControlRetirement({ predecessor, observation: generation5Observation(current), reviewedAt: new Date(current).toISOString(), expiresAt: new Date(current + 300_000).toISOString() });
  const abort = new AbortController();
  return { manifest, predecessor, events, abort, signal: abort.signal, now: () => current, setTime: (v: number) => { current = v; }, setMissing: () => { missing = true; },
    readPredecessor: async () => predecessor,
    ledger: { read: async () => intent, reserve: async (v: StackControlRetirementIntent) => { if (intent) throw new Error("Consumed"); events.push("reserve"); intent = v; } },
    observe: async () => { events.push("observe"); return generation5Observation(current, missing); },
    deleteChangeSet: async () => { events.push("delete"); missing = true; return { $metadata: { requestId: "fa31aa1d-7347-4267-a0d3-cc6089773c58" } }; },
    approval: { approvedManifestSha256: manifest.manifestSha256, executionPhrase: manifest.requiredPhrase, acknowledgeDeletionIrreversible: true, acknowledgeLowCostNotZero: true },
  };
}
