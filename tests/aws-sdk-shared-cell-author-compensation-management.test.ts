import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  AwsSdkSharedCellAuthorCompensationManagementReadAdapter,
  SharedCellAuthorCompensationManagementAdapterError,
  compilePreparedSharedCellAuthorCompensationManagementAction,
  createPreparedSharedCellAuthorCompensationManagementMutation,
  createAwsSdkSharedCellAuthorCompensationManagementRuntime,
  createAwsSdkSharedCellAuthorCompensationManagementRuntimeFromModules,
  type SharedCellAuthorCompensationManagementReadDependencies,
  type SharedCellAuthorCompensationManagementRuntimeModules,
} from "../lib/deployments/execution/aws-sdk-shared-cell-author-compensation-management.ts";
import { canonicalJson, sha256Hex } from "../lib/deployments/execution/hash.ts";
import {
  SHARED_CELL_AUTHOR_COMPENSATION_MANAGEMENT_STACK_ID as stackId,
  SHARED_CELL_AUTHOR_COMPENSATION_MANAGEMENT_STACK_NAME as stackName,
  SHARED_CELL_AUTHOR_COMPENSATION_SOURCE_CALLER_ARN as sourceArn,
  SharedCellAuthorCompensationLifecycleReceiptProducer,
  compileSharedCellAuthorCompensationLifecycleContract,
} from "../lib/deployments/execution/shared-cell-author-compensation-grant-lifecycle.ts";
import {
  compileSharedCellAuthorCompensationGrantActionRequest,
  compileSharedCellAuthorCompensationRevokeActionRequest,
  type SharedCellAuthorCompensationPhaseGrantMutationPort,
  type SharedCellAuthorCompensationPhaseRevokeMutationPort,
} from "../lib/deployments/execution/shared-cell-author-compensation-grant-controller.ts";
import { reviewSharedCellAuthorCompensationManagementAction, createSharedCellAuthorCompensationManagementEntry } from "../lib/deployments/execution/shared-cell-author-compensation-management-entry.ts";
import { renderB5CellLifecycleManagementTemplate } from "../ops/aws-sandbox/scripts/render-b5-cell-lifecycle-management.mjs";
import { compileArnProbeFixturePlan, ARN_PROBE_FIXTURE_STACK } from "../lib/deployments/execution/arn-compatibility-probe-fixture.ts";
import { compileArnProbeGrantPlan } from "../lib/deployments/execution/arn-compatibility-probe-grant.ts";
import { compileArnProbeReadComparisonPlan } from "../lib/deployments/execution/arn-compatibility-probe-read-comparison.ts";
import { compileArnProbeComparisonCreatePlan } from "../lib/deployments/execution/arn-probe-read-comparison-create.ts";
import { stackControlWorkflowFixture } from "./fixtures/arn-probe-stack-scoped-read-control-workflow.ts";
import { generation6WorkflowFixture } from "./fixtures/arn-probe-generation6-workflow.ts";
import type { SharedCellAuthorCompensationOperationStore } from "../lib/deployments/execution/shared-cell-author-compensation-operation-store.ts";
import { compileSharedCellAuthorCompensationControllerContract } from "../lib/deployments/execution/shared-cell-author-compensation-controller.ts";
import {
  SHARED_CELL_AUTHOR_COMPENSATION_RESOURCE_TYPES,
  SHARED_CELL_AUTHOR_COMPENSATION_ROLE_ARN,
  type SharedCellAuthorCompensationCandidate,
  type SharedCellAuthorCompensationPhase,
  type SharedCellAuthorCompensationCellSafetyState,
} from "../lib/deployments/execution/shared-cell-author-compensation.ts";

const accountId = "402010193138";
const region = "ca-central-1";
const now = Date.parse("2026-10-02T12:02:00.000Z");
const cellName = "techlong-sandbox-cell-sandbox-1";
const cellStackId = `arn:aws:cloudformation:${region}:${accountId}:stack/${cellName}/12345678-1234-4234-8234-123456789012`;
const op = "a".repeat(64), base = "b".repeat(64), phase = "c".repeat(64), controller = "d".repeat(64);
const cellRaw = "1".repeat(64);
const cellChangeSet = `${cellName}-${cellRaw.slice(0, 16)}`;
const cellChangeSetArn = `arn:aws:cloudformation:${region}:${accountId}:changeSet/${cellChangeSet}/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee`;
const names = ["TechlongSandboxCellOperatorBoundary", "TechlongSandboxCellOperatorRole", "TechlongSandboxCellCloudFormationExecutionBoundary", "TechlongSandboxCellCloudFormationExecutionRole"];
const ids = ["CellOperatorBoundary", "CellOperatorRole", "CellCloudFormationExecutionBoundary", "CellCloudFormationExecutionRole"];
const policyArn = (name: string) => `arn:aws:iam::${accountId}:policy/${name}`;
const roleArn = (name: string) => `arn:aws:iam::${accountId}:role/${name}`;
const abort = () => new AbortController().signal;

const cellTemplate = { AWSTemplateFormatVersion: "2010-09-09", Resources: Object.fromEntries(
  SHARED_CELL_AUTHOR_COMPENSATION_RESOURCE_TYPES.map((Type, index) => [`Resource${index}`, { Type, Properties: {} }]),
) };
async function boundCandidate(): Promise<SharedCellAuthorCompensationCandidate> {
  return { schemaVersion: 1, accountId, region, stackName: cellName, stackId: cellStackId,
    compensationGrant: { reviewedAt: "2026-10-02T12:00:00.000Z", expiresAt: "2026-10-02T13:00:00.000Z" },
    immutableTemplate: { url: `https://techlong-sandbox-build-source-${accountId}-${region}.s3.${region}.amazonaws.com/b5-shared-cell/templates/sha256/${cellRaw}.json`, rawSha256: cellRaw, canonicalSha256: await sha256Hex(canonicalJson(cellTemplate)) },
    changeSet: { name: cellChangeSet, arn: cellChangeSetArn, type: "CREATE", roleArn: SHARED_CELL_AUTHOR_COMPENSATION_ROLE_ARN,
      capabilities: [], includeNestedStacks: false, resourceTypes: [...SHARED_CELL_AUTHOR_COMPENSATION_RESOURCE_TYPES],
      parameters: [
        { ParameterKey: "AvailabilityZoneA", ParameterValue: "ca-central-1a" },
        { ParameterKey: "AvailabilityZoneB", ParameterValue: "ca-central-1b" },
        { ParameterKey: "CertificateArn", ParameterValue: `arn:aws:acm:${region}:${accountId}:certificate/12345678-1234-4234-8234-123456789012` },
        { ParameterKey: "ControlTrustStoreArn", ParameterValue: `arn:aws:elasticloadbalancing:${region}:${accountId}:truststore/control/0123456789abcdef` },
        { ParameterKey: "CellJanitorFunctionArn", ParameterValue: `arn:aws:lambda:${region}:${accountId}:function:techlong-sandbox-cell-janitor` },
        { ParameterKey: "CellSchedulerInvokeRoleArn", ParameterValue: `arn:aws:iam::${accountId}:role/TechlongSandboxCellSchedulerInvokeRole` },
        { ParameterKey: "CellSchedulerGroupName", ParameterValue: "techlong-sandbox-cell" },
        { ParameterKey: "CleanupAt", ParameterValue: "2026-10-02T15:00:00" },
      ], tags: [{ Key: "Environment", Value: "aws-sandbox" }, { Key: "ManagedBy", Value: "techlong-cell-operator" },
        { Key: "CellId", Value: "cell-sandbox-1" }, { Key: "ExpiresAt", Value: "2026-10-02T15:00:00.000Z" }] } };
}

