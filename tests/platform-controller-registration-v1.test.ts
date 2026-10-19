import test from 'node:test';
import assert from 'node:assert/strict';
import { platformControllerRegistrationPlan, platformControllerRegistrationUrl,
  inspectPlatformControllerPublicMetadata } from '../lib/deployments/platform-controller-registration-v1.ts';

function fixture() {
  const p = platformControllerRegistrationPlan(), account = { ...p.owner, id: Number(p.owner.id) };
  const permissions = { ...p.permissions }, slug = 'techlong-sandbox-controller';
  return { app: { id: 90001, slug, name: p.name, external_url: p.homepage,
    html_url: `https://github.com/apps/${slug}`, owner: account, permissions, events: [] },
  installation: { id: 90002, app_id: 90001, app_slug: slug, target_id: account.id,
    target_type: 'User', account, repository_selection: 'selected', suspended_at: null, permissions, events: [] },
  repositories: { total_count: 1, repositories: [{ id: Number(p.repository.id), full_name: p.repository.fullName, owner: account }] },
  bot: { id: 90003, login: `${slug}[bot]`, type: 'Bot' } };
}

test('registration prefill is owner-only, no OAuth/webhook/credential and only two explicit permissions', () => {
  const url = new URL(platformControllerRegistrationUrl());
  assert.equal(url.origin, 'https://github.com'); assert.equal(url.pathname, '/settings/apps/new');
  assert.deepEqual([...url.searchParams.keys()].sort(), ['actions','contents','description','name','public','request_oauth_on_install','url','webhook_active']);
  for (const name of ['public','request_oauth_on_install','webhook_active']) assert.equal(url.searchParams.get(name), 'false');
  assert.equal(url.searchParams.get('actions'), 'write'); assert.equal(url.searchParams.get('contents'), 'read');
  const p = platformControllerRegistrationPlan(); p.permissions.actions = 'MUTATED';
  assert.equal(platformControllerRegistrationPlan().permissions.actions, 'write');
  assert.equal(platformControllerRegistrationPlan().requestedActions.length, 2);
});

test('matching public metadata yields only safe candidate IDs, never dispatch authority', () => {
  const f = fixture(), before = JSON.stringify(f), result = inspectPlatformControllerPublicMetadata(f);
  assert.equal(result.state, 'PUBLIC_METADATA_MATCH_ONLY'); assert.equal(result.appId, '90001');
  assert.equal(result.installationId, '90002'); assert.equal(result.candidateBotId, '90003');
  assert.equal(result.canDispatch, false); assert.equal(result.canApproveEnvironment, false); assert.equal(result.canDeploy, false);
  assert.equal(result.manualSettingsReviewRequired, true); assert.equal(result.dispatchActorObserved, false);
  assert.equal(JSON.stringify(f), before);
  const withPrivateField = { ...f, app: { ...f.app, private_key: 'NEVER_OUTPUT' } };
  assert.doesNotMatch(JSON.stringify(inspectPlatformControllerPublicMetadata(withPrivateField)), /NEVER_OUTPUT|private_key/);
});

test('different owner/repository, all-repository installation or suspension is rejected', () => {
  const cases = [
    (f: ReturnType<typeof fixture>) => { f.app.owner.id++; },
    (f: ReturnType<typeof fixture>) => { f.installation.repository_selection = 'all'; },
    (f: ReturnType<typeof fixture>) => { f.repositories.total_count = 2; },
    (f: ReturnType<typeof fixture>) => { f.repositories.repositories[0].id++; },
    (f: ReturnType<typeof fixture>) => { f.installation.target_id++; },
    (f: ReturnType<typeof fixture>) => { Object.assign(f.installation, { suspended_at: '2026-10-19T00:00:00Z' }); },
  ];
  for (const mutate of cases) { const f = fixture(); mutate(f); assert.throws(() => inspectPlatformControllerPublicMetadata(f), /METADATA_MISMATCH/); }
});

test('extra or changed permission, webhook events, mismatched App/bot and unsafe IDs are rejected', () => {
  const cases = [
    (f: ReturnType<typeof fixture>) => { Object.assign(f.app.permissions, { deployments: 'write' }); },
    (f: ReturnType<typeof fixture>) => { f.installation.permissions.contents = 'write'; },
    (f: ReturnType<typeof fixture>) => { Object.assign(f.app, { events: ['workflow_run'] }); },
    (f: ReturnType<typeof fixture>) => { f.installation.app_id++; },
    (f: ReturnType<typeof fixture>) => { f.bot.login = 'veinyyxy'; },
    (f: ReturnType<typeof fixture>) => { f.bot.id = Number.MAX_SAFE_INTEGER + 1; },
    (f: ReturnType<typeof fixture>) => { f.app.html_url = 'https://untrusted.invalid'; },
    (f: ReturnType<typeof fixture>) => { Object.assign(f.app, { owner: null, private_key: 'DO_NOT_LOG' }); },
  ];
  for (const mutate of cases) { const f = fixture(); mutate(f); assert.throws(() => inspectPlatformControllerPublicMetadata(f), { message: 'REGISTRATION_METADATA_MISMATCH' }); }
});
