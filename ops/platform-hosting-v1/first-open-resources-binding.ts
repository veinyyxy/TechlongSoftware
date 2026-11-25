import { createHash } from "node:crypto";
import { isFirstOpenDispatchSelection, type FirstOpenDispatchSelection } from "../../lib/deployments/execution/ecs-first-open-dispatch.ts";
import type { SingleDeploymentClaimScope } from "../../lib/deployments/execution/single-deployment-scope.ts";
import { isFirstOpenRdsPrivateSubnetIds } from "../../lib/deployments/execution/first-open-tenant-network.ts";
import type { FirstOpenCellBinding } from "./first-open-rds-cell.ts";
import type { createFirstOpenRdsControl } from "./first-open-rds-control.ts";
import type { FirstOpenRdsInspectorMaterial } from "./first-open-rds-inspector.ts";
import type { createFirstOpenRdsManagement } from "./first-open-rds-management.ts";
import type { FirstOpenTaskResources } from "./first-open-task-runtime.ts";

type ManagementInput = Parameters<typeof createFirstOpenRdsManagement>[0];
type ControlInput = Parameters<typeof createFirstOpenRdsControl>[0];
type Env = Readonly<Record<string, string | undefined>>;
export type FirstOpenResourceSecretPin = { arn: string; versionId: string };

export const FIRST_OPEN_RESOURCE_BINDING_ENV = "TECHLONG_FIRST_OPEN_RESOURCES_JSON";
export const FIRST_OPEN_RESOURCE_BINDING_SHA_ENV = "TECHLONG_FIRST_OPEN_RESOURCES_SHA256";

export type FirstOpenRdsResourceBinding = {
  version: "techlong/ecs-first-open-resources/v2";
  selection: FirstOpenDispatchSelection;
  settings: FirstOpenTaskResources["settings"];
  scope: SingleDeploymentClaimScope;
  management: Omit<ManagementInput["scope"], "writeBefore" | "applicationSecretRef">;
  inspector: Omit<FirstOpenRdsInspectorMaterial, "tenant" | "privateSubnetIds"> & { tenant: Omit<FirstOpenRdsInspectorMaterial["tenant"], "databaseUrl">;
    readSecret: FirstOpenResourceSecretPin; mediaPublicBaseUrl: string };
  ownershipTableArn: string;
  cell: FirstOpenCellBinding;
  applicationSecret: FirstOpenResourceSecretPin;
  controlPublicKey: FirstOpenResourceSecretPin & { jsonKey?: string };
  control: { credentials: ControlInput["credentials"]; configurationSchemaSha256: string };
};

const fields = ["version", "selection", "settings", "scope", "management", "inspector", "ownershipTableArn", "cell",
  "applicationSecret", "controlPublicKey", "control"];
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** Parse only the reviewed, pre-registration material shared by the launcher and the worker. */
export function readFirstOpenRdsResourceBinding(env: Env): FirstOpenRdsResourceBinding | undefined {
  const payload = env[FIRST_OPEN_RESOURCE_BINDING_ENV];
  const digest = env[FIRST_OPEN_RESOURCE_BINDING_SHA_ENV];
  if (payload === undefined && digest === undefined) return undefined;
  try {
    if (payload && Buffer.byteLength(payload) <= 24_576 && createHash("sha256").update(payload).digest("hex") === digest) {
      const value: unknown = JSON.parse(payload);
      if (record(value) && value.version === "techlong/ecs-first-open-resources/v2" &&
        Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field)) &&
        isFirstOpenDispatchSelection(value.selection)) {
        const pin = value as FirstOpenRdsResourceBinding;
        if ([pin.settings, pin.scope, pin.management, pin.cell, pin.control, pin.inspector, pin.inspector.tenant,
          pin.inspector.sampling, pin.inspector.ingress, pin.management.target, pin.management.fence, pin.cell.cleanup,
          pin.control.credentials, pin.applicationSecret, pin.controlPublicKey, pin.inspector.readSecret].every(record) &&
          isFirstOpenRdsPrivateSubnetIds(pin.cell.privateSubnetIds) &&
          !Object.hasOwn(pin.inspector, "privateSubnetIds") && !Object.hasOwn(pin.inspector.tenant, "databaseUrl")) return pin;
      }
    }
  } catch { /* Keep the binding contents out of parse errors. */ }
  throw Error("ECS_FIRST_OPEN_RESOURCE_BINDING");
}