async function material(kind: "GRANT" | "REVOKE" = "GRANT", bound?: { phase: SharedCellAuthorCompensationPhase; state: SharedCellAuthorCompensationCellSafetyState }) {
  const candidate = bound ? await boundCandidate() : undefined;
  const core = candidate && bound ? await compileSharedCellAuthorCompensationControllerContract(candidate, bound.phase) : undefined;
  const digests = { operationSha256: core?.operationSha256 ?? op, compensationPlanSha256: core?.compensationPlanSha256 ?? base,
    phasePlanSha256: core?.phasePlanSha256 ?? phase, controllerContractSha256: core?.controllerContractSha256 ?? controller };
  const phaseName = bound?.phase ?? "DELETE_CHANGE_SET";
  const grantShape = phaseName === "DELETE_CHANGE_SET" ? "AuthorCompensationDeleteChangeSetGrant" : "AuthorCompensationDeleteStackGrant";
  const locked = await renderB5CellLifecycleManagementTemplate();
  const grant = await renderB5CellLifecycleManagementTemplate({ shape: grantShape, approvedChangeSetName: cellChangeSet, approvedTemplateSha256: cellRaw, approvedTemplateCanonicalSha256: candidate?.immutableTemplate.canonicalSha256 ?? "2".repeat(64), approvedCellExpiresAt: "2026-10-02T15:00:00.000Z", grantReviewedAt: "2026-10-02T12:00:00.000Z", grantExpiresAt: "2026-10-02T13:00:00.000Z", approvedStackId: cellStackId, approvedChangeSetArn: cellChangeSetArn, approvedCompensationPlanSha256: digests.compensationPlanSha256, compensationReviewedAt: "2026-10-02T12:00:00.000Z", compensationExpiresAt: "2026-10-02T13:00:00.000Z" });
  const target = kind === "GRANT" ? grant : locked;
  const predecessor = kind === "GRANT" ? locked : grant;
  const parsed = JSON.parse(target);
  const operatorTrust = structuredClone(parsed.Resources.CellOperatorRole.Properties.AssumeRolePolicyDocument);
  operatorTrust.Statement[0].Principal.AWS = sourceArn;
  const contract = await compileSharedCellAuthorCompensationLifecycleContract({ schemaVersion: 1, ...digests, phase: phaseName, windowNumber: 1, reviewedAt: "2026-10-02T12:00:00.000Z", expiresAt: "2026-10-02T13:00:00.000Z", rendererShape: kind === "GRANT" ? grantShape : "Locked", templateRawSha256: await sha256Hex(target), templateCanonicalSha256: await sha256Hex(canonicalJson(parsed)), operatorBoundaryDocumentSha256: await sha256Hex(canonicalJson(parsed.Resources.CellOperatorBoundary.Properties.PolicyDocument)), executionBoundaryDocumentSha256: await sha256Hex(canonicalJson(parsed.Resources.CellCloudFormationExecutionBoundary.Properties.PolicyDocument)), operatorTrustPolicySha256: await sha256Hex(canonicalJson(operatorTrust)), executionTrustPolicySha256: await sha256Hex(canonicalJson(parsed.Resources.CellCloudFormationExecutionRole.Properties.AssumeRolePolicyDocument)), ...(candidate && bound ? { cellSafety: { candidate, expectedState: bound.state } } : {}) });
  const grantReceipt = { schemaVersion: 1 as const, action: "shared_cell_author_compensation_phase_grant_verified" as const, disposition: "PHASE_EXECUTION_ALLOWED" as const, ...digests, phase: phaseName, grantEvidenceSha256: "5".repeat(64), observedAt: "2026-10-02T12:01:00.000Z" };
  const request = kind === "GRANT" ? await compileSharedCellAuthorCompensationGrantActionRequest(contract) : await compileSharedCellAuthorCompensationRevokeActionRequest({ contract, reason: "WINDOW_EXPIRED", grantReceipt });
  const changeSetArn = `arn:aws:cloudformation:${region}:${accountId}:changeSet/${request.managementChangeSetName}/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee`;
  const input = { request, contract, changeSetArn, predecessorTemplateBody: predecessor, targetTemplateBody: target };
  const prepared = await compilePreparedSharedCellAuthorCompensationManagementAction(input);
  return { prepared, predecessor, target, input, grantReceipt };
}

