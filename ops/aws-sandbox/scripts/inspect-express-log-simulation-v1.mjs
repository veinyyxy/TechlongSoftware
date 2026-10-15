// Read-only isolation of a simulator discrepancy; no policy or log writes.
import { readFile, open } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import * as iam from '@aws-sdk/client-iam';
import { computeClientConfig } from './express-compute-observer-v1.mjs';
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--output' || !/^F:\/ChatGPT_workshop\/techlong-express-c5f-log-simulation-[a-z0-9-]+\.json$/.test(args[1])) throw Error('LOG_SIMULATION_ARGUMENTS');
if (['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_CONFIG_FILE', 'AWS_SHARED_CREDENTIALS_FILE',
  'NODE_OPTIONS', 'NODE_EXTRA_CA_CERTS'].some(k => process.env[k]) || process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw Error('LOG_SIMULATION_ENV');
const c = new iam.IAMClient(computeClientConfig()), signal = AbortSignal.timeout(60000);
let calls = 0;
const allowed = new Set(['GetRoleCommand', 'GetRolePolicyCommand', 'GetPolicyCommand', 'GetPolicyVersionCommand', 'SimulateCustomPolicyCommand']);
const send = q => { if (!allowed.has(q.constructor.name) || ++calls > 8) throw Error('LOG_SIMULATION_SCOPE'); return c.send(q, { abortSignal: signal }); };
const decode = d => typeof d === 'string' ? JSON.parse(decodeURIComponent(d)) : d;
try {
  const roleName = 'TechlongSandboxTaskExecutionRole', policyName = 'PullSandboxImageAndRuntimeSecrets';
  const principal = 'arn:aws:iam::402010193138:role/' + roleName;
  const boundaryArn = 'arn:aws:iam::402010193138:policy/TechlongSandboxServiceRoleBoundary';
  const role = (await send(new iam.GetRoleCommand({ RoleName: roleName }))).Role;
  if (role?.Arn !== principal || role.RoleId !== 'AROAV3GNMXTZJHJWAN4IR' || role.PermissionsBoundary?.PermissionsBoundaryArn !== boundaryArn) throw Error('LOG_SIMULATION_ROLE_DRIFT');
  const p = (await send(new iam.GetRolePolicyCommand({ RoleName: roleName, PolicyName: policyName }))).PolicyDocument;
  const policy = (await send(new iam.GetPolicyCommand({ PolicyArn: boundaryArn }))).Policy;
  if (policy?.Arn !== boundaryArn || policy.PolicyId !== 'ANPAV3GNMXTZHXSTCQBZC' || policy.DefaultVersionId !== 'v4') throw Error('LOG_SIMULATION_POLICY_DRIFT');
  const b = (await send(new iam.GetPolicyVersionCommand({ PolicyArn: boundaryArn, VersionId: policy.DefaultVersionId }))).PolicyVersion.Document;
  const plan = JSON.parse(await readFile('F:/ChatGPT_workshop/techlong-express-c5f-review-20261015-r3/plan.json', 'utf8'));
  const resource = 'arn:aws:logs:ca-central-1:402010193138:log-group:' + plan.futureTemplate.template.Resources.TenantLogGroup.Properties.LogGroupName + ':log-stream:app/speedfeast-backend/00000000000000000000000000000000';
  const action = ['logs:CreateLogStream', 'logs:PutLogEvents'];
  const minimal = r => ({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: action, Resource: r }] });
  const cases = [
    { label: 'minimal-exact-no-boundary', identity: minimal(resource) },
    { label: 'minimal-star-no-boundary', identity: minimal('*') },
    { label: 'actual-inline-no-boundary', identity: decode(p) },
    { label: 'minimal-exact-actual-boundary', identity: minimal(resource), boundary: decode(b) },
  ];
  const results = [];
  for (const t of cases) {
    await delay(1200, undefined, { signal });
    const r = await send(new iam.SimulateCustomPolicyCommand({ PolicyInputList: [JSON.stringify(t.identity)],
      ...(t.boundary ? { PermissionsBoundaryPolicyInputList: [JSON.stringify(t.boundary)] } : {}), ActionNames: action, ResourceArns: [resource],
      ContextEntries: [{ ContextKeyName: 'aws:RequestedRegion', ContextKeyType: 'string', ContextKeyValues: ['ca-central-1'] },
        { ContextKeyName: 'aws:PrincipalArn', ContextKeyType: 'string', ContextKeyValues: [principal] }] }));
    results.push({ label: t.label, evaluationResults: r.EvaluationResults });
  }
  const result = { schema: 'techlong/express-log-simulation-inspection/v1', at: new Date().toISOString(), resource, principal,
    inline: { roleName, policyName, document: decode(p) }, boundary: { arn: boundaryArn, id: policy.PolicyId, version: policy.DefaultVersionId, document: decode(b) },
    results, sdkReadonlyCalls: calls, actualWrites: 0, privateReads: 0, automaticRetries: 0, provesActualLogAccess: false };
  const f = await open(args[1], 'wx'); try { await f.writeFile(JSON.stringify(result, null, 2) + '\n'); await f.sync(); } finally { await f.close(); }
  console.log(JSON.stringify({ output: args[1], rows: results.map(r => ({ label: r.label, decisions: r.evaluationResults.map(v => ({ action: v.EvalActionName, decision: v.EvalDecision, missingContext: v.MissingContextValues })) })), actualWrites: 0 }, null, 2));
} finally { c.destroy(); }
