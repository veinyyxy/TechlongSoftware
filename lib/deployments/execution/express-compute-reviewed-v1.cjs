'use strict';
/* eslint-disable @typescript-eslint/no-require-imports -- Pure exact compute request/observation guard, no AWS client. */
const db = require('./aurora-database-contract-v2.cjs');
const NAME = 'techlong-sandbox-cell-sandbox-1';
const OLD = 'arn:aws:cloudformation:ca-central-1:402010193138:stack/' + NAME + '/ede4f290-c758-11f1-8050-06ffda7a3477';
const ROLE = 'arn:aws:iam::402010193138:role/TechlongSandboxFirstAcceptanceCellExecutionRole';
const RUN_SLOT = 'techlong-express-c5d-compute-run-v1.permanent-slot.json';
const DELETE_SLOT = 'techlong-express-c5d-old-stack-delete-v1.permanent-slot.json';
const CREATE_SLOT = 'techlong-express-c5d-compute-create-v1.permanent-slot.json';
const same = (a, b) => db.canonicalJson(a) === db.canonicalJson(b), sha = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
function fail(code) { throw Object.assign(Error(code), { code, retryable: false }); }
function freeze(v) { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
function oldProjection(s) { if (!s) return null; return { stackId: s.stackId, status: s.status, roleArn: s.roleArn, tags: s.tags,
  resources: s.resources.filter(r => r.physicalId), templateSha256: s.templateSha256 }; }
function checkFacts(f, now) {
  if (!Number.isFinite(now) || !Number.isSafeInteger(f?.observedAt) || now < f.observedAt || now - f.observedAt > 60000 ||
      f.source?.Account !== '402010193138' || f.source.Arn !== 'arn:aws:iam::402010193138:user/techlong-sandbox-dev' || f.source.UserId !== 'AIDAV3GNMXTZEO7SHLC2X' ||
      f.existingIamVerified !== true || f.iam?.roleId !== 'AROAV3GNMXTZESNMKM56K' || f.iam.policyId !== 'ANPAV3GNMXTZL4VMJHXXZ' ||
      f.iam.boundaryVersion !== 'v1' || f.iam.materialSha256 !== '4d7d1712e914a7b4d7cc4e227a97761318585396893f5fab0d31b11f091e9faf' ||
      f.simulations?.length !== 4 || f.simulations.some(x => !x.allowed) || f.prerequisites?.truststoreActive !== true ||
      !same(f.prerequisites.zones, ['ca-central-1a', 'ca-central-1b'])) fail('COMPUTE_FRESH_FACTS_REQUIRED');
}
function checkEmptyNamespace(f) {
  const n = f.namespace, ec = n?.ecs, cs = ec?.clusters;
  if (n?.vpcs?.length !== 0 || n.loadBalancers?.length !== 0 || !Array.isArray(cs) || cs.length > 1 ||
      (cs.length === 0 ? ec.failures?.length !== 1 || ec.failures[0].reason !== 'MISSING' : ec.failures?.length !== 0 || cs[0].name !== 'cell-sandbox-1' ||
        cs[0].arn !== 'arn:aws:ecs:ca-central-1:402010193138:cluster/cell-sandbox-1' || cs[0].status !== 'INACTIVE' ||
        [cs[0].running, cs[0].pending, cs[0].services].some(v => v !== 0))) fail('COMPUTE_NAMESPACE_OCCUPIED');
}
function checkOld(f, expected, now) {
  checkFacts(f, now); checkEmptyNamespace(f);
  if (f.stack?.stackId !== OLD || f.stack.status !== 'ROLLBACK_COMPLETE' || f.stack.roleArn !== ROLE || f.stack.terminationProtection ||
      f.stack.templateSha256 !== '4d0061be99e0df1e51993f875596d00913aefe609c21a3432d4a7241431e8077' ||
      f.stack.resources.filter(r => r.physicalId).length !== 20 || f.stack.resources.some(r => r.physicalId ? r.status !== 'DELETE_COMPLETE' : !['CREATE_FAILED', 'DELETE_COMPLETE'].includes(r.status)) ||
      !same(oldProjection(f.stack), expected)) fail('COMPUTE_OLD_STACK_CHANGED');
}
function checkDraft(d) {
  if (d?.protocol !== 'single-tenant-express-cell/v1' || d.stackName !== NAME || d.accountId !== '402010193138' || d.region !== 'ca-central-1' ||
      d.resourceInventory?.length !== 16 || db.digest(d.template) !== d.templateSha256 || db.canonicalJson(d.template) !== d.templateBody ||
      d.template.Transform || Object.values(d.template.Resources).some(r => !/^(AWS::EC2::(?:VPC|InternetGateway|VPCGatewayAttachment|Subnet|RouteTable|Route|SubnetRouteTableAssociation|SecurityGroup)|AWS::ECS::Cluster|AWS::ElasticLoadBalancingV2::(?:LoadBalancer|Listener|ListenerRule))$/.test(r.Type)) ||
      d.parameters.CertificateArn !== 'arn:aws:acm:ca-central-1:402010193138:certificate/6d1f2880-9f83-449c-930a-6b17516ef49d' ||
      d.parameters.ControlTrustStoreArn !== 'arn:aws:elasticloadbalancing:ca-central-1:402010193138:truststore/techlong-sandbox-control-v1/aa1771fd0469cc44' ||
      Object.keys(d.parameters).length !== 4 || d.tags.ManagedBy !== 'techlong-provisioner' || d.tags.CellId !== 'cell-sandbox-1' ||
      !d.safety.supervisedExactArnCleanupMustBeReviewedBeforeCreate || d.safety.createsDatabaseResources !== false) fail('COMPUTE_EXACT_DRAFT_REQUIRED');
}
function prices(feed, fileSha256, now) {
  if (!sha(fileSha256) || feed?.region !== 'ca-central-1' || feed.currency !== 'USD' || now < Date.parse(feed.at) || now - Date.parse(feed.at) > 86400000) fail('COMPUTE_FRESH_PRICES_REQUIRED');
  const rate = (service, usage, description) => { const rows = feed.snapshots.find(s => s.service === service)?.selected.filter(r => r.attributes.usagetype === usage && (!description || description.test(r.description)));
    if (rows?.length !== 1 || !(Number(rows[0].usd) > 0)) fail('COMPUTE_PRICE_AMBIGUOUS'); return Number(rows[0].usd); };
  const r = { albHour: rate('AWSELB', 'CAN1-LoadBalancerUsage', /Application LoadBalancer-hour/), truststoreHour: rate('AWSELB', 'CAN1-TS-LoadBalancerUsage'),
    lcuHour: rate('AWSELB', 'CAN1-LCUUsage', /Application load balancer/), ipv4Hour: rate('AmazonVPC', 'CAN1-PublicIPv4:InUseAddress'),
    cpuHour: rate('AmazonECS', 'CAN1-Fargate-vCPU-Hours:perCPU'), memoryGbHour: rate('AmazonECS', 'CAN1-Fargate-GB-Hours'),
    acuHour: rate('AmazonRDS', 'CAN1-Aurora:ServerlessV2Usage') };
  const network = r.albHour + r.truststoreHour + 2 * r.ipv4Hour, withOneLcu = network + r.lcuHour;
  const futureTask = .25 * r.cpuHour + .5 * r.memoryGbHour + r.ipv4Hour;
  return { priceFileSha256: fileSha256, observedAt: feed.at, region: 'ca-central-1', currency: 'USD', rates: r,
    assumptions: { networkPublicIpv4: 2, truststoreAssociations: 1, lcuScenario: 1, futureTaskCpu: .25, futureTaskMemoryGb: .5, futureTaskPublicIpv4: 1 },
    currentScope: { networkHourlyUsd: network, threeHoursBaseUsd: network * 3, threeHoursOneLcuUsd: withOneLcu * 3, monthly730HoursBaseUsd: network * 730 },
    futureNotAuthorized: { taskWithIpv4HourlyUsd: futureTask, monthly730HoursWithTaskAndOneLcuBeforeDatabaseUsd: (withOneLcu + futureTask) * 730,
      monthly730HoursAlsoOneActiveAcuUsd: (withOneLcu + futureTask + r.acuHour) * 730 },
    excludes: ['existing resources', 'Secrets/storage/I/O/backups', 'CloudWatch/DNS', 'extra IPv4/LCU/data transfer', 'tax'], creditsAssumed: 0,
    monthlyTargetUsd: 50, hardCap: false, automaticDeletion: false, feesContinueUntilActualCleanup: true };
}
function prepare({ draft, facts, oldSnapshot, controlPlane, seedEvidenceSha256, codeBindingSha256, estimate, now }) {
  checkDraft(draft); checkOld(facts, oldSnapshot, now);
  if (![seedEvidenceSha256, codeBindingSha256].every(sha) || !estimate || estimate.hardCap !== false ||
      controlPlane?.result?.outcome !== 'FIRST_CLAIM_CANDIDATE_AURORA_PROOF_STILL_REQUIRED' ||
      Object.values(controlPlane.result.checks || {}).length !== 7 || !Object.values(controlPlane.result.checks).every(v => v === true) ||
      !Number.isFinite(controlPlane.result.completedAt) || now < controlPlane.result.completedAt || now - controlPlane.result.startedAt > 90000) fail('COMPUTE_REVIEW_INPUT_REJECTED');
  const body = { schema: 'techlong/express-compute-review/v1', preparedAt: now, expiresAt: Math.min(now + 2 * 3600000, Date.parse(draft.reviewDeadline) - 3600000),
    codeBindingSha256, seedEvidenceSha256, draft, oldSnapshot, facts, controlPlane, estimate,
    slots: { run: RUN_SLOT, oldDelete: DELETE_SLOT, create: CREATE_SLOT },
    limits: { deleteOldStackCalls: 1, createStackCalls: 1, cfnTemplateResources: 16, iamWrites: 0, sqlConnections: 0, secretValueReads: 0, neonWrites: 0, authorityWrites: 0,
      writesRetry: 0, rootReset: false, cloudFormationFailureRollback: true, createTimeoutMinutes: 45, operatorDeleteNewStack: false },
    cleanupProcedure: { captureNewExactStackUuidBeforeFurtherActions: true, sourceAndInstalledCellRoleRechecked: true,
      futureDeleteRequiresNewExactUuidTemplateResourcesAndNoWorkloadReview: true, oldCreateOrCleanupApprovalNotReused: true,
      newStackMayContainChargeablePartialResources: true, expiryTagDoesNotDelete: true, expressDatabaseAndSecretsOutsideStackPreserved: true },
    risks: ['Exactly one STANDARD DeleteStack irreversibly retires only the reviewed old failed stack UUID. All 20 physical CFN rows are DELETE_COMPLETE; metadata and namespace observations are not a proof that every underlying service object or charge is absent.',
      'Retirement and one new CreateStack are not atomic. New creation uses the existing role and 16 network/ECS-cluster/ALB resources; no task/service/RDS/IAM/Secret/DB/DNS is created. A same-name race or failed/lost response leaves consumed slots and requires inspection, never write retry/completion/reset.',
      'CloudFormation OnFailure=ROLLBACK, timeout45 and Delete policies can delete newly created resources on failure. Operator deletion of the new stack is not authorized here; exact captured UUID, no-workload and full resource/template checks need fresh cleanup approval.',
      'ALB, mTLS association, IPv4/LCU can bill immediately and partly created resources can remain. Three-hour ExpiresAt is a tag, not a scheduler or hard cost cap. 50 USD/month is a target; current regional prices and future always-on scenarios can exceed it. No credits, tax or full-account bill is assumed.',
      'Source and service-role simulations/documents are not provider, propagation or cross-service CAS proof. The existing Cell role still contains historical Full database permissions; it is not narrowed or newly granted by this template. Privileged concurrent actors can change resources after checks.',
      'Control-plane reads and historical approved seed evidence do not claim owner/epoch, start TTL or prove current Aurora SQL/initialized ready. No private bundle or Secret value read is authorized. Source auto-refresh can fail while CFN continues; stop writes and inspect using saved exact identity.',
      'The new permanent root and each API-entry slot are occupied before submission, never reset or replayed. SDK maxAttempts=1; client request tokens attribute operations, not authorize retransmission. Captured UUID/template/tag/resource/event checks are required before using outputs.'],
    runtimeEnabled: false, readyVerified: false };
  if (body.expiresAt <= now) fail('COMPUTE_DEADLINE_TOO_CLOSE'); return freeze({ ...body, manifestSha256: db.digest(body) });
}
function approval(m, approvedSha, codeSha, now) {
  const { manifestSha256, ...body } = m || {};
  if (approvedSha !== manifestSha256 || db.digest(body) !== manifestSha256 || codeSha !== m.codeBindingSha256 ||
      !Number.isFinite(now) || now < m.preparedAt || now >= m.expiresAt || Date.parse(m.draft.reviewDeadline) - now < 3600000 ||
      !same(prepare({ ...body, now: m.preparedAt }), m)) fail('COMPUTE_FRESH_EXACT_APPROVAL_REQUIRED');
}
function requests(m) { checkDraft(m.draft); const sha256 = m.manifestSha256;
  if (!sha(sha256)) fail('COMPUTE_SHA_REQUIRED');
  return freeze({ retire: { StackName: OLD, RoleARN: ROLE, ClientRequestToken: 'express-retire-' + sha256, DeletionMode: 'STANDARD' },
    create: { StackName: NAME, RoleARN: ROLE, TemplateBody: m.draft.templateBody, Parameters: Object.entries(m.draft.parameters).map(([ParameterKey, ParameterValue]) => ({ ParameterKey, ParameterValue })),
      Tags: Object.entries(m.draft.tags).map(([Key, Value]) => ({ Key, Value })), ResourceTypes: [...new Set(m.draft.resourceInventory.map(r => r.type))].sort(),
      ClientRequestToken: 'express-compute-' + sha256, OnFailure: 'ROLLBACK', TimeoutInMinutes: 45, EnableTerminationProtection: false } });
}
function checkBeforeCreate(f, m, now) { checkFacts(f, now); checkEmptyNamespace(f);
  if (f.stack !== null || !same(f.iam, m.facts.iam) || !same(f.prerequisites, m.facts.prerequisites)) fail('COMPUTE_POST_RETIREMENT_DRIFT'); }
function checkCreatedStack(f, m, receipt, attributed, now) { checkFacts(f, now); const s = f.stack;
  if (!receipt || !/^arn:aws:cloudformation:ca-central-1:402010193138:stack\/techlong-sandbox-cell-sandbox-1\/[a-f0-9-]{36}$/.test(receipt.stackId) || receipt.stackId === OLD ||
      s?.stackId !== receipt.stackId || s.status !== 'CREATE_COMPLETE' || s.roleArn !== ROLE || s.terminationProtection ||
      !same(s.tags, m.draft.tags) || !same(s.parameters, m.draft.parameters) || s.templateSha256 !== m.draft.templateSha256 ||
      !same(s.resources.map(r => ({ logicalId: r.logicalId, type: r.type })), [...m.draft.resourceInventory].sort((a, b) => a.logicalId.localeCompare(b.logicalId))) ||
      s.resources.some(r => r.status !== 'CREATE_COMPLETE' || !r.physicalId) || attributed !== true || !same(f.iam, m.facts.iam)) fail('COMPUTE_NEW_STACK_UNPROVED');
  const ids = Object.fromEntries(s.resources.map(r => [r.logicalId, r.physicalId]));
  const ec = f.namespace.ecs;
  if (ec.failures.length || ec.clusters.length !== 1 || ec.clusters[0].name !== 'cell-sandbox-1' ||
      ec.clusters[0].arn !== 'arn:aws:ecs:ca-central-1:402010193138:cluster/cell-sandbox-1' || ec.clusters[0].status !== 'ACTIVE' ||
      [ec.clusters[0].running, ec.clusters[0].pending, ec.clusters[0].services].some(v => v !== 0)) fail('COMPUTE_UNEXPECTED_WORKLOAD');
  const exact = { ClusterName: ids.CellCluster, VpcId: ids.CellVpc, TaskSecurityGroupId: ids.TaskSecurityGroup,
    HttpsListenerArn: ids.BusinessHttpsListener, ControlListenerArn: ids.ControlMtlsListener,
    SubnetIds: [ids.PublicSubnetA, ids.PublicSubnetB].join(','), CellExpiresAt: m.draft.reviewDeadline };
  if (!same(s.outputs, exact) || !same(f.namespace.vpcs, [ids.CellVpc]) || f.namespace.loadBalancers.length !== 1 ||
      f.namespace.loadBalancers[0].arn !== ids.CellLoadBalancer || f.namespace.loadBalancers[0].vpcId !== ids.CellVpc) fail('COMPUTE_OUTPUT_PROVENANCE_REJECTED');
  return freeze({ outcome: 'EXPRESS_COMPUTE_INDEPENDENTLY_VERIFIED_NO_WORKLOAD', stackId: receipt.stackId, templateSha256: s.templateSha256,
    outputs: s.outputs, loadBalancer: f.namespace.loadBalancers[0], oldStackDeleted: true, templateResources: 16,
    databaseReusedNotInStack: true, workloadDeployed: false, ownerOrEpochClaimed: false, runtimeEnabled: false, readyVerified: false });
}
async function executeReviewedCompute(m, port) {
  const req = requests(m), { approve, observe, control, who, consume, save, now } = port;
  approve(); const before = await observe(m.draft); await control(); approve(); checkOld(before, m.oldSnapshot, now());
  if (!same(before.iam, m.facts.iam) || !same(before.prerequisites, m.facts.prerequisites)) fail('COMPUTE_PRECONDITION_DRIFT');
  await save('before-retirement.json', before); await port.credentialsEnough(); approve(); await who();
  await consume(RUN_SLOT, { manifestSha256: m.manifestSha256, outputDirectory: port.outputDirectory });
  await consume(DELETE_SLOT, { manifestSha256: m.manifestSha256, request: req.retire }); approve();
  await port.deleteStack(req.retire); await save('old-delete-response.json', { acknowledged: true, oldStackId: OLD });
  await port.waitDeleted();
  const absent = await observe(m.draft); await control(); approve(); checkBeforeCreate(absent, m, now());
  await save('before-create.json', absent); await who(); approve();
  await consume(CREATE_SLOT, { manifestSha256: m.manifestSha256, requestSha256: db.digest(req.create), clientRequestToken: req.create.ClientRequestToken });
  approve(); const created = await port.createStack(req.create);
  if (!created?.StackId || created.StackId === OLD || !/^arn:aws:cloudformation:ca-central-1:402010193138:stack\/techlong-sandbox-cell-sandbox-1\/[a-f0-9-]{36}$/.test(created.StackId)) fail('COMPUTE_CREATE_UUID_RESPONSE_INVALID');
  const receipt = { stackId: created.StackId, manifestSha256: m.manifestSha256, clientRequestToken: req.create.ClientRequestToken, capturedAt: now() };
  await save('create-receipt.json', receipt); return receipt;
}
module.exports = { NAME, OLD, ROLE, RUN_SLOT, DELETE_SLOT, CREATE_SLOT, oldProjection, checkFacts, checkEmptyNamespace, checkOld, checkDraft, prices, prepare, approval, requests, checkBeforeCreate, checkCreatedStack, executeReviewedCompute };
