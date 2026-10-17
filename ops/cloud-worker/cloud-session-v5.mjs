// No credential discovery, disk, shell, OIDC exchange or identity call here.
export const CLOUD_V5 = Object.freeze({ account: '402010193138', region: 'ca-central-1',
  repository: 'veinyyxy/TechlongSoftware', roleName: 'TechlongSandboxGitHubDeploymentWorkerRole',
  roleArn: 'arn:aws:iam::402010193138:role/TechlongSandboxGitHubDeploymentWorkerRole' });
export function requireCloudV5(value, code) { if (!value) throw Error('CLOUD_WORKER_V5_' + code); }
const must = requireCloudV5;
const liveSessions = new WeakSet();
export function createCloudSessionV5({ credentials, expected, now = Date.now }) {
  must(typeof credentials === 'function', 'EXPLICIT_TEMPORARY_CREDENTIALS_REQUIRED');
  const e = structuredClone(expected);
  must(e && Object.keys(e).sort().join(',') === 'commitSha,repository,roleId,runAttempt,runId' &&
    e.repository === CLOUD_V5.repository && /^[a-f0-9]{40}$/.test(e.commitSha) &&
    typeof e.runId === 'string' && /^[1-9][0-9]{0,19}$/.test(e.runId) && Number.isSafeInteger(e.runAttempt) && e.runAttempt >= 1 &&
    typeof e.roleId === 'string' && /^AROA[A-Z0-9]{17}$/.test(e.roleId), 'CLOUD_IDENTITY_BINDING');
  const sessionName = `Deploy-${e.runId}-${e.runAttempt}`;
  must(sessionName.length <= 64, 'SESSION_NAME');
  const provider = async () => {
    try {
      const v = await credentials();
      must(v && typeof v.accessKeyId === 'string' && /^ASIA[A-Z0-9]{16}$/.test(v.accessKeyId) &&
        typeof v.secretAccessKey === 'string' && !!v.secretAccessKey && typeof v.sessionToken === 'string' && !!v.sessionToken &&
        v.expiration instanceof Date && v.expiration.getTime() > now() + 60000, 'TEMPORARY_SESSION_EXPIRED_OR_INVALID');
      return { accessKeyId: v.accessKeyId, secretAccessKey: v.secretAccessKey, sessionToken: v.sessionToken, expiration: new Date(v.expiration) };
    } catch { throw Error('CLOUD_WORKER_V5_TEMPORARY_CREDENTIALS_UNAVAILABLE'); }
  };
  const session = Object.freeze({
    summary: Object.freeze({ ...e, roleArn: CLOUD_V5.roleArn, sessionName, runtimeEnabled: false }),
    clientConfig(global = false) { return { credentials: provider, region: global ? 'us-east-1' : CLOUD_V5.region,
      maxAttempts: 1, ignoreConfiguredEndpointUrls: true }; },
    assertIdentity(who) {
      must(who?.Account === CLOUD_V5.account && who.Arn === `arn:aws:sts::${CLOUD_V5.account}:assumed-role/${CLOUD_V5.roleName}/${sessionName}` &&
        who.UserId === `${e.roleId}:${sessionName}`, 'ASSUMED_ROLE_IDENTITY_MISMATCH');
      return { account: CLOUD_V5.account, roleArn: CLOUD_V5.roleArn, roleId: e.roleId, sessionName };
    },
  });
  liveSessions.add(session); return session;
}
export function assertCloudSessionV5(session) { must(liveSessions.has(session), 'VALIDATED_SESSION_REQUIRED'); }
