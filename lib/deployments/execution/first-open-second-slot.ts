import { parseDeploymentEnvironmentPolicy, validateDeploymentEnvironment, type DeploymentEnvironment,
  type DeploymentEnvironmentPolicy } from "../environment.ts";
import { FIRST_OPEN_BASELINE_BINDING } from "./first-onboarding-baseline-versions.ts";
import { firstOpenBuyerBinding } from "./first-open-buyer-binding.ts";
import { FIRST_OPEN_CELL_STACK } from "./first-onboarding-window.ts";
import { canonicalJson } from "./hash.ts";

export const FIRST_OPEN_SECOND_SLOT = Object.freeze({
  jobId: FIRST_OPEN_BASELINE_BINDING.jobId,
  environmentId: "env_aws_sandbox_ca_central_1",
  deploymentId: "dep_746535593025bf97a9efeccd",
  instanceId: firstOpenBuyerBinding.tenantId,
  hostname: firstOpenBuyerBinding.apiHostname,
  cellStackId: FIRST_OPEN_CELL_STACK,
  incumbentInstanceId: "app_e897a4377bce498b9c5ee9e64509dcad",
  incumbentDeploymentId: "dep_7c99bd249470184852f0dc74",
});

/** This is an opt-in member of the exact first-open approval, not a runtime flag. */
export type FirstOpenSecondSlotApproval = {
  schema: "techlong/fc41597f-second-slot/v1";
  environmentPolicy: DeploymentEnvironmentPolicy;
  admissionEpoch: number;
  listenerPriority: number;
};

const fixedEnvironment = {
  id: FIRST_OPEN_SECOND_SLOT.environmentId, key: "aws-sandbox-ca-central-1", name: "AWS Sandbox",
  kind: "aws_sandbox", driver: "aws_ecs_cell", expectedAccountId: "402010193138", region: "ca-central-1",
  cellKey: "cell-sandbox-1", baseDomain: "sandbox.techlong.cloud", applyEnabled: false, status: "active",
} as const;
const fail = (): never => { throw Error("FIRST_OPEN_SECOND_SLOT_APPROVAL"); };

export function assertFirstOpenSecondSlot(approval: FirstOpenSecondSlotApproval): void {
  if (!approval || typeof approval !== "object" || Array.isArray(approval) ||
    Object.keys(approval).sort().join(",") !== "admissionEpoch,environmentPolicy,listenerPriority,schema" ||
    approval.schema !== "techlong/fc41597f-second-slot/v1" ||
    !Number.isSafeInteger(approval.admissionEpoch) || approval.admissionEpoch < 0 ||
    !Number.isSafeInteger(approval.listenerPriority) || approval.listenerPriority < 102 || approval.listenerPriority > 49_998) fail();
  const p = parseDeploymentEnvironmentPolicy(approval.environmentPolicy);
  if (!p || p.maxTenants !== 2 || p.budgetLimitCents !== 5000 ||
    canonicalJson(p) !== canonicalJson(approval.environmentPolicy) ||
    validateDeploymentEnvironment({ ...fixedEnvironment, policy: { ...p, maxTenants: 1 } }).length !== 0) fail();
}

export function matchesFirstOpenSecondSlotEnvironment(approval: FirstOpenSecondSlotApproval, environment: DeploymentEnvironment): boolean {
  try { assertFirstOpenSecondSlot(approval); } catch { return false; }
  const { name: _name, ...coordinates } = fixedEnvironment;
  void _name;
  return Object.entries(coordinates).every(([key, value]) => environment[key as keyof typeof coordinates] === value) &&
    canonicalJson(environment.policy) === canonicalJson(approval.environmentPolicy);
}