function fixture(materialValue: Awaited<ReturnType<typeof material>>, currentBody = materialValue.predecessor, mutate?: (name: string, input: Record<string, unknown>, response: Record<string, unknown>) => void) {
  const body = JSON.parse(currentBody);
  const binding = materialValue.prepared.contract.cellSafety;
  const calls: Array<{ name: string; input: Record<string, unknown>; signal: AbortSignal }> = [];
  let ticks = 0;
  const response = (name: string, input: Record<string, unknown>): Record<string, unknown> => {
    const resourceIndex = names.findIndex((name) => input.PolicyArn === policyArn(name) || input.RoleName === name);
    const properties = resourceIndex >= 0 ? body.Resources[ids[resourceIndex]].Properties : {};
    switch (name) {
      case "getCallerIdentity": return { Account: accountId, Arn: sourceArn, UserId: "AIDATESTUSER" };
      case "describeStacks":
        if (input.StackName === cellName) {
          if (binding && binding.expectedState !== "MISSING") return { Stacks: [{ StackName: cellName, StackId: cellStackId, StackStatus: "REVIEW_IN_PROGRESS", RoleARN: SHARED_CELL_AUTHOR_COMPENSATION_ROLE_ARN, EnableTerminationProtection: false, Tags: binding.candidate.changeSet.tags }] };
          throw Object.assign(new Error(`Stack with id ${cellName} does not exist`), { name: "ValidationError", $metadata: { httpStatusCode: 400 } });
        }
        return { Stacks: [{ StackId: stackId, StackName: stackName, StackStatus: "UPDATE_COMPLETE", EnableTerminationProtection: false, Parameters: [{ ParameterKey: "ExpectedAccountId", ParameterValue: accountId }, { ParameterKey: "ExpectedRegion", ParameterValue: region }, { ParameterKey: "ManagementPrincipalArn", ParameterValue: sourceArn }], Outputs: [{ OutputKey: "SafetyState", OutputValue: body.Outputs.SafetyState.Value }] }] };
      case "getTemplate":
        if (input.ChangeSetName === cellChangeSetArn) return { TemplateBody: JSON.stringify(cellTemplate), StagesAvailable: ["Original"] };
        if (input.StackName === cellName || input.StackName === cellStackId) throw Object.assign(new Error(`Stack with id ${input.StackName} does not exist`), { name: "ValidationError", $metadata: { httpStatusCode: 400 } });
        return { TemplateBody: input.ChangeSetName ? materialValue.target : currentBody };
      case "listStackResources":
        if (input.StackName === cellStackId) return { StackResourceSummaries: [] };
        if (input.StackName === cellName) throw Object.assign(new Error(`Stack with id ${cellName} does not exist`), { name: "ValidationError", $metadata: { httpStatusCode: 400 } });
        return { StackResourceSummaries: ids.map((id, index) => ({ LogicalResourceId: id, ResourceType: index % 2 ? "AWS::IAM::Role" : "AWS::IAM::ManagedPolicy", PhysicalResourceId: index % 2 ? names[index] : policyArn(names[index]), ResourceStatus: "UPDATE_COMPLETE" })) };
      case "getItem": return {};
      case "getPolicy": return { Policy: { PolicyName: names[resourceIndex], Arn: input.PolicyArn, Path: "/", DefaultVersionId: "v1", IsAttachable: true, Description: properties.Description, AttachmentCount: resourceIndex === 0 ? 1 : 0, PermissionsBoundaryUsageCount: 1 } };
      case "listPolicyVersions": return { IsTruncated: false, Versions: [{ VersionId: "v1", IsDefaultVersion: true }] };
      case "getPolicyVersion": return { PolicyVersion: { VersionId: "v1", IsDefaultVersion: true, Document: encodeURIComponent(JSON.stringify(properties.PolicyDocument)) } };
      case "listEntitiesForPolicy": return { IsTruncated: false, PolicyGroups: [], PolicyUsers: [], PolicyRoles: input.PolicyUsageFilter === "PermissionsBoundary" || resourceIndex === 0 ? [{ RoleName: names[resourceIndex + 1], RoleId: `AROA${resourceIndex}` }] : [] };
      case "getRole": {
        const trust = structuredClone(properties.AssumeRolePolicyDocument);
        if (resourceIndex === 1) trust.Statement[0].Principal.AWS = sourceArn;
        return { Role: { RoleName: names[resourceIndex], Arn: roleArn(names[resourceIndex]), Path: "/", Description: properties.Description, MaxSessionDuration: properties.MaxSessionDuration, PermissionsBoundary: { PermissionsBoundaryArn: policyArn(names[resourceIndex - 1]), PermissionsBoundaryType: "Policy" }, AssumeRolePolicyDocument: JSON.stringify(trust), Tags: properties.Tags } };
      }
      case "listAttachedRolePolicies": return { IsTruncated: false, AttachedPolicies: resourceIndex === 1 ? [{ PolicyArn: policyArn(names[0]), PolicyName: names[0] }] : [] };
      case "listRolePolicies": return { IsTruncated: false, PolicyNames: [] };
      case "describeChangeSet":
        if (input.ChangeSetName === cellChangeSetArn) {
          if (!binding || binding.expectedState !== "REVIEW_CHANGE_SET_PRESENT") throw Object.assign(new Error(`ChangeSet [${cellChangeSetArn}] does not exist`), { name: "ChangeSetNotFoundException", $metadata: { httpStatusCode: 404 } });
          return { ChangeSetId: cellChangeSetArn, ChangeSetName: cellChangeSet, StackId: cellStackId, StackName: cellName, Status: "CREATE_COMPLETE", ExecutionStatus: "AVAILABLE", Capabilities: [], IncludeNestedStacks: false, ImportExistingResources: false, OnStackFailure: "DELETE", Parameters: binding.candidate.changeSet.parameters, Tags: binding.candidate.changeSet.tags,
            Changes: Object.entries(cellTemplate.Resources).map(([LogicalResourceId, resource]) => ({ Type: "Resource", ResourceChange: { Action: "Add", LogicalResourceId, ResourceType: resource.Type } })) };
        }
        return { $metadata: { requestId: String(calls.length) }, ChangeSetId: materialValue.prepared.changeSetArn, ChangeSetName: materialValue.prepared.request.managementChangeSetName, StackId: stackId, StackName: stackName, Status: "CREATE_COMPLETE", ExecutionStatus: "AVAILABLE", IncludeNestedStacks: false, ImportExistingResources: false, Capabilities: ["CAPABILITY_NAMED_IAM"], Changes: [{ Type: "Resource", ResourceChange: { LogicalResourceId: ids[0], ResourceType: "AWS::IAM::ManagedPolicy", PhysicalResourceId: policyArn(names[0]), Action: "Modify", Replacement: "False", Scope: ["Properties"] } }] };
      default: throw new Error(`Unexpected command ${name}`);
    }
  };
  const commandNames = ["getCallerIdentity", "describeStacks", "getTemplate", "listStackResources", "getPolicy", "getPolicyVersion", "listPolicyVersions", "listEntitiesForPolicy", "getRole", "listAttachedRolePolicies", "listRolePolicies", "getItem", "describeChangeSet"];
  const commands = Object.fromEntries(commandNames.map((name) => [name, class { name = name; input: Record<string, unknown>; constructor(input: Record<string, unknown>) { this.input = input; } }])) as SharedCellAuthorCompensationManagementReadDependencies["commands"];
  const client = { async send(command: unknown, options: { abortSignal: AbortSignal }) {
    const { name, input } = command as { name: string; input: Record<string, unknown> };
    calls.push({ name, input, signal: options.abortSignal });
    const value = structuredClone(response(name, input));
    mutate?.(name, input, value);
    return value;
  } };
  const dependencies = { clients: { sts: { ...client }, cloudFormation: { ...client }, iam: { ...client }, dynamoDb: { ...client } }, commands, now: () => now + ticks++ };
  return { reads: new AwsSdkSharedCellAuthorCompensationManagementReadAdapter(dependencies), calls, dependencies };
}

function mutation(fixtureValue: ReturnType<typeof fixture>, materialValue: Awaited<ReturnType<typeof material>>, fail = false) {
  const writes: Array<Record<string, unknown>> = [];
  class Execute { input: Record<string, unknown>; constructor(input: Record<string, unknown>) { this.input = input; } }
  const port = createPreparedSharedCellAuthorCompensationManagementMutation({ prepared: materialValue.prepared, approvedPreparedActionSha256: materialValue.prepared.preparedActionSha256, reads: fixtureValue.reads, sdk: { executeChangeSet: Execute, client: { async send(command) { writes.push((command as Execute).input); if (fail) throw new Error("https://secret-user:secret-password@hidden.example"); return {}; } } } });
  return { port, writes };
}

test("dedicated ARN probe reader proves exact candidate IAM without accepting it as a production lifecycle shape", async () => {
  const data = await material();
  const fixturePlan = await compileArnProbeFixturePlan({ nonce: "a".repeat(32), reviewedAt: "2026-10-02T11:00:00.000Z", expiresAt: "2026-10-02T12:00:00.000Z" });
  const plan = await compileArnProbeGrantPlan({ fixturePlan, fixtureStackId: `arn:aws:cloudformation:${region}:${accountId}:stack/${ARN_PROBE_FIXTURE_STACK}/11111111-2222-4333-8444-555555555555`,
    fixtureChangeSetArn: `arn:aws:cloudformation:${region}:${accountId}:changeSet/${fixturePlan.request.ChangeSetName}/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee`,
    nonce: "b".repeat(32), reviewedAt: "2026-10-02T12:00:00.000Z", expiresAt: "2026-10-02T13:00:00.000Z" });
  const grant = fixture(data, plan.request.TemplateBody);
  const result = await grant.reads.readArnProbeManagementObservation({ plan, signal: abort() });
  assert.equal(result.rendererShape, "ArnProbeDeleteChangeSetGrant"); assert.equal(result.policies.length, 2); assert.equal(result.roles.length, 2);
  assert.equal(result.stack.templateRawSha256, plan.grantTemplateRawSha256); assert.equal(result.cellStackState, "MISSING"); assert.equal(result.authorityState, "ABSENT");
  await assert.rejects(grant.reads.readLockedPreflightObservation({ signal: abort() }));
  const rollback = fixture(data, plan.revokeTarget.templateBody, (name, input, response) => {
    if (name === "describeStacks" && input.StackName === stackId) (response.Stacks as Array<Record<string, unknown>>)[0].StackStatus = "UPDATE_ROLLBACK_COMPLETE";
  });
  assert.equal((await rollback.reads.readArnProbeManagementObservation({ plan, signal: abort() })).rendererShape, "Locked");
  await assert.rejects(rollback.reads.readLockedPreflightObservation({ signal: abort() }));
  const drift = fixture(data, plan.request.TemplateBody, (name, input, response) => {
    if (name === "getPolicyVersion" && input.PolicyArn === policyArn(names[0])) (response.PolicyVersion as Record<string, unknown>).Document = JSON.stringify({ Version: "2012-10-17", Statement: [{ Effect: "Allow", Action: "*", Resource: "*" }] });
  });
  await assert.rejects(drift.reads.readArnProbeManagementObservation({ plan, signal: abort() }));
});

