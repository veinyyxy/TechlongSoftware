import { PUBLISHED_F3_IMAGES_V1 } from "./cell-launch-readiness-v1.ts";

export interface SingleDeploymentClaimScope {
  deploymentId: string;
  appInstanceId: string;
  environmentId: string;
  planHash: string;
  configurationHash: string;
  artifactRef: string;
}

export const FIRST_ACCEPTANCE_APP_IMAGE =
  `402010193138.dkr.ecr.ca-central-1.amazonaws.com/techlong-sandbox-speedfeast@${PUBLISHED_F3_IMAGES_V1[0].digest}`;

/** Restricts queue selection; it is not cloud/DB approval or live enablement. */
export function validateSingleDeploymentScope(raw: SingleDeploymentClaimScope): Readonly<SingleDeploymentClaimScope> {
  const value = structuredClone(raw);
  const keys = ["deploymentId", "appInstanceId", "environmentId", "planHash", "configurationHash", "artifactRef"];
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== keys.sort().join(",") ||
    keys.some(key => typeof value[key as keyof SingleDeploymentClaimScope] !== "string") ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/.test(value.deploymentId) ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/.test(value.appInstanceId) ||
    value.environmentId !== "env_aws_sandbox_ca_central_1" ||
    !/^[a-f0-9]{64}$/.test(value.planHash) || !/^[a-f0-9]{64}$/.test(value.configurationHash) ||
    value.artifactRef !== FIRST_ACCEPTANCE_APP_IMAGE) {
    throw Error("SINGLE_DEPLOYMENT_SCOPE_INVALID");
  }
  return Object.freeze(value);
}

/** Shared by every state-changing CTE in claimNext, not just final selection.
 * Parameters 5–10 are absent only for the unchanged legacy queue entry.
 */
export function singleDeploymentClaimPredicate(alias: "blocked" | "exhausted_job" | "candidate_job"): string {
  if (!["blocked", "exhausted_job", "candidate_job"].includes(alias)) throw Error("SINGLE_DEPLOYMENT_ALIAS_INVALID");
  return `($5::text IS NULL OR EXISTS (
    SELECT 1 FROM app_instance_deployments AS scoped_deployment
    INNER JOIN deployment_environments AS scoped_environment
      ON scoped_environment.id = scoped_deployment.environment_id
    WHERE scoped_deployment.id = ${alias}.deployment_id
      AND scoped_deployment.id = $5 AND scoped_deployment.app_instance_id = $6
      AND scoped_deployment.environment_id = $7 AND scoped_deployment.plan_hash = $8
      AND scoped_deployment.configuration_hash = $9 AND scoped_deployment.artifact_ref = $10
      AND scoped_deployment.desired_plan::jsonb->>'mode' = 'aws_sandbox'
      AND ${alias}.payload::jsonb->>'deploymentId' = $5 AND ${alias}.payload::jsonb->>'planHash' = $8
      AND scoped_environment.kind = 'aws_sandbox'
      AND scoped_environment.expected_account_id = '402010193138'
      AND scoped_environment.region = 'ca-central-1'
      AND scoped_environment.cell_key = 'cell-sandbox-1'
  ))`;
}

export function singleDeploymentScopeFromArguments(args: string[]): Readonly<SingleDeploymentClaimScope> | undefined {
  const flags = ["--deployment-id", "--app-instance-id", "--environment-id", "--plan-sha", "--configuration-sha"];
  for (let i = 0; i < args.length; i++) {
    if (["--once", "--check-runtime"].includes(args[i])) continue;
    if (!flags.includes(args[i]) || !args[i + 1] || args[i + 1].startsWith("--"))
      throw Error("SINGLE_DEPLOYMENT_ARGUMENT_INVALID");
    i++;
  }
  if (!flags.some(flag => args.includes(flag))) return undefined;
  if (!args.includes("--once") && !args.includes("--check-runtime")) throw Error("SINGLE_DEPLOYMENT_ONCE_REQUIRED");
  const values = flags.map(flag => {
    if (args.filter(arg => arg === flag).length !== 1) throw Error("SINGLE_DEPLOYMENT_COMPLETE_SCOPE_REQUIRED");
    const value = args[args.indexOf(flag) + 1];
    if (!value || value.startsWith("--")) throw Error("SINGLE_DEPLOYMENT_COMPLETE_SCOPE_REQUIRED");
    return value;
  });
  return validateSingleDeploymentScope({ deploymentId: values[0], appInstanceId: values[1], environmentId: values[2],
    planHash: values[3], configurationHash: values[4], artifactRef: FIRST_ACCEPTANCE_APP_IMAGE });
}
