// Local reviewed activation adapter. No OIDC dispatch, Secret-value or original bundle API.
import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { parseEnv } from 'node:util';
import { fromLoginCredentials } from '@aws-sdk/credential-provider-login';
import * as cf from '@aws-sdk/client-cloudformation';
import * as iam from '@aws-sdk/client-iam';
import * as s3api from '@aws-sdk/client-s3';
import { DynamoDBClient, DescribeTimeToLiveCommand } from '@aws-sdk/client-dynamodb';
import { SecretsManagerClient, DescribeSecretCommand, GetResourcePolicyCommand, ListSecretVersionIdsCommand } from '@aws-sdk/client-secrets-manager';
import { neon } from '@neondatabase/serverless';
import { ACTIVATION_V5 as A, ENVIRONMENT_BODY_V5, BRANCH_BODY_V5, verifyEnvironmentV5 } from './release-v5.mjs';
import { verifyActivationChangeSetV5 } from './plan-v5.mjs';
import { requireActivationV5 as must } from './errors-v5.mjs';
import { gitLocalV5, assertReleaseObjectsV5 } from './commit-objects-v5.mjs';
import { RECOVERY_ANCHOR_V5 as R } from '../install/recovery-v5.mjs';
import { createContinuationIoV5 } from '../install/continuation-local-io-v5.mjs';
import { readAwsInstallInventoryV5 } from '../install/inventory-v5.mjs';
import { workerPermissionsV5, evidenceBucketPolicyV5 } from '../install/plan-v5.mjs';
import { assessContinuationSecretV5 } from '../install/continuation-secrets-v5.mjs';
import { writePublicOnceV5 } from '../install/local-io-v5.mjs';
import { createLocalInstallIoV5 } from '../install/local-io-v5.mjs';
import { INSTALL_CANDIDATE_V5 as C } from '../install/inventory-v5.mjs';
import { createEvidencePortV5, assertEvidenceSafeV5 } from '../cloud-evidence-v5.mjs';
import { NEON_CATALOG_SQL_V5, verifyNeonCatalogV5 } from '../neon-persistence-v5.mjs';
import { loadNeonContractV5 } from '../neon-contract-v5.mjs';
import { canonicalJson, sha256Hex } from '../../../lib/deployments/execution/hash.ts';
const same = (a,b) => canonicalJson(a) === canonicalJson(b);
const decode = p => JSON.parse(typeof p === 'string' ? decodeURIComponent(p) : JSON.stringify(p));
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
async function githubCredential() {
  return new Promise((resolve,reject) => {
    const c = spawn('git',['credential','fill'],{ cwd: 'E:/NodejsProject/TechlongSoftware',windowsHide: true,stdio: ['pipe','pipe','pipe'] });
    c.stdout.setEncoding('utf8');
    let out = ''; const timer = setTimeout(() => c.kill(),15000);
    c.stdout.on('data',b => { out += b; if (out.length > 20000) c.kill(); }); c.stderr.on('data',() => {}); c.stdin.on('error',() => {});
    c.on('error',() => { clearTimeout(timer); reject(Error('ACTIVATION_GITHUB_CREDENTIAL_UNAVAILABLE')); });
    c.on('close',code => { clearTimeout(timer); const token = out.split(/\r?\n/).find(l => l.startsWith('password='))?.slice(9);
      if (code || !token || out.length > 20000) reject(Error('ACTIVATION_GITHUB_CREDENTIAL_UNAVAILABLE')); else resolve(token); });
    c.stdin.end('protocol=https\nhost=github.com\npath=veinyyxy/TechlongSoftware.git\n\n');
  });
}
export function createActivationIoV5({ output,capsule,binding }) {
  const cfg = { region: 'ca-central-1',ignoreConfiguredEndpointUrls: true,maxAttempts: 1 },
    credentials = fromLoginCredentials({ profile: 'techlong-sandbox-user',ignoreCache: true,clientConfig: cfg });
  const cfClient = new cf.CloudFormationClient({ ...cfg,credentials }), iamClient = new iam.IAMClient({ ...cfg,region: 'us-east-1',credentials }),
    s3 = new s3api.S3Client({ ...cfg,credentials }), ddb = new DynamoDBClient({ ...cfg,credentials }), sm = new SecretsManagerClient({ ...cfg,credentials });
  const installed = createContinuationIoV5({ output,capsule }),partialReader = createLocalInstallIoV5({ output,capsule });
  let token,label = 'LocalSetup',guard = async () => { must(false,'APPROVAL_GUARD'); },guardSet = false,publication,pendingTemplate,pendingChangeSet;
  const counts = { githubEnvironmentPuts: 0,githubBranchPolicyCreates: 0,s3BindingPuts: 0,gitPushes: 0,changeSetCreates: 0,changeSetExecutes: 0,
    automaticDispatches: 0,sourceSecretValueReads: 0,originalPrivateReads: 0 };
  const send = (client,q) => client.send(q,{ abortSignal: AbortSignal.timeout(30000) });
  const record = async (name,v) => { assertEvidenceSafeV5(v); await writePublicOnceV5(output,name,v); };
  async function gh(method,suffix,body) {
    token ??= await githubCredential();
    const r = await fetch('https://api.github.com/' + suffix,{ method,headers: { authorization: 'Bearer ' + token,
      accept: 'application/vnd.github+json','content-type': 'application/json','x-github-api-version': '2022-11-28','user-agent': 'Techlong-Reviewed-W5f' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),redirect: 'error',signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw Object.assign(Error('ACTIVATION_GITHUB_STATUS'),{ status: r.status });
    return r.status === 204 ? null : r.json();
  }
  const repo = 'repos/veinyyxy/TechlongSoftware', envPath = repo + '/environments/' + A.environment;
  async function githubSnapshot() {
    const [repository,actor,branch,environments,oidcSubject] = await Promise.all([gh('GET',repo),gh('GET','user'),gh('GET',repo + '/branches/main'),
      gh('GET',repo + '/environments?per_page=100'),gh('GET',repo + '/actions/oidc/customization/sub')]);
    return { repository,actor: { id: actor.id,login: actor.login },main: branch.commit.sha,environments,oidcSubject };
  }
  async function bindingAbsent() {
    const l = await send(s3,new s3api.ListObjectVersionsCommand({ Bucket: A.evidenceBucket,ExpectedBucketOwner: '402010193138',Prefix: A.bindingKey,MaxKeys: 2 }));
    return !l.IsTruncated && !l.Versions?.length && !l.DeleteMarkers?.length;
  }
  async function environment() { return verifyEnvironmentV5(await gh('GET',envPath),await gh('GET',envPath + '/deployment-branch-policies?per_page=100')); }
  async function verifyPublished(ref) {
    must(ref.key === A.bindingKey && ref.installationSha256 === binding.installationSha256 && /^[A-Za-z0-9._-]{1,256}$/.test(ref.versionId),'BINDING_REFERENCE');
    const o = await send(s3,new s3api.GetObjectCommand({ Bucket: A.evidenceBucket,ExpectedBucketOwner: '402010193138',Key: A.bindingKey,VersionId: ref.versionId }));
    must(o.VersionId === ref.versionId && o.ServerSideEncryption === 'AES256' && o.ContentLength > 0 && o.ContentLength < 10000,'BINDING_METADATA');
    const value = JSON.parse(await o.Body.transformToString()); must(same(value,binding) && await sha256Hex(value) === ref.sha256,'BINDING_EXACT_BODY');
    return { key: ref.key,versionId: ref.versionId,sha256: ref.sha256 };
  }
  async function verifyActivatedFoundation(m) {
    const template = m.actions.foundation.template, [a,st,t,rs,inline,names,attached,boundary,bucketPolicy,ttl] = await Promise.all([
      readAwsInstallInventoryV5(),send(cfClient,new cf.DescribeStacksCommand({ StackName: R.stackId })),
      send(cfClient,new cf.GetTemplateCommand({ StackName: R.stackId,TemplateStage: 'Original' })),send(cfClient,new cf.ListStackResourcesCommand({ StackName: R.stackId })),
      send(iamClient,new iam.GetRolePolicyCommand({ RoleName: 'TechlongSandboxGitHubDeploymentWorkerRole',PolicyName: 'ExactSandboxWorkerV5' })),
      send(iamClient,new iam.ListRolePoliciesCommand({ RoleName: 'TechlongSandboxGitHubDeploymentWorkerRole' })),
      send(iamClient,new iam.ListAttachedRolePoliciesCommand({ RoleName: 'TechlongSandboxGitHubDeploymentWorkerRole' })),
      send(iamClient,new iam.GetPolicyVersionCommand({ PolicyArn: C.boundary,VersionId: 'v1' })),
      send(s3,new s3api.GetBucketPolicyCommand({ Bucket: A.evidenceBucket,ExpectedBucketOwner: '402010193138' })),
      send(ddb,new DescribeTimeToLiveCommand({ TableName: 'techlong-sandbox-deployment-worker-journal-v1' }))]);
    const role = a.workerRole?.value?.Role,table = a.journal?.value?.Table,s = st.Stacks?.[0];
    must(a.source?.Arn === 'arn:aws:iam::402010193138:user/techlong-sandbox-dev' && a.preservedIam?.iamLayoutUnchanged === true &&
      st.Stacks.length === 1 && s.StackId === R.stackId && s.StackStatus === 'UPDATE_COMPLETE' && s.EnableTerminationProtection === true && s.DisableRollback === true &&
      same(JSON.parse(t.TemplateBody),template) && !rs.NextToken && rs.StackResourceSummaries?.length === 5 && rs.StackResourceSummaries.every(r =>
        template.Resources[r.LogicalResourceId]?.Type === r.ResourceType && ['CREATE_COMPLETE','UPDATE_COMPLETE'].includes(r.ResourceStatus)) &&
      role?.RoleId === R.roleId && same(decode(role.AssumeRolePolicyDocument),template.Resources.WorkerRole.Properties.AssumeRolePolicyDocument) &&
      role.MaxSessionDuration === 3600 && role.PermissionsBoundary?.PermissionsBoundaryArn === C.boundary &&
      !names.IsTruncated && same(names.PolicyNames,['ExactSandboxWorkerV5']) && !attached.IsTruncated && attached.AttachedPolicies?.length === 0 &&
      same(decode(inline.PolicyDocument),workerPermissionsV5(capsule)) && a.boundary?.value?.Policy?.DefaultVersionId === 'v1' &&
      same(decode(boundary.PolicyVersion.Document),template.Resources.Boundary.Properties.PolicyDocument) &&
      table?.TableId === R.tableId && table.DeletionProtectionEnabled === true && table.TableStatus === 'ACTIVE' &&
      table.BillingModeSummary?.BillingMode === 'PAY_PER_REQUEST' && same(table.KeySchema,template.Resources.Journal.Properties.KeySchema) &&
      !table.GlobalSecondaryIndexes?.length && !table.LocalSecondaryIndexes?.length && ttl.TimeToLiveDescription?.TimeToLiveStatus === 'DISABLED' &&
      same(JSON.parse(bucketPolicy.Policy),evidenceBucketPolicyV5()),'ACTIVATED_LAYOUT');
    await createEvidencePortV5((q,signal) => s3.send(q,{ abortSignal: signal })).verify(AbortSignal.timeout(60000));
    for (const [i,r] of R.secrets.entries()) {
      const [d,p,v] = await Promise.all([send(sm,new DescribeSecretCommand({ SecretId: r.arn })),send(sm,new GetResourcePolicyCommand({ SecretId: r.arn })),
        send(sm,new ListSecretVersionIdsCommand({ SecretId: r.arn,IncludeDeprecated: true,MaxResults: 100 }))]);
      assessContinuationSecretV5(i,d,p,v,'fixed');
    }
    const ownerUrl = parseEnv(await readFile(new URL('../../../.env.local',import.meta.url),'utf8')).DATABASE_URL,u = new URL(ownerUrl);
    must(['postgres:','postgresql:'].includes(u.protocol) && decodeURIComponent(u.username) === 'neondb_owner' && u.password &&
      /^ep-[a-z0-9-]+\.[a-z0-9.-]+\.neon\.tech$/.test(u.hostname) && (!u.port || u.port === '5432') &&
      /^\/[A-Za-z0-9_-]{1,63}$/.test(u.pathname) && ['require','verify-full'].includes(u.searchParams.get('sslmode')) &&
      await sha256Hex({ host: u.hostname,port: 5432,database: u.pathname.slice(1),role: 'techlong_cloud_worker_v5',transport: 'NeonHTTPS' }) === binding.neon.endpointSha256,'NEON_ENDPOINT');
    const query = NEON_CATALOG_SQL_V5.replace('current_user AS current_user, session_user AS session_user','r.rolname::text AS current_user, r.rolname::text AS session_user')
      .replace('r.rolname=current_user',"r.rolname='techlong_cloud_worker_v5'");
    const sql = neon(ownerUrl,{ fullResults: true }),[v] = await sql.transaction(tx => [tx.query(query,[])],{ isolationLevel: 'RepeatableRead',readOnly: true,
      fetchOptions: { signal: AbortSignal.timeout(30000) } });
    must(v.rowCount === 1,'NEON_ROW'); await verifyNeonCatalogV5(v.rows[0],await loadNeonContractV5(),binding.neon);
    return { roleId: R.roleId,tableId: R.tableId,stackId: R.stackId,trustReusesCommit: m.actions.release.reusable.commit,oldIamUnchanged: true,
      boundaryVersion: 'v1',secretsFixedVersionsVerified: true,neonMetadataVerified: true,secretValueReads: 0 };
  }
  return Object.freeze({
    async preflight() {
      label = 'LockedInstalledPreflight'; const p = await installed.inspectPartial(), installedProof = await installed.inspectInstalled(binding.neon);
      const github = await githubSnapshot(), absent = await bindingAbsent();
      return { installed: p,installedProof,github,bindingObjectAbsent: absent,currentInstallationSha256: binding.installationSha256,finishedAt: Date.now() };
    },
    async consumeSlot(v) { await writeFile(A.slot,JSON.stringify(v) + '\n',{ flag: 'wx',flush: true }); },
    setGuard(fn) { must(!guardSet,'GUARD_ONCE'); guard = fn; guardSet = true; },record,checkpoint: () => label,counts: () => ({ ...counts }),
    async createEnvironment() {
      await guard(); must(counts.githubEnvironmentPuts++ === 0,'ENVIRONMENT_ONCE'); label = 'EnvironmentPut';
      const e = await gh('PUT',envPath,ENVIRONMENT_BODY_V5); await record('environment-api-ack',{ environmentId: e.id,name: e.name });
      return { environmentId: e.id,name: e.name };
    },
    async createBranchPolicy() {
      await guard(); must(counts.githubBranchPolicyCreates++ === 0,'BRANCH_ONCE'); label = 'MainBranchPolicyCreate';
      const p = await gh('POST',envPath + '/deployment-branch-policies',BRANCH_BODY_V5); await record('branch-api-ack',{ policyId: p.id,name: p.name });
      return environment();
    },
    async publishBinding(value) {
      must(await bindingAbsent(),'PUBLICATION_ABSENT'); await guard(); must(counts.s3BindingPuts++ === 0,'PUBLICATION_ONCE'); label = 'PublicBindingPut';
      const sha256 = await sha256Hex(value),r = await send(s3,new s3api.PutObjectCommand({ Bucket: A.evidenceBucket,ExpectedBucketOwner: '402010193138',Key: A.bindingKey,
        Body: canonicalJson(value),ContentType: 'application/json',ServerSideEncryption: 'AES256',IfNoneMatch: '*',ChecksumSHA256: Buffer.from(sha256,'hex').toString('base64') }));
      must(r.VersionId && r.ServerSideEncryption === 'AES256','PUBLICATION_ACK'); publication = { key: A.bindingKey,versionId: r.VersionId,sha256,installationSha256: binding.installationSha256 };
      await record('publication-api-ack',publication); await verifyPublished(publication); return publication;
    },
    async publishRelease(release) {
      await assertReleaseObjectsV5(release); await environment();
      must((await gh('GET',repo + '/branches/main')).commit.sha === release.sourceCommit &&
        (await gitLocalV5(['remote','get-url','--push','github'])).trim() === 'https://github.com/veinyyxy/TechlongSoftware.git','MAIN_OR_REMOTE_DRIFT');
      await guard(); must(counts.gitPushes++ === 0,'PUSH_ONCE'); label = 'PreparedMainFastForward';
      await gitLocalV5(['push','github',release.pushRefspec]); await record('release-push-ack',{ main: release.caller.commit,reusable: release.reusable.commit });
      must((await gh('GET',repo + '/branches/main')).commit.sha === release.caller.commit,'REMOTE_RELEASE_ACK');
      return { main: release.caller.commit,reusable: release.reusable.commit,runtime: release.runtimeCommit };
    },
    async createChangeSet(template,sha) {
      await installed.inspectInstalled(binding.neon);
      await guard(); must(counts.changeSetCreates++ === 0,'CHANGESET_ONCE'); label = 'TrustChangeSetCreate';
      const r = await send(cfClient,new cf.CreateChangeSetCommand({ StackName: R.stackId,ChangeSetName: 'worker-activation-v5-' + sha.slice(0,24),
        ChangeSetType: 'UPDATE',TemplateBody: JSON.stringify(template),Capabilities: ['CAPABILITY_NAMED_IAM'],ClientToken: sha }));
      must(r.StackId === R.stackId && r.Id?.startsWith('arn:aws:cloudformation:ca-central-1:402010193138:changeSet/'),'CHANGESET_ACK');
      pendingTemplate = template; pendingChangeSet = r.Id;
      await record('changeset-create-ack',{ id: r.Id,stackId: r.StackId,requestedType: 'UPDATE' });
      for (let i = 0; i < 20; i++) {
        const d = await send(cfClient,new cf.DescribeChangeSetCommand({ ChangeSetName: r.Id,StackName: R.stackId }));
        if (d.Status === 'CREATE_COMPLETE') {
          must(d.ChangeSetId === r.Id,'CHANGESET_EXACT_ID');
          const actual = await send(cfClient,new cf.GetTemplateCommand({ StackName: R.stackId,ChangeSetName: r.Id,TemplateStage: 'Original' }));
          must(same(JSON.parse(actual.TemplateBody),template),'CHANGESET_EXACT_TEMPLATE');
          return verifyActivationChangeSetV5(d,R.stackId,'TechlongSandboxGitHubDeploymentWorkerRole');
        }
        must(['CREATE_PENDING','CREATE_IN_PROGRESS'].includes(d.Status),'CHANGESET_STOPPED'); await sleep(2000);
      } throw Error('ACTIVATION_CHANGESET_PENDING_INSPECT_ONLY');
    },
    async executeChangeSet(ref) {
      must(ref.changeSetId === pendingChangeSet && pendingTemplate,'CHANGESET_SUBMITTED_IN_THIS_RUN');
      verifyActivationChangeSetV5(await send(cfClient,new cf.DescribeChangeSetCommand({ ChangeSetName: ref.changeSetId,StackName: R.stackId })),R.stackId,'TechlongSandboxGitHubDeploymentWorkerRole');
      const actual = await send(cfClient,new cf.GetTemplateCommand({ StackName: R.stackId,ChangeSetName: ref.changeSetId,TemplateStage: 'Original' }));
      must(same(JSON.parse(actual.TemplateBody),pendingTemplate),'CHANGESET_EXACT_TEMPLATE');
      await installed.inspectInstalled(binding.neon);
      await guard(); must(counts.changeSetExecutes++ === 0,'EXECUTE_ONCE'); label = 'TrustChangeSetExecute';
      await send(cfClient,new cf.ExecuteChangeSetCommand({ StackName: R.stackId,ChangeSetName: ref.changeSetId,DisableRollback: true }));
      await record('changeset-execute-ack',{ id: ref.changeSetId,stackId: R.stackId,disableRollback: true });
      for (let i = 0; i < 40; i++) {
        const r = await send(cfClient,new cf.DescribeStacksCommand({ StackName: R.stackId })),s = r.Stacks?.[0]?.StackStatus;
        if (s === 'UPDATE_COMPLETE') return { stackId: R.stackId,status: s };
        must(['UPDATE_IN_PROGRESS','UPDATE_COMPLETE_CLEANUP_IN_PROGRESS'].includes(s),'STACK_STOPPED'); await sleep(2500);
      } throw Error('ACTIVATION_STACK_PENDING_INSPECT_ONLY');
    },
    async inspectActivated(m,ref = publication) {
      label = 'IndependentActivatedMetadata'; const g = await githubSnapshot();
      must(g.main === m.actions.release.caller.commit && same(g.oidcSubject,m.prestate.github.oidcSubject),'REMOTE_OR_SUBJECT_DRIFT');
      const e = await environment(),p = await verifyPublished(ref),foundation = await verifyActivatedFoundation(m);
      return { environment: e,publication: p,foundation,main: g.main,workflowDispatched: false,secretValueReads: 0 };
    },
    async inspectPartial() { return { installed: await partialReader.inspectPartial(),github: await githubSnapshot(),bindingAbsent: await bindingAbsent(),
      externalWrites: 0,secretValueReads: 0,originalPrivateReads: 0,retryAllowed: false }; },
    dispose() { token = undefined; installed.dispose(); partialReader.dispose(); for (const c of [cfClient,iamClient,s3,ddb,sm]) c.destroy(); },
  });
}