test("management read collects real IAM evidence and brackets exact absence with strong authority reads", async () => {
  const data = await material();
  const fake = fixture(data, data.target);
  assert.equal(fake.calls.length, 0);
  const producer = new SharedCellAuthorCompensationLifecycleReceiptProducer(fake.reads);
  const evidence = await producer.reviewTarget({ contract: data.prepared.contract, signal: abort() });
  const receipt = await producer.createPhaseGrantReceipt({ contract: data.prepared.contract, evidence });
  assert.equal(receipt.disposition, "PHASE_EXECUTION_ALLOWED");
  const authorityCalls = fake.calls.filter((call) => call.name === "getItem");
  assert.equal(authorityCalls.length, 4);
  for (const call of authorityCalls) assert.deepEqual(call.input, { TableName: "techlong-sandbox-tenant-external-epoch-authority", Key: { authority_key: { S: "cell:cell-sandbox-1" } }, ConsistentRead: true });
  assert.ok(fake.calls.every((call) => call.signal instanceof AbortSignal));
});

test("bound Cell lifecycle contracts reproduce all plan digests and remain deeply immutable", async () => {
  const data = await material("GRANT", { phase: "DELETE_CHANGE_SET", state: "REVIEW_CHANGE_SET_PRESENT" });
  const { lifecycleContractSha256: _digest, ...body } = data.prepared.contract;
  assert.match(_digest, /^[a-f0-9]{64}$/);
  assert.ok(body.cellSafety);
  assert.ok(Object.isFrozen(body.cellSafety.candidate.changeSet.tags));
  for (const key of ["operationSha256", "compensationPlanSha256", "phasePlanSha256", "controllerContractSha256"] as const) {
    await assert.rejects(compileSharedCellAuthorCompensationLifecycleContract({ ...body, [key]: "f".repeat(64) }), /does not reproduce/);
  }
  await assert.rejects(compileSharedCellAuthorCompensationLifecycleContract({ ...body, cellSafety: undefined }));
  const changed = structuredClone(body);
  changed.cellSafety!.candidate.compensationGrant.expiresAt = "2026-10-02T12:59:00.000Z";
  await assert.rejects(compileSharedCellAuthorCompensationLifecycleContract(changed), /does not reproduce/);
  await assert.rejects(material("GRANT", { phase: "DELETE_CHANGE_SET", state: "REVIEW_CHANGE_SET_MISSING" }), /not valid/);
  await assert.rejects(material("GRANT", { phase: "DELETE_STACK", state: "REVIEW_CHANGE_SET_PRESENT" }), /not valid/);
  await assert.rejects(material("GRANT", { phase: "DELETE_STACK", state: "MISSING" }), /not valid/);
});

test("Source double-read certifies zero-resource placeholders for both split grants without pretending to be Operator", async () => {
  for (const phase of ["DELETE_CHANGE_SET", "DELETE_STACK"] as const) {
    const data = await material("GRANT", { phase, state: phase === "DELETE_CHANGE_SET" ? "REVIEW_CHANGE_SET_PRESENT" : "REVIEW_CHANGE_SET_MISSING" });
    const fake = fixture(data, data.target);
    const producer = new SharedCellAuthorCompensationLifecycleReceiptProducer(fake.reads);
    const evidence = await producer.reviewTarget({ contract: data.prepared.contract, signal: abort() });
    const receipt = await producer.createPhaseGrantReceipt({ contract: data.prepared.contract, evidence });
    assert.equal(receipt.disposition, "PHASE_EXECUTION_ALLOWED");
    assert.equal(receipt.operationSha256, data.prepared.contract.operationSha256);
    assert.equal(fake.calls.filter((call) => call.name === "getCallerIdentity").length, 2);
    assert.ok(fake.calls.filter((call) => call.name === "describeStacks" && call.input.StackName === cellName).length === 4);
    assert.equal(fake.calls.filter((call) => call.name === "getTemplate" && call.input.StackName === cellStackId && !call.input.ChangeSetName).length, 4);
    assert.equal(fake.calls.filter((call) => call.name === "getItem").length, 12);
    for (const call of fake.calls.filter((call) => call.name === "describeChangeSet")) assert.equal(call.input.ChangeSetName, cellChangeSetArn);
    const review = await reviewSharedCellAuthorCompensationManagementAction(data.input);
    assert.equal(review.blockers.includes("COMPENSATION_CELL_SAFETY_BINDING_REQUIRED"), false);
    assert.equal(review.onlineExecutionReady, false);
    // Calling the same provider without the explicit binding keeps the legacy fence.
    await assert.rejects(fake.reads.readManagementObservation({ signal: abort() }), /Cell must be MISSING/);
  }
});

test("placeholder safety rejects resources, pagination, identities, active/deleting states, authority and template drift", async () => {
  const data = await material("GRANT", { phase: "DELETE_CHANGE_SET", state: "REVIEW_CHANGE_SET_PRESENT" });
  const drifts: Array<(name: string, input: Record<string, unknown>, response: Record<string, unknown>) => void> = [
    (name, input, response) => { if (name === "describeStacks" && input.StackName === cellName) (response.Stacks as Array<Record<string, unknown>>)[0].StackId = cellStackId.replace("123456789012", "123456789013"); },
    (name, input, response) => { if (name === "describeStacks" && input.StackName === cellName) (response.Stacks as Array<Record<string, unknown>>)[0].StackStatus = "CREATE_COMPLETE"; },
    (name, input, response) => { if (name === "describeStacks" && input.StackName === cellName) (response.Stacks as Array<Record<string, unknown>>)[0].StackStatus = "DELETE_IN_PROGRESS"; },
    (name, input, response) => { if (name === "describeStacks" && input.StackName === cellName) (response.Stacks as Array<Record<string, unknown>>)[0].RoleARN = sourceArn; },
    (name, input, response) => { if (name === "describeStacks" && input.StackName === cellName) (response.Stacks as Array<Record<string, unknown>>)[0].ParentId = stackId; },
    (name, input, response) => { if (name === "listStackResources" && input.StackName === cellStackId) response.StackResourceSummaries = [{ LogicalResourceId: "PaidCell", PhysicalResourceId: "vpc-123", ResourceType: "AWS::EC2::VPC", ResourceStatus: "CREATE_COMPLETE" }]; },
    (name, input, response) => { if (name === "listStackResources" && input.StackName === cellStackId) response.NextToken = "another-page"; },
    (name, _input, response) => { if (name === "getItem") response.Item = {}; },
    (name, input, response) => { if (name === "getTemplate" && input.ChangeSetName === cellChangeSetArn) response.TemplateBody = JSON.stringify({ Resources: {} }); },
    (name, input, response) => { if (name === "describeChangeSet" && input.ChangeSetName === cellChangeSetArn) response.ExecutionStatus = "EXECUTE_IN_PROGRESS"; },
  ];
  for (const drift of drifts) {
    const fake = fixture(data, data.target, drift);
    await assert.rejects(new SharedCellAuthorCompensationLifecycleReceiptProducer(fake.reads).reviewTarget({ contract: data.prepared.contract, signal: abort() }));
  }
  const withTemplate = fixture(data, data.target);
  const original = withTemplate.dependencies.clients.cloudFormation.send;
  withTemplate.dependencies.clients.cloudFormation.send = async (command, options) => {
    const typed = command as { name: string; input: Record<string, unknown> };
    if (typed.name === "getTemplate" && typed.input.StackName === cellStackId && !typed.input.ChangeSetName) return { TemplateBody: JSON.stringify(cellTemplate) };
    return original(command, options);
  };
  await assert.rejects(withTemplate.reads.readManagementObservation({ cellSafety: data.prepared.contract.cellSafety, signal: abort() }), /Original template/);
});

