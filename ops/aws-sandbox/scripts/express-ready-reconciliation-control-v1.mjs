import { loadExpressPrivateControlSourcesV1 } from '../../../lib/deployments/execution/express-private-control-v1.ts';
import { MtlsSaaSControlClient } from '../../../lib/deployments/execution/control-client.ts';
import { validateExpressControlReadinessPolicyV1 } from '../../../lib/deployments/execution/express-control-readiness-v1.ts';
import { hash, must, assertWindow } from './express-ready-reconciliation-plan-v1.mjs';

export function readyReadTransport(plan, delegate) {
  const used = {};
  return { counts: () => ({ ...used }), transport: Object.freeze({ async send(request, context) {
    context.signal.throwIfAborted(); assertWindow(plan, Date.now());
    let url; try { url = new URL(request.url); } catch { must(false, 'CONTROL_URL'); }
    const key = request.method + ' ' + url.pathname;
    must(request.method === 'GET' && ['GET /api/saas/readiness', 'GET /api/saas/control'].includes(key) && !used[key] &&
      url.protocol === 'https:' && url.hostname === plan.hostname && url.port === '8443' && !url.username && !url.password &&
      !url.search && !url.hash && request.body === undefined, 'READONLY_HTTP_SCOPE_OR_LIMIT');
    used[key] = 1; const response = await delegate.send(request, context);
    if (key === 'GET /api/saas/control' && response.status >= 200 && response.status < 300)
      must(response.body?.control?.stores?.length === 1 && response.body.control.stores[0].store_id === plan.storeId, 'EXACT_STORE_REQUIRED');
    return response;
  } }) };
}
/** New K2c read-only authority; neither copies/extends the consumed K2b runtime
 * window nor exposes compiler, password source, Secret API or POST capability. */
export async function openReadyReader({ base, plan }) {
  validateExpressControlReadinessPolicyV1(plan.controlPolicy);
  const sources = await loadExpressPrivateControlSourcesV1({ directory: 'F:/ChatGPT_workshop/techlong-d001-credentials-20261013-r2',
    plan: base.publicInputs.privatePlan });
  try {
    must(hash(sources.publicParameters) === plan.publicParametersSha256, 'PRIVATE_PUBLIC_PARAMETERS_CHANGED');
    const guarded = readyReadTransport(plan, sources.controlTransport), client = new MtlsSaaSControlClient(guarded.transport,
      sources.controlTokens, { baseDomain: 'sandbox.techlong.cloud', expressReadiness: plan.controlPolicy });
    return { async read(signal) {
      const observed = await client.readConfiguration({ appInstanceId: plan.historicalScope.appInstanceId, hostname: plan.hostname,
        externalFence: plan.externalFence, signal });
      must(observed.ready === true && observed.desiredConfigurationHash === plan.historicalScope.configurationHash &&
        observed.imageRevision === plan.controlPolicy.imageRevision, 'INITIALIZED_CONFIGURATION_NOT_PROVED'); return observed;
    }, counts: guarded.counts, dispose: () => sources.dispose() };
  } catch { sources.dispose(); throw Error('READY_RECONCILIATION_PRIVATE_OPEN_FAILED'); }
}
