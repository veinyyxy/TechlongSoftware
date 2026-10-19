import { inspectPlatformControllerPublicMetadata } from '../platform-controller-registration-v1.ts';
import { CONTROL_SCOPE as S, ControlError, assertExact, commit, must, obj, releaseReady, type ControlPlan, type ReleaseBinding } from './contract.ts';

const API = 'https://api.github.com';
const b64 = (bytes: Uint8Array) => btoa(Array.from(bytes, b => String.fromCharCode(b)).join('')).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
const encode = (v: unknown) => b64(new TextEncoder().encode(JSON.stringify(v)));
function der(tag: number, body: Uint8Array): Uint8Array {
  const length: number[] = []; let n = body.length;
  do { length.unshift(n & 255); n >>>= 8; } while (n);
  return new Uint8Array([tag, ...(body.length < 128 ? [body.length] : [128 + length.length, ...length]), ...body]);
}
export async function signAppJwt(pem: string, now: number): Promise<string> {
  must(typeof pem === 'string' && pem.length <= 16000 && Number.isSafeInteger(now) && now > 0, 'CONTROL_KEY_FORMAT');
  const match = /^-----BEGIN (RSA PRIVATE KEY|PRIVATE KEY)-----\s*([A-Za-z0-9+/=\r\n]+)\s*-----END \1-----\s*$/.exec(pem);
  must(match, 'CONTROL_KEY_FORMAT');
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(match[2].replace(/\s/g,'')), c => c.charCodeAt(0)); } catch { throw new ControlError('CONTROL_KEY_FORMAT'); }
  if (match[1] === 'RSA PRIVATE KEY') bytes = der(48, new Uint8Array([2,1,0,48,13,6,9,42,134,72,134,247,13,1,1,1,5,0,...der(4,bytes)]));
  try {
    const key = await crypto.subtle.importKey('pkcs8', bytes.slice().buffer, { name:'RSASSA-PKCS1-v1_5',hash:'SHA-256' }, false, ['sign']);
    must((key.algorithm as RsaHashedKeyAlgorithm).modulusLength >= 2048, 'CONTROL_KEY_STRENGTH');
    const seconds = Math.floor(now / 1000), body = encode({alg:'RS256',typ:'JWT'}) + '.' + encode({iat:seconds-60,exp:seconds+480,iss:S.appId});
    return body + '.' + b64(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(body))));
  } catch (e) { if (e instanceof ControlError) throw e; throw new ControlError('CONTROL_KEY_FORMAT'); }
  finally { bytes.fill(0); } // Strings/CryptoKey memory cannot be guaranteed erased.
}
export interface RunAck { runId: string; url: string }
export interface RunObservation { status: string; conclusion: string | null; runId: string; url: string }
export interface GitHubController {
  dispatch(plan: ControlPlan, beforePost: () => Promise<void>, onAck: (ack: RunAck) => Promise<void>): Promise<RunAck>;
  observe(plan: ControlPlan, runId: string): Promise<RunObservation>;
}
type InstallationCheck = ReturnType<typeof inspectPlatformControllerPublicMetadata> & {
  tokenRepositoryScopeVerified: true; installationRepositoryCountVerified: false;
};
export function createGitHubController(deps: { release: ReleaseBinding; privateKey: () => Promise<string>;
  fetch: typeof fetch; now?: () => number }): GitHubController & {inspectInstallation:()=>Promise<InstallationCheck>} {
  const now = deps.now ?? Date.now;
  async function request(path: string, token: string, method = 'GET', body?: unknown) {
    let response: Response;
    try { response = await deps.fetch(API + path, { method, redirect:'error', cache:'no-store', signal:AbortSignal.timeout(20000),
      headers: {accept:'application/vnd.github+json',authorization:'Bearer '+token,'X-GitHub-Api-Version':'2026-03-10',
        'content-type':'application/json','user-agent':'Techlong-Platform-Controller-V6'}, ...(body === undefined ? {} : {body:JSON.stringify(body)}) });
    } catch { throw new ControlError('CONTROL_GITHUB_UNKNOWN',503); }
    if (method === 'DELETE') { must(response.status === 204, 'CONTROL_TOKEN_REVOKE_UNCONFIRMED',503); return {}; }
    must(response.status === (method === 'POST' && path.endsWith('/access_tokens') ? 201 : 200), 'CONTROL_GITHUB_RESPONSE',503);
    const reader = response.body?.getReader(); must(reader, 'CONTROL_GITHUB_BODY',503);
    const chunks: Uint8Array[] = []; let size = 0;
    try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength;
      if (size > 256000) { await reader.cancel(); throw new ControlError('CONTROL_GITHUB_SIZE',503); } chunks.push(part.value); }
    } finally { reader.releaseLock(); }
    const all = new Uint8Array(size); let at = 0; for (const chunk of chunks) { all.set(chunk,at); at += chunk.byteLength; }
    try { return obj(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(all))); } catch { throw new ControlError('CONTROL_GITHUB_BODY',503); }
  }
  async function session<T>(write: boolean, operation: (token: string, identity: ReturnType<typeof inspectPlatformControllerPublicMetadata>) => Promise<T>, verificationOnly=false): Promise<T> {
    must(verificationOnly ? !write : releaseReady(deps.release), 'CONTROL_RELEASE_UNPUBLISHED');
    const jwt = await signAppJwt(await deps.privateKey(),now());
    const app = await request('/app',jwt), installation = await request(`/app/installations/${S.installationId}`,jwt);
    must(String(app.id) === S.appId && String(installation.id) === S.installationId, 'CONTROL_APP_IDENTITY');
    // Validate all App/installation permissions before minting a token. Repository
    // selection is independently checked with the token immediately afterwards.
    assertExact(app.permissions,{actions:'write',contents:'read',metadata:'read'},'CONTROL_APP_PERMISSIONS');
    assertExact(installation.permissions,app.permissions,'CONTROL_INSTALLATION_PERMISSIONS');
    must(installation.repository_selection === 'selected' && installation.suspended_at === null &&
      String(installation.app_id) === S.appId && installation.app_slug === 'techlong-sandbox-controller' &&
      String(obj(installation.account).id) === S.ownerId && String(installation.target_id) === S.ownerId,
    'CONTROL_INSTALLATION_SCOPE');
    const permissions = { actions:write?'write':'read',contents:'read',metadata:'read' };
    const issued = await request(`/app/installations/${S.installationId}/access_tokens`,jwt,'POST',
      {repository_ids:[Number(S.repositoryId)],permissions});
    // Retain any returned token before validation so even an overbroad/malformed
    // successful response is revoked once, without dispatch or token retry.
    const token = typeof issued.token === 'string' ? issued.token : '';
    must(token.length > 0 && token.length <= 16000, 'CONTROL_TOKEN_RESPONSE',503);
    try {
      assertExact(issued.permissions,permissions,'CONTROL_TOKEN_PERMISSIONS');
      const expiry = Date.parse(String(issued.expires_at));
      must(Number.isSafeInteger(expiry) && expiry > now()+60000 && expiry <= now()+3660000, 'CONTROL_TOKEN_EXPIRY');
      const repositories = await request('/installation/repositories',token);
      // This authenticates the App but does not establish the actual workflow actor.
      const bot=await request('/users/techlong-sandbox-controller%5Bbot%5D',token);
      must(String(bot.id)===S.candidateBotId,'CONTROL_CANDIDATE_BOT');
      const identity=inspectPlatformControllerPublicMetadata({app,installation,repositories,bot});
      return await operation(token,identity);
    } finally { await request('/installation/token',token,'DELETE'); }
  }
  return {
    // No HTTP route invokes this. A separately approved one-time key read/token
    // verification can use it before publication; it never dispatches anything.
    async inspectInstallation() { return session(false,async(_token,identity)=>({...identity,
      tokenRepositoryScopeVerified:true as const,installationRepositoryCountVerified:false as const}),true); },
    async dispatch(plan,beforePost,onAck) {
      return session(true,async token => {
        const head = await request(`/repos/${S.repository}/git/ref/heads/main`,token);
        must(obj(head.object).sha === plan.sourceCommit && commit(plan.sourceCommit), 'CONTROL_MAIN_DRIFT');
        const workflow = await request(`/repos/${S.repository}/actions/workflows/${S.workflowFile}`,token);
        must(String(workflow.id) === deps.release.workflowId && workflow.state === 'active' &&
          workflow.path === `.github/workflows/${S.workflowFile}`, 'CONTROL_WORKFLOW_DRIFT');
        await beforePost(); // Last deadline/ledger check, after authentication latency.
        const ack = await request(`/repos/${S.repository}/actions/workflows/${S.workflowFile}/dispatches`,token,'POST',
          {ref:'main',return_run_details:true,inputs:plan.inputs});
        must(typeof ack.workflow_run_id === 'number' && Number.isSafeInteger(ack.workflow_run_id) && ack.workflow_run_id > 0,
          'CONTROL_ACK_UNKNOWN',503);
        const runId = String(ack.workflow_run_id), url = `https://github.com/${S.repository}/actions/runs/${runId}`;
        must(ack.html_url === url && ack.run_url === `${API}/repos/${S.repository}/actions/runs/${runId}`, 'CONTROL_ACK_UNKNOWN',503);
        const result = {runId,url};
        await onAck(result); // Durable ACK before credential cleanup can fail.
        return result;
      });
    },
    async observe(plan,runId) {
      must(/^[1-9][0-9]{0,15}$/.test(runId), 'CONTROL_RUN_ID');
      return session(false,async token => {
        const run = await request(`/repos/${S.repository}/actions/runs/${runId}`,token), repo = obj(run.repository);
        must(String(run.id) === runId && run.run_attempt === 1 && run.event === 'workflow_dispatch' && run.head_branch === 'main' &&
          run.head_sha === plan.sourceCommit && String(run.workflow_id) === deps.release.workflowId &&
          String(repo.id) === S.repositoryId && repo.full_name === S.repository && String(obj(repo.owner).id) === S.ownerId &&
          String(obj(run.actor).id) === deps.release.actorId && String(obj(run.triggering_actor).id) === deps.release.actorId,
        'CONTROL_RUN_IDENTITY');
        must(Array.isArray(run.referenced_workflows) && run.referenced_workflows.some((raw: unknown) => {
          const w = obj(raw); return w.sha === deps.release.reusableCommit && w.path === `${S.repository}/.github/workflows/cloud-worker-platform-job-v6.yml@${deps.release.reusableCommit}`;
        }), 'CONTROL_REUSABLE_IDENTITY');
        const statuses = ['queued','requested','waiting','pending','in_progress','completed'];
        const conclusions = ['success','failure','cancelled','timed_out','action_required','neutral','skipped','stale','startup_failure'];
        must(statuses.includes(String(run.status)) && (run.status === 'completed' ? conclusions.includes(String(run.conclusion)) : run.conclusion === null), 'CONTROL_RUN_STATUS');
        return {status:String(run.status),conclusion:run.conclusion as string|null,runId,url:`https://github.com/${S.repository}/actions/runs/${runId}`};
      });
    },
  };
}