test("DeleteStack grant requires exact Change Set absence and grants cannot use partial MISSING evidence", async () => {
  const data = await material("GRANT", { phase: "DELETE_STACK", state: "REVIEW_CHANGE_SET_MISSING" });
  const wrongMissing = fixture(data, data.target);
  const send = wrongMissing.dependencies.clients.cloudFormation.send;
  wrongMissing.dependencies.clients.cloudFormation.send = async (command, options) => {
    const typed = command as { name: string; input: Record<string, unknown> };
    if (typed.name === "describeChangeSet" && typed.input.ChangeSetName === cellChangeSetArn) throw Object.assign(new Error("ChangeSet [other] does not exist https://secret.example"), { name: "ChangeSetNotFoundException", $metadata: { httpStatusCode: 404 } });
    return send(command, options);
  };
  await assert.rejects(wrongMissing.reads.readManagementObservation({ cellSafety: data.prepared.contract.cellSafety, signal: abort() }), (error: Error) => {
    assert.doesNotMatch(error.message, /secret\.example/); return true;
  });
  const missing = await material("REVOKE", { phase: "DELETE_STACK", state: "MISSING" });
  const partial = fixture(missing, missing.target);
  const partialSend = partial.dependencies.clients.cloudFormation.send;
  partial.dependencies.clients.cloudFormation.send = async (command, options) => {
    const typed = command as { name: string; input: Record<string, unknown> };
    if (typed.name === "listStackResources" && typed.input.StackName === cellName) return { StackResourceSummaries: [] };
    return partialSend(command, options);
  };
  await assert.rejects(partial.reads.readManagementObservation({ cellSafety: missing.prepared.contract.cellSafety, signal: abort() }), /did not agree/);
  const invalidHttp = fixture(missing, missing.target);
  const httpSend = invalidHttp.dependencies.clients.cloudFormation.send;
  invalidHttp.dependencies.clients.cloudFormation.send = async (command, options) => {
    try { return await httpSend(command, options); }
    catch (error) {
      const provider = error as { name: string; $metadata: { httpStatusCode: number } };
      if (provider.name === "ValidationError") provider.$metadata.httpStatusCode = 403;
      throw error;
    }
  };
  await assert.rejects(invalidHttp.reads.readManagementObservation({ cellSafety: missing.prepared.contract.cellSafety, signal: abort() }), /provider errors never prove absence/);
});

test("Locked receipts bind the actual post-phase Cell state rather than equating revocation with deletion", async () => {
  for (const phase of ["DELETE_CHANGE_SET", "DELETE_STACK"] as const) {
    const state = phase === "DELETE_CHANGE_SET" ? "REVIEW_CHANGE_SET_MISSING" : "MISSING";
    const data = await material("REVOKE", { phase, state });
    const producer = new SharedCellAuthorCompensationLifecycleReceiptProducer(fixture(data, data.target).reads);
    const evidence = await producer.reviewTarget({ contract: data.prepared.contract, signal: abort() });
    const contract = data.prepared.contract;
    const completion = { schemaVersion: 1 as const, action: "shared_cell_author_compensation_phase_completed" as const,
      operationSha256: contract.operationSha256, phase, compensationPlanSha256: contract.compensationPlanSha256,
      phasePlanSha256: contract.phasePlanSha256, controllerContractSha256: contract.controllerContractSha256,
      observedState: phase === "DELETE_CHANGE_SET" ? "REVIEW_IN_PROGRESS" as const : "MISSING" as const,
      mutationPerformed: true, evidenceSha256: "8".repeat(64), observedAt: "2026-10-02T12:01:30.000Z" };
    const receipt = await producer.createPhaseCompletedLockedReceipt({ contract, evidence, completionReceipt: completion });
    assert.equal(receipt.lockedEvidenceSha256, evidence.evidenceSha256);
    await compileSharedCellAuthorCompensationRevokeActionRequest({ contract, reason: "PHASE_COMPLETED", grantReceipt: data.grantReceipt, completionReceipt: completion });
    if (phase === "DELETE_CHANGE_SET") {
      const wrong = { ...completion, observedState: "MISSING" as const };
      await assert.rejects(producer.createPhaseCompletedLockedReceipt({ contract, evidence, completionReceipt: wrong }), /agree with/);
      await assert.rejects(compileSharedCellAuthorCompensationRevokeActionRequest({ contract, reason: "PHASE_COMPLETED", grantReceipt: data.grantReceipt, completionReceipt: wrong }), /persisted completion state/);
    }
    const forged = structuredClone(contract);
    forged.cellSafety!.candidate.stackId = stackId;
    await assert.rejects(producer.createPhaseCompletedLockedReceipt({ contract: forged, evidence, completionReceipt: completion }), /not produced by this verifier/);
  }
});

test("bound late Grant and expired Locked reconciliation preserve revoke-only windows on placeholders", async () => {
  const grant = await material("GRANT", { phase: "DELETE_CHANGE_SET", state: "REVIEW_CHANGE_SET_PRESENT" });
  const locked = await material("REVOKE", { phase: "DELETE_CHANGE_SET", state: "REVIEW_CHANGE_SET_PRESENT" });
  let tick = 0;
  const late = Date.parse("2026-10-02T12:51:00.000Z");
  const grantFixture = fixture(grant, grant.target);
  const grantProducer = new SharedCellAuthorCompensationLifecycleReceiptProducer(new AwsSdkSharedCellAuthorCompensationManagementReadAdapter({ ...grantFixture.dependencies, now: () => late + tick++ }));
  const evidence = await grantProducer.reviewTarget({ contract: grant.prepared.contract, signal: abort() });
  const receipt = await grantProducer.createPhaseGrantReceipt({ contract: grant.prepared.contract, evidence });
  assert.equal(receipt.disposition, "REVOKE_ONLY");
  const lockedFixture = fixture(locked, locked.target);
  const lockedProducer = new SharedCellAuthorCompensationLifecycleReceiptProducer(new AwsSdkSharedCellAuthorCompensationManagementReadAdapter({ ...lockedFixture.dependencies, now: () => late + tick++ }));
  const lockedEvidence = await lockedProducer.reviewTarget({ contract: locked.prepared.contract, signal: abort() });
  const expired = await lockedProducer.createWindowExpiredLockedReceipt({ contract: locked.prepared.contract, evidence: lockedEvidence, grantReceipt: receipt });
  assert.equal(expired.lockedEvidenceSha256, lockedEvidence.evidenceSha256);
});

test("bound preflight executes only the reviewed management ARN and any Cell regression delegates zero writes", async () => {
  const data = await material("GRANT", { phase: "DELETE_CHANGE_SET", state: "REVIEW_CHANGE_SET_PRESENT" });
  const safe = fixture(data);
  const one = mutation(safe, data);
  assert.ok("installPhaseGrant" in one.port);
  await one.port.installPhaseGrant({ request: data.prepared.request as Parameters<SharedCellAuthorCompensationPhaseGrantMutationPort["installPhaseGrant"]>[0]["request"], signal: abort() });
  assert.equal(one.writes.length, 1);
  assert.equal(one.writes[0].ChangeSetName, data.prepared.changeSetArn);
  let cycles = 0;
  const drifted = fixture(data, data.predecessor, (name, input, response) => {
    if (name === "describeStacks" && input.StackName === cellName && ++cycles === 2) (response.Stacks as Array<Record<string, unknown>>)[0].StackStatus = "DELETE_IN_PROGRESS";
  });
  const zero = mutation(drifted, data);
  assert.ok("installPhaseGrant" in zero.port);
  await assert.rejects(zero.port.installPhaseGrant({ request: data.prepared.request as Parameters<SharedCellAuthorCompensationPhaseGrantMutationPort["installPhaseGrant"]>[0]["request"], signal: abort() }));
  assert.equal(zero.writes.length, 0);
});

