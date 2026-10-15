import { renderSingleTenantAcceptanceCell, type SingleTenantAcceptanceCellInput } from './single-tenant-acceptance-cell.ts';
import { parseDatabaseBindingV2, databaseBindingDigestV2, type DatabaseBindingV2 } from '../execution/aurora-database-v2.ts';
import { canonicalJson, sha256Hex } from '../execution/hash.ts';

const removedResources = ['DatabaseSubnetA', 'DatabaseSubnetB', 'DatabaseSecurityGroup', 'DatabaseOneShotIngress',
  'CellDatabaseSubnetGroup', 'CellDatabaseLogGroup', 'CellDatabaseCluster', 'CellDatabaseWriter', 'OneShotTaskSecurityGroup'];
const removedOutputs = ['DatabaseClusterIdentifier', 'DatabaseEndpoint', 'DatabaseMasterSecretArn', 'OneShotTaskSecurityGroupId'];

/** Compute/network only. Reuses the separately installed Express DB, without
 * adopting it into this stack or synthesizing Full's master-secret outputs.
 * Render-only: NOT branded as an old 25-resource Cell or an apply capability.
 */
export async function renderExpressSingleTenantCellV1(input: { cell: SingleTenantAcceptanceCellInput; binding: DatabaseBindingV2 }) {
  const binding = parseDatabaseBindingV2(input.binding);
  if (binding.profile !== 'express_iam') throw Error('EXPRESS_CELL_PROFILE_REQUIRED');
  const base = await renderSingleTenantAcceptanceCell(input.cell), template = structuredClone(base.template);
  const resources = template.Resources as Record<string, { Type: string; DependsOn?: string[] }>;
  const outputs = template.Outputs as Record<string, unknown>;
  if (Object.keys(resources).length !== 25 || removedResources.some(id => !resources[id]) || removedOutputs.some(id => !outputs[id])) {
    throw Error('EXPRESS_CELL_BASE_DRIFT');
  }
  for (const id of removedResources) delete resources[id];
  for (const id of removedOutputs) delete outputs[id];
  for (const r of Object.values(resources)) {
    if (r.DependsOn?.some(id => !(id in resources))) throw Error('EXPRESS_CELL_DANGLING_DEPENDENCY');
  }
  template.Description = 'Single-tenant Express compute/network candidate; reuses external Express database; separate exact approval required.';
  template.Metadata = { ...template.Metadata as object, DatabaseProfile: 'express_iam', CreatesDatabaseResources: false,
    ExistingExpressBindingSha256: databaseBindingDigestV2(binding), CreatesOneShotLifecycleResources: false };
  const templateBody = canonicalJson(template);
  if (Object.keys(resources).length !== 16 || removedResources.some(id => templateBody.includes(id)) ||
      removedOutputs.some(id => templateBody.includes(id)) || templateBody.includes('AWS::RDS::') || templateBody.includes('5432')) {
    throw Error('EXPRESS_CELL_DATABASE_REFERENCE_REMAINS');
  }
  return { ...base, protocol: 'single-tenant-express-cell/v1' as const, template, templateBody,
    templateSha256: await sha256Hex(template), databaseBindingSha256: databaseBindingDigestV2(binding),
    resourceInventory: Object.entries(resources).map(([logicalId, r]) => ({ logicalId, type: r.Type })),
    safety: { ...base.safety, maxAcu: null, createsDatabaseResources: false, existingExpressDatabaseOwnedByThisStack: false,
      createsOneShotLifecycleResources: false, executionAuthorized: false, oldCellApplyCapabilityIssued: false,
      existingFailedStackDeletionAuthorized: false } };
}
