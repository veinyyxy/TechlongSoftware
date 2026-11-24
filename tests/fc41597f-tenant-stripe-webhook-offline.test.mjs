import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

// Deliberately standalone: reads the checked-out backend route and its
// locally available fixed provider commit, never provider credentials.
const backendRoot = 'E:/NodejsProject/SpeedFeast_Backend_main';
const fixedA = 'b9ca2138738900afc23a6a2ddce141b37a1f0a31';
const routeFile = process.env.FIRST_OPEN_STRIPE_ROUTE_PATH || `${backendRoot}/routes/payments.js`;
const gitDir = process.env.FIRST_OPEN_STRIPE_BACKEND_GIT_DIR || `${backendRoot}/.git`;
const sources = { route: readFileSync(routeFile, 'utf8') };
for (const file of ['payment_provider', 'stripe_provider']) {
  sources[file] = execFileSync('git', [`--git-dir=${gitDir}`, 'show', `${fixedA}:services/payments/${file}.js`],
    { encoding: 'utf8' });
}

const signingFixture = 'only-used-in-this-offline-fixture';
const local = Object.freeze({
  provider: 'stripe', provider_session_id: 'cs_test_local_fixture', provider_payment_id: 'pi_local_fixture',
  payment_id: 'ae70145f-2565-447f-a81d-bf048abe4650', order_id: 'ae70145f-2565-447f-a81d-bf048abe4651',
  store_id: 'ae70145f-2565-447f-a81d-bf048abe4652',
});
const webhookPath = '/payments/webhook/stripe';

function evaluate(source, dependencies = {}) {
  const scriptModule = { exports: {} };
  runInNewContext(source, { module: scriptModule, Buffer, process: { env: {} }, console: { error() {} }, require(name) {
    assert.ok(Object.hasOwn(dependencies, name), `unexpected module ${name}`);
    return dependencies[name];
  } });
  return scriptModule.exports;
}

const StripeProvider = evaluate(sources.stripe_provider, {
  crypto, './payment_provider': evaluate(sources.payment_provider),
});

function optionValue(sql, values, column) {
  const m = new RegExp(`\\b${column}(?:::text)?\\s*=\\s*(lower\\()?\\$(\\d+)`).exec(sql);
  const value = m ? values[Number(m[2]) - 1] : null;
  return m?.[1] && typeof value === 'string' ? value.toLowerCase() : value;
}

async function deliver(type, object, { invalidSignature = false, payments = [local] } = {}) {
  const provider = new StripeProvider();
  provider.webhookSecret = signingFixture;
  const ops = [];
  const hooks = [];
  let connections = 0, releases = 0;
  const client = {
    async query(statement, values = []) {
      const sql = statement.trim().replace(/\s+/g, ' ');
      const args = Array.from(values);
      ops.push({ sql, args });
      if (/^SELECT\s/i.test(sql) && /\bFROM public\.payments\b/i.test(sql)) {
        assert.match(sql, /\bFOR UPDATE\b/i);
        assert.match(sql, /\bprovider = 'stripe'/i);
        const source = optionValue(sql, args, 'provider_session_id');
        const intent = optionValue(sql, args, 'provider_payment_id');
        assert.ok(source || intent, 'lookup must bind a provider object ID');
        if (source) assert.equal(source, object.id);
        if (intent) assert.equal(intent, type === 'charge.refunded' ? object.payment_intent : object.id);
        const paymentHint = optionValue(sql, args, 'payment_id');
        const orderHint = optionValue(sql, args, 'order_id');
        const rows = payments.filter(p => p.provider === 'stripe' &&
          (!source || source === p.provider_session_id) && (!intent || intent === p.provider_payment_id) &&
          (!paymentHint || paymentHint === p.payment_id) && (!orderHint || orderHint === p.order_id));
        return { rows, rowCount: rows.length };
      }
      if (/^UPDATE public\.payments\b/i.test(sql)) {
        const rows = payments.filter(p => p.payment_id === optionValue(sql, args, 'payment_id'));
        return { rows: rows.map(p => ({ ...p })), rowCount: rows.length };
      }
      if (/^(?:BEGIN|COMMIT|ROLLBACK)$|^UPDATE public\."Order"\s|^INSERT INTO public\.payment_events\b/i.test(sql)) {
        return { rows: [], rowCount: 0 };
      }
      assert.fail(`unexpected SQL: ${sql}`);
    },
    release() { ++releases; },
  };
  const posts = new Map();
  evaluate(sources.route, {
    express: { Router: () => ({ post: (path, fn) => posts.set(path, fn), get() {} }) },
    '../db/pgsql': { pool: { async connect() { ++connections; return client; } } },
    '../secutiry/verify_signature': {},
    '../services/payments': { getPaymentProvider(name) { assert.equal(name, 'stripe'); return provider; } },
    '../services/merchant_notifications': {
      async recordNewPaidOrderNotification() { hooks.push('record-merchant'); return { queued: false }; },
      sendMerchantNotificationInBackground() { hooks.push('send-merchant'); },
    },
    '../services/buyer_notifications': {
      async recordBuyerPointsReversedNotification() { hooks.push('record-buyer'); return { queued: false }; },
      sendBuyerNotificationsInBackground() { hooks.push('send-buyer'); },
    },
    '../services/order_automation': { async autoStartOrder() { hooks.push('start-order'); return {}; } },
    '../services/rewards': {
      async restoreOrderRewardRedemptions() { hooks.push('restore-rewards'); },
      async reversePointsForOrder() { hooks.push('reverse-points'); return { reversed: false }; },
    },
  });
  assert.equal(typeof posts.get(webhookPath), 'function');
  const body = Buffer.from(JSON.stringify({ id: 'evt_test_fixture', type, data: { object } }));
  const timestamp = Math.floor(Date.now() / 1000);
  const digest = crypto.createHmac('sha256', invalidSignature ? 'wrong-fixture' : signingFixture)
    .update(`${timestamp}.${body.toString('utf8')}`).digest('hex');
  let status, response;
  await posts.get(webhookPath)({ body, headers: { 'stripe-signature': `t=${timestamp},v1=${digest}` } }, {
    status(code) { status = code; return this; },
    json(value) { response = value; return this; },
  });
  return { status, response, connections, releases, ops, hooks };
}