test("management read rejects IAM truncation, unsafe trust, foreign resources and authority presence", async () => {
  const data = await material();
  const drifts: Array<[string, (response: Record<string, unknown>) => void]> = [
    ["listPolicyVersions", (response) => { response.IsTruncated = true; }],
    ["listRolePolicies", (response) => { response.IsTruncated = undefined; }],
    ["getRole", (response) => { (response.Role as Record<string, unknown>).AssumeRolePolicyDocument = { Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: "*", Action: "sts:AssumeRole" }] }; }],
    ["listStackResources", (response) => { (response.StackResourceSummaries as unknown[]).push({ LogicalResourceId: "PaidCell", ResourceType: "AWS::EC2::VPC" }); }],
    ["getItem", (response) => { response.Item = {}; }],
  ];
  for (const [name, mutate] of drifts) {
    const fake = fixture(data, data.target, (command, _input, response) => { if (command === name) mutate(response); });
    await assert.rejects(fake.reads.readManagementObservation({ signal: abort() }), SharedCellAuthorCompensationManagementAdapterError);
  }
});

test("initial Locked preflight supports CREATE_COMPLETE without forging a lifecycle receipt", async () => {
  const data = await material();
  const fake = fixture(data, data.predecessor, (name, _input, response) => {
    if (name === "describeStacks") (response.Stacks as Record<string, unknown>[])[0].StackStatus = "CREATE_COMPLETE";
  });
  const observed = await fake.reads.readLockedPreflightObservation({ signal: abort() });
  assert.equal(observed.rendererShape, "Locked");
  assert.equal(observed.stack.status, "CREATE_COMPLETE");
  await assert.rejects(fake.reads.readManagementObservation({ signal: abort() }));
  const altered = JSON.parse(data.predecessor);
  altered.Metadata.SafetyBoundary.ExtraUnreviewed = true;
  const drift = fixture(data, JSON.stringify(altered));
  await assert.rejects(drift.reads.readLockedPreflightObservation({ signal: abort() }), /exact deployed Locked/);
});

test("only exact name-bound Cell absence is accepted and provider secrets are redacted", async () => {
  const data = await material();
  const fake = fixture(data);
  fake.dependencies.clients.cloudFormation.send = async () => { throw Object.assign(new Error("Stack with id other-cell does not exist https://secret.example"), { name: "ValidationError", $metadata: { httpStatusCode: 400 } }); };
  await assert.rejects(fake.reads.readManagementObservation({ signal: abort() }), (error) => {
    assert.ok(error instanceof SharedCellAuthorCompensationManagementAdapterError);
    assert.equal(error.code, "SHARED_CELL_AUTHOR_COMPENSATION_MANAGEMENT_CELL_NOT_PROVEN_MISSING");
    assert.doesNotMatch(error.message, /secret\.example/);
    return true;
  });
  const canceled = new AbortController(); canceled.abort();
  const untouched = fixture(data);
  await assert.rejects(untouched.reads.readManagementObservation({ signal: canceled.signal }));
  assert.equal(untouched.calls.length, 0);
});

test("local prepared review binds template hashes and rejects execution-role changes", async () => {
  const data = await material();
  const review = await reviewSharedCellAuthorCompensationManagementAction(data.input);
  assert.equal(review.onlineExecutionReady, false);
  assert.ok(review.blockers.includes("COMPENSATION_CELL_SAFETY_BINDING_REQUIRED"));
  assert.equal(review.prepared.preparedActionSha256, data.prepared.preparedActionSha256);
  await assert.rejects(compilePreparedSharedCellAuthorCompensationManagementAction({ ...data.input, changeSetArn: cellChangeSetArn }));
  const modified = JSON.parse(data.target);
  modified.Resources.CellCloudFormationExecutionRole.Properties.MaxSessionDuration = 7200;
  const changedTarget = JSON.stringify(modified);
  const changedContract = await compileSharedCellAuthorCompensationLifecycleContract({ ...Object.fromEntries(Object.entries(data.prepared.contract).filter(([key]) => key !== "lifecycleContractSha256")), templateRawSha256: await sha256Hex(changedTarget), templateCanonicalSha256: await sha256Hex(canonicalJson(modified)) } as Parameters<typeof compileSharedCellAuthorCompensationLifecycleContract>[0]);
  const changedRequest = await compileSharedCellAuthorCompensationGrantActionRequest(changedContract);
  await assert.rejects(compilePreparedSharedCellAuthorCompensationManagementAction({ ...data.input, request: changedRequest, contract: changedContract, changeSetArn: `arn:aws:cloudformation:${region}:${accountId}:changeSet/${changedRequest.managementChangeSetName}/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee`, targetTemplateBody: changedTarget }), /outside the operator policy/);
});

test("management mutation sends one exact ExecuteChangeSet and concurrent reuse cannot submit twice", async () => {
  const data = await material();
  const fake = fixture(data);
  const { port, writes } = mutation(fake, data);
  assert.ok("installPhaseGrant" in port);
  assert.equal("revokePhaseGrant" in port, false);
  const request = data.prepared.request as Parameters<SharedCellAuthorCompensationPhaseGrantMutationPort["installPhaseGrant"]>[0]["request"];
  const results = await Promise.allSettled([port.installPhaseGrant({ request, signal: abort() }), port.installPhaseGrant({ request, signal: abort() })]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(writes.length, 1);
  assert.deepEqual(Object.keys(writes[0]).sort(), ["StackName", "ChangeSetName", "ClientRequestToken", "DisableRollback"].sort());
  assert.equal(writes[0].StackName, stackId);
  assert.equal(writes[0].ChangeSetName, data.prepared.changeSetArn);
  assert.equal(writes[0].DisableRollback, false);
  assert.match(String(writes[0].ClientRequestToken), /^j5gj4-[a-f0-9]{64}$/);
  const preflights = fake.calls.filter((call) => call.name === "describeChangeSet");
  assert.equal(preflights.length, 2);
});

test("unsafe Change Sets and lost ExecuteChangeSet responses never cause a second submission", async () => {
  const data = await material();
  const unsafe = fixture(data, data.predecessor, (name, _input, response) => { if (name === "describeChangeSet") (response.Changes as Array<{ ResourceChange: Record<string, unknown> }>)[0].ResourceChange.Replacement = "True"; });
  const first = mutation(unsafe, data);
  assert.ok("installPhaseGrant" in first.port);
  const request = data.prepared.request as Parameters<SharedCellAuthorCompensationPhaseGrantMutationPort["installPhaseGrant"]>[0]["request"];
  await assert.rejects(first.port.installPhaseGrant({ request, signal: abort() }));
  assert.equal(first.writes.length, 0);
  const lost = mutation(fixture(data), data, true);
  assert.ok("installPhaseGrant" in lost.port);
  await assert.rejects(lost.port.installPhaseGrant({ request, signal: abort() }), (error) => {
    assert.ok(error instanceof SharedCellAuthorCompensationManagementAdapterError);
    assert.equal(error.code, "SHARED_CELL_AUTHOR_COMPENSATION_MANAGEMENT_SUBMIT_UNCERTAIN");
    assert.doesNotMatch(error.message, /secret-user|password|hidden\.example/);
    return true;
  });
  await assert.rejects(lost.port.installPhaseGrant({ request, signal: abort() }));
  assert.equal(lost.writes.length, 1);
});

test("initial CREATE_COMPLETE Locked predecessor can execute but cannot certify a lifecycle receipt", async () => {
  const data = await material();
  const fake = fixture(data, data.predecessor, (name, _input, response) => {
    if (name === "describeStacks") (response.Stacks as Array<Record<string, unknown>>)[0].StackStatus = "CREATE_COMPLETE";
  });
  const { port, writes } = mutation(fake, data);
  assert.ok("installPhaseGrant" in port);
  await port.installPhaseGrant({ request: data.prepared.request as Parameters<SharedCellAuthorCompensationPhaseGrantMutationPort["installPhaseGrant"]>[0]["request"], signal: abort() });
  assert.equal(writes.length, 1);
  await assert.rejects(fake.reads.readManagementObservation({ signal: abort() }), /completed state drifted/);
  const unsafe = fixture(data, data.target, (name, _input, response) => {
    if (name === "describeStacks") (response.Stacks as Array<Record<string, unknown>>)[0].StackStatus = "CREATE_COMPLETE";
  });
  await assert.rejects(unsafe.reads.inspectPreparedChangeSet(data.prepared, abort()), /Only a Locked predecessor/);
});

test("revoke capability remains isolated and recovery entry never constructs a mutation capability", async () => {
  const data = await material("REVOKE");
  const fake = fixture(data);
  const { port, writes } = mutation(fake, data);
  assert.ok("revokePhaseGrant" in port);
  assert.equal("installPhaseGrant" in port, false);
  await port.revokePhaseGrant({ request: data.prepared.request as Parameters<SharedCellAuthorCompensationPhaseRevokeMutationPort["revokePhaseGrant"]>[0]["request"], signal: abort() });
  assert.equal(writes.length, 1);
  const entry = createSharedCellAuthorCompensationManagementEntry({ reads: fake.reads, createMutation() { throw new Error("Recovery must not ask for a mutation capability"); } });
  const grant = await material();
  let claims = 0;
  const store = {
    async claimExactOperation() { claims++; return null; },
    async beginLifecycleAction() { throw new Error("Recovery must not write an action"); },
    async completeLifecycleAction() { throw new Error("No action was claimed"); },
    async releaseClaim() { return null; },
  } as unknown as SharedCellAuthorCompensationOperationStore;
  await assert.rejects(entry.recoverGrant(grant.prepared, grant.prepared.preparedActionSha256, { store, workerId: "test-manager", leaseDurationMs: 120_000, approvedLifecycleContractSha256: grant.prepared.contract.lifecycleContractSha256, signal: abort() }), /could not be claimed/);
  assert.equal(claims, 1);
});

test("management entry requires action approval and a successful durable write-ahead before any provider mutation", async () => {
  const data = await material();
  const fake = fixture(data);
  const { port, writes } = mutation(fake, data);
  const events: string[] = [];
  const workerId = "test-manager";
  const handle = { operationSha256: op, workerId, stateRevision: 1, claimToken: `scac_${"1".repeat(32)}`, leaseAttempt: 1, leaseExpiresAt: now + 120_000 };
  const store = {
    async claimExactOperation() {
      events.push("claim");
      return { mode: "PREPARE", handle, snapshot: { operation: { operationSha256: op, state: "delete_change_set_prepared", currentPhase: "DELETE_CHANGE_SET", currentWindowNumber: 1, stateRevision: 1, leaseOwner: workerId, claimToken: handle.claimToken, leaseAttempt: 1, leaseExpiresAt: handle.leaseExpiresAt }, currentWindow: { windowNumber: 1, phase: "DELETE_CHANGE_SET", compensationPlanSha256: base, phasePlanSha256: phase, controllerContractSha256: controller, reviewedAt: Date.parse(data.prepared.contract.reviewedAt), expiresAt: Date.parse(data.prepared.contract.expiresAt) }, currentLifecycleAction: null } };
    },
    async beginLifecycleAction() { events.push("write-ahead-rejected"); return null; },
    async completeLifecycleAction() { throw new Error("Completion must not run"); },
    async releaseClaim() { events.push("release"); return null; },
  } as unknown as SharedCellAuthorCompensationOperationStore;
  const entry = createSharedCellAuthorCompensationManagementEntry({ reads: fake.reads, createMutation() { events.push("capability"); return port; } });
  const input = { store, workerId, leaseDurationMs: 120_000, approvedLifecycleContractSha256: data.prepared.contract.lifecycleContractSha256, signal: abort() };
  await assert.rejects(entry.executeGrant(data.prepared, "0".repeat(64), input), /explicitly approved digest/);
  assert.deepEqual(events, []);
  await assert.rejects(entry.executeGrant(data.prepared, data.prepared.preparedActionSha256, input), /no mutation was delegated/);
  assert.deepEqual(events, ["capability", "claim", "write-ahead-rejected", "release"]);
  assert.equal(writes.length, 0);
  assert.equal(fake.calls.length, 0);
});

test("J18 exact comparison IAM channel is separate from J11 Delete and production lifecycle receipts", async () => {
  const fixturePlan = await compileArnProbeFixturePlan({ nonce: "a".repeat(32), reviewedAt: "2026-10-02T11:00:00.000Z", expiresAt: "2026-10-02T12:00:00.000Z" });
  const prior = await compileArnProbeGrantPlan({ fixturePlan, fixtureStackId: `arn:aws:cloudformation:${region}:${accountId}:stack/${ARN_PROBE_FIXTURE_STACK}/11111111-2222-4333-8444-555555555555`,
    fixtureChangeSetArn: `arn:aws:cloudformation:${region}:${accountId}:changeSet/${fixturePlan.request.ChangeSetName}/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee`, nonce: "b".repeat(32), reviewedAt: "2026-10-02T12:00:00.000Z", expiresAt: "2026-10-02T13:00:00.000Z" });
  const comparisonPlan = await compileArnProbeReadComparisonPlan({ priorPlan: prior, reviewedAt: "2026-10-02T14:00:00.000Z", expiresAt: "2026-10-02T14:30:00.000Z" });
  const plan = await compileArnProbeComparisonCreatePlan({ comparisonPlan, variant: "EXACT_NAME_CONDITION" }), data = await material();
  const candidate = fixture(data, plan.request.TemplateBody);
  const result = await candidate.reads.readArnProbeReadComparisonObservation({ plan, signal: abort() });
  assert.equal(result.rendererShape, "ArnProbeReadComparisonGrant"); assert.equal(result.policies.length, 2); assert.equal(result.roles.length, 2);
  await assert.rejects(candidate.reads.readArnProbeManagementObservation({ plan: prior, signal: abort() }));
  await assert.rejects(candidate.reads.readManagementObservation({ signal: abort() }));
  const locked = fixture(data, plan.revokeTarget.templateBody);
  assert.equal((await locked.reads.readArnProbeReadComparisonObservation({ plan, signal: abort() })).rendererShape, "Locked");
  const foreign = fixture(data, prior.request.TemplateBody);
  await assert.rejects(foreign.reads.readArnProbeReadComparisonObservation({ plan, signal: abort() }));
  const drift = fixture(data, plan.request.TemplateBody, (name, _input, response) => { if (name === "getPolicyVersion") {
    const policy = response.PolicyVersion as { Document: string }; const value = JSON.parse(decodeURIComponent(policy.Document)); value.Statement.push({ Effect: "Allow", Action: "*", Resource: "*" }); policy.Document = JSON.stringify(value);
  } });
  await assert.rejects(drift.reads.readArnProbeReadComparisonObservation({ plan, signal: abort() }));
});

test("J22 exact Stack control channel stays separate from all older and production IAM shapes", async () => {
  const f = await stackControlWorkflowFixture(), plan = f.creationReview.plan, data = await material(), candidate = fixture(data, plan.request.TemplateBody);
  const result = await candidate.reads.readArnProbeStackControlObservation({ plan, signal: abort() });
  assert.equal(result.rendererShape, "StackScopedReadControlGrant"); assert.equal(result.roles.length, 2); assert.equal(result.policies.length, 2);
  assert.equal(result.stack.templateRawSha256, plan.templateRawSha256);
  const old = f.predecessor.input.creationReview.plan.input.comparisonPlan.input.priorPlan;
  await assert.rejects(candidate.reads.readArnProbeManagementObservation({ plan: old, signal: abort() }));
  await assert.rejects(candidate.reads.readArnProbeGeneration4Observation({ plan: f.predecessor.input.creationReview.plan, signal: abort() }));
  await assert.rejects(candidate.reads.readManagementObservation({ signal: abort() }));
  const locked = fixture(data, plan.revokeTarget.templateBody);
  assert.equal((await locked.reads.readArnProbeStackControlObservation({ plan, signal: abort() })).rendererShape, "Locked");
  const drift = fixture(data, plan.request.TemplateBody, (name, _input, response) => { if (name === "getPolicyVersion") {
    const policy = response.PolicyVersion as { Document: string }, value = JSON.parse(decodeURIComponent(policy.Document));
    value.Statement.push({ Effect: "Allow", Action: "*", Resource: "*" }); policy.Document = JSON.stringify(value);
  } });
  await assert.rejects(drift.reads.readArnProbeStackControlObservation({ plan, signal: abort() }));
});

test("J23 generation6 full IAM collector accepts only its own Grant or exact Locked and rejects older shapes", async () => {
  const f = await generation6WorkflowFixture(), old = await stackControlWorkflowFixture(), plan = f.creationReview.plan, data = await material();
  const candidate = fixture(data, plan.request.TemplateBody);
  const result = await candidate.reads.readArnProbeGeneration6StackControlObservation({ plan, signal: abort() });
  assert.equal(result.rendererShape, "StackScopedReadControlGrant"); assert.equal(result.roles.length, 2); assert.equal(result.policies.length, 2);
  assert.equal(result.stack.templateRawSha256, plan.templateRawSha256);
  await assert.rejects(candidate.reads.readArnProbeStackControlObservation({ plan: old.creationReview.plan, signal: abort() }));
  await assert.rejects(candidate.reads.readManagementObservation({ signal: abort() }));
  const prior = fixture(data, old.creationReview.plan.request.TemplateBody);
  await assert.rejects(prior.reads.readArnProbeGeneration6StackControlObservation({ plan, signal: abort() }));
  const locked = fixture(data, plan.revokeTarget.templateBody);
  assert.equal((await locked.reads.readArnProbeGeneration6StackControlObservation({ plan, signal: abort() })).rendererShape, "Locked");
  const drift = fixture(data, plan.request.TemplateBody, (name, _input, response) => { if (name === "getPolicyVersion") {
    const policy = response.PolicyVersion as { Document: string }, value = JSON.parse(decodeURIComponent(policy.Document));
    value.Statement.push({ Effect: "Allow", Action: "*", Resource: "*" }); policy.Document = JSON.stringify(value);
  } });
  await assert.rejects(drift.reads.readArnProbeGeneration6StackControlObservation({ plan, signal: abort() }));
});

test("installed management SDK construction is dormant and uses login-only lazy shared credentials", async () => {
  const configs: Record<string, unknown>[] = [];
  let configReads = 0, loginReads = 0;
  class Client { constructor(config: Record<string, unknown>) { configs.push(config); } async send(): Promise<Record<string, unknown>> { throw new Error("No network expected"); } }
  class Command {}
  const sdkModule = Object.fromEntries(["STSClient", "CloudFormationClient", "IAMClient", "DynamoDBClient", "GetCallerIdentityCommand", "DescribeStacksCommand", "GetTemplateCommand", "ListStackResourcesCommand", "DescribeChangeSetCommand", "GetPolicyCommand", "GetPolicyVersionCommand", "ListPolicyVersionsCommand", "ListEntitiesForPolicyCommand", "GetRoleCommand", "ListAttachedRolePoliciesCommand", "ListRolePoliciesCommand", "GetItemCommand", "ExecuteChangeSetCommand"].map((name) => [name, name.endsWith("Client") ? Client : Command]));
  const modules: SharedCellAuthorCompensationManagementRuntimeModules = { sts: sdkModule, cloudFormation: sdkModule, iam: sdkModule, dynamoDb: sdkModule, login: { fromLoginCredentials(options: Record<string, unknown>) { assert.equal(options.profile, "techlong-sandbox-user"); return async () => { loginReads++; return { accessKeyId: "TEST", secretAccessKey: "TEST", sessionToken: "TEMPORARY", expiration: new Date(Date.now() + 60_000) }; }; } }, config: { async loadSharedConfigFiles() { configReads++; return { configFile: { "techlong-sandbox-user": { login_session: sourceArn, region } }, credentialsFile: {} }; } } };
  createAwsSdkSharedCellAuthorCompensationManagementRuntimeFromModules(modules);
  assert.equal(configReads, 0); assert.equal(loginReads, 0);
  assert.equal(configs.length, 5);
  assert.equal(configs[4].maxAttempts, 1);
  assert.ok(configs.every((config) => config.region === region && config.ignoreConfiguredEndpointUrls === true && config.credentials === configs[0].credentials));
  const provider = configs[0].credentials as () => Promise<unknown>;
  await provider();
  assert.equal(configReads, 1); assert.equal(loginReads, 1);
  modules.config.loadSharedConfigFiles = async () => ({ configFile: { "techlong-sandbox-user": { login_session: "arn:aws:iam::000000000000:user/foreign", region } }, credentialsFile: {} });
  configs.length = 0;
  createAwsSdkSharedCellAuthorCompensationManagementRuntimeFromModules(modules);
  await assert.rejects((configs[0].credentials as () => Promise<unknown>)(), /Source login session/);
  assert.equal(loginReads, 1);
  const installed = await createAwsSdkSharedCellAuthorCompensationManagementRuntime();
  assert.ok(installed.reads instanceof AwsSdkSharedCellAuthorCompensationManagementReadAdapter);
});

test("local management review CLI runs with Node type stripping and exposes no online mode", async () => {
  const data = await material();
  const directory = await mkdtemp(path.join(tmpdir(), "techlong-management-review-"));
  const file = path.join(directory, "review.json");
  const script = fileURLToPath(new URL("../ops/aws-sandbox/scripts/review-b5-shared-cell-author-compensation-management.ts", import.meta.url));
  try {
    await writeFile(file, JSON.stringify(data.input), "utf8");
    const review = spawnSync(process.execPath, ["--experimental-strip-types", script, "--input", file], { encoding: "utf8", timeout: 10_000 });
    assert.equal(review.status, 0, review.stderr);
    const result = JSON.parse(review.stdout);
    assert.equal(result.mode, "LOCAL_REVIEW");
    assert.equal(result.onlineExecutionReady, false);
    assert.equal(result.prepared.preparedActionSha256, data.prepared.preparedActionSha256);
    const online = spawnSync(process.execPath, ["--experimental-strip-types", script, "--execute", file], { encoding: "utf8", timeout: 10_000 });
    assert.notEqual(online.status, 0);
    assert.match(online.stderr, /Usage:/);
  } finally {
    await unlink(file);
    await rmdir(directory);
  }
});