function assertNoWrites(result) {
  assert.equal(result.status, 200);
  assert.equal(result.response.received, true);
  assert.equal(result.connections, result.releases);
  assert.deepEqual(result.hooks, []);
  assert.ok(result.ops.every(({ sql }) => !/\b(?:INSERT|DELETE)\b|^UPDATE\b/i.test(sql)));
}

test('Stripe signature failure returns 400 before database access', async () => {
  const result = await deliver('payment_intent.succeeded', { id: 'pi_foreign' }, { invalidSignature: true });
  assert.equal(result.status, 400);
  assert.equal(result.connections, 0);
  assert.deepEqual(result.ops, []);
});

test('a supported signature with no handled update is acknowledged without a connection', async () => {
  const result = await deliver('refund.updated', { id: 're_foreign' });
  assertNoWrites(result);
  assert.equal(result.connections, 0);
  assert.deepEqual(result.ops, []);
});

test('a foreign PaymentIntent sees only the lookup and no persistence', async () => {
  const result = await deliver('payment_intent.succeeded', { id: 'pi_foreign' });
  assertNoWrites(result);
  assert.equal(result.ops.filter(({ sql }) => /^SELECT\b/i.test(sql)).length, 1);
  assert.deepEqual(result.ops.map(({ sql }) => sql.split(' ')[0]), ['BEGIN', 'SELECT', 'ROLLBACK']);
});

test('platform Checkout with an ord_ subscription reference cannot reach a tenant UUID cast or event ledger', async () => {
  const result = await deliver('checkout.session.completed', {
    id: 'cs_test_platform_fixture', payment_intent: 'pi_platform_fixture', client_reference_id: 'ord_platform_subscription_fixture',
    metadata: { subscription_purchase_order_id: 'ord_platform_subscription_fixture' },
  });
  assertNoWrites(result);
  assert.ok(result.ops.every(({ sql }) => !/::uuid\b/i.test(sql)));
});

test('a conflicting provider object remains foreign despite a local payment UUID in metadata', async () => {
  const result = await deliver('payment_intent.succeeded', { id: 'pi_foreign', metadata: { payment_id: local.payment_id } });
  assertNoWrites(result);
  assert.equal(result.ops.filter(({ sql }) => /^SELECT\b/i.test(sql)).length, 1);
});

test('a provider reference with a mismatching order hint or ambiguous local rows remains unmodified', async () => {
  const wrongOrder = await deliver('payment_intent.succeeded', { id: local.provider_payment_id, metadata: { order_id: 'ord_foreign' } });
  const ambiguous = await deliver('payment_intent.succeeded', { id: local.provider_payment_id }, {
    payments: [local, { ...local, payment_id: 'ae70145f-2565-447f-a81d-bf048abe4653' }],
  });
  assertNoWrites(wrongOrder);
  assertNoWrites(ambiguous);
});

test('a matched event preserves order handling and uses only the matched local identifiers in the event ledger', async () => {
  const result = await deliver('checkout.session.completed', { id: local.provider_session_id,
    payment_intent: local.provider_payment_id, metadata: { payment_id: local.payment_id, order_id: local.order_id } });
  assert.equal(result.status, 200);
  assert.equal(result.response.received, true);
  assert.equal(result.connections, 1);
  assert.equal(result.releases, 1);
  assert.equal(result.ops.at(-1).sql, 'COMMIT');
  assert.ok(result.hooks.includes('start-order'));
  const ledger = result.ops.filter(({ sql }) => /^INSERT INTO public\.payment_events\b/i.test(sql));
  assert.equal(ledger.length, 1);
  assert.doesNotMatch(ledger[0].sql, /default_store_id|COALESCE|SELECT/i);
  assert.deepEqual(ledger[0].args.slice(0, 6), [local.store_id, 'stripe', 'evt_test_fixture', 'checkout.session.completed',
    local.order_id, local.payment_id]);
});
