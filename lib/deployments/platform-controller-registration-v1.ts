// Public configuration only. No credentials, network, dispatch or runtime gate.
export function platformControllerRegistrationPlan() {
  return {
    schema: 'techlong/platform-controller-registration-plan/v1',
    name: 'Techlong Sandbox Controller',
    description: 'Single-repository reviewed deployment controller; human environment approval remains required.',
    homepage: 'https://github.com/veinyyxy/TechlongSoftware',
    owner: { login: 'veinyyxy', id: '14145707', type: 'User' },
    repository: { fullName: 'veinyyxy/TechlongSoftware', id: '1323312747' },
    registration: { public: false, webhookActive: false, events: [] as string[],
      requestOauthOnInstall: false, callbackUrls: [] as string[], setupUrl: null },
    installation: { repositorySelection: 'selected', repositoryIds: ['1323312747'] },
    permissions: { actions: 'write', contents: 'read', metadata: 'read' },
    requestedActions: ['manually_register_one_app', 'manually_install_on_one_selected_repository'],
    notAuthorized: ['generate_or_read_private_key_or_client_secret', 'mint_installation_token',
      'dispatch_or_rerun_workflow', 'approve_github_environment', 'change_workflow_or_aws_trust',
      'create_secret_or_database_objects', 'write_business_records', 'deploy_or_delete_resources'],
    onCollisionOrUnknownResult: 'stop_and_inspect_no_automatic_retry_or_rename',
    approvalLifetime: 'configuration_bound_not_a_deployment_window; recheck_before_manual_submission',
    risks: [
      'Actions write is repository-wide, not an external per-workflow ACL; it includes more than dispatch.',
      'Actions read/write can expose run logs and artifacts; do not put credentials in them.',
      'Installation grants permissions immediately, even though this phase generates no private key.',
      'Existing or separately issued App credentials could exercise installed permissions.',
      'Registration and installation are not atomic; partial registration may remain.',
      'Provider-generated identifiers or internal credentials are not controlled by this preparation tool.',
      'Name availability and absence of a previous App are not proved; a collision requires inspection.',
      'This approval does not authorize retries, automatic uninstall, deletion, runtime activation or AWS spending.',
    ],
  };
}

export function platformControllerRegistrationUrl(): string {
  const p = platformControllerRegistrationPlan();
  const url = new URL('https://github.com/settings/apps/new');
  for (const [key, value] of Object.entries({ name: p.name, description: p.description, url: p.homepage,
    public: 'false', webhook_active: 'false', request_oauth_on_install: 'false',
    actions: p.permissions.actions, contents: p.permissions.contents })) url.searchParams.set(key, value);
  // Metadata read is automatic. No OAuth callbacks, webhook, or credential in URL.
  return url.href;
}

type JsonObject = Record<string, unknown>;
function object(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('REGISTRATION_METADATA_MISMATCH');
  return value as JsonObject;
}
function requireMatch(ok: boolean): asserts ok {
  if (!ok) throw new Error('REGISTRATION_METADATA_MISMATCH');
}
function positiveId(value: unknown): string {
  requireMatch(typeof value === 'number' && Number.isSafeInteger(value) && value > 0);
  return String(value);
}
function checkPermissions(value: unknown) {
  const actual = object(value), expected = platformControllerRegistrationPlan().permissions;
  requireMatch(Object.keys(actual).length === Object.keys(expected).length);
  for (const [key, permission] of Object.entries(expected)) requireMatch(actual[key] === permission);
}
function checkOwner(value: unknown) {
  const owner = object(value), p = platformControllerRegistrationPlan().owner;
  requireMatch(positiveId(owner.id) === p.id && owner.login === p.login && owner.type === p.type);
}
function noEvents(value: unknown) { requireMatch(Array.isArray(value) && value.length === 0); }

// For later, separately authorized API reads. REST metadata alone cannot prove
// private visibility, OAuth settings, private-key custody or actual dispatch actor.
export function inspectPlatformControllerPublicMetadata(input: {
  app: unknown; installation: unknown; repositories: unknown; bot: unknown;
}) {
  const p = platformControllerRegistrationPlan(), app = object(input.app), installation = object(input.installation);
  const repositories = object(input.repositories), bot = object(input.bot);
  const appId = positiveId(app.id), installationId = positiveId(installation.id);
  requireMatch(typeof app.slug === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(app.slug));
  requireMatch(app.name === p.name && app.external_url === p.homepage && app.html_url === `https://github.com/apps/${app.slug}`);
  checkOwner(app.owner); checkPermissions(app.permissions); noEvents(app.events);
  checkOwner(installation.account); checkPermissions(installation.permissions); noEvents(installation.events);
  requireMatch(positiveId(installation.app_id) === appId && installation.app_slug === app.slug);
  requireMatch(positiveId(installation.target_id) === p.owner.id && installation.target_type === p.owner.type);
  requireMatch(installation.repository_selection === 'selected' && installation.suspended_at === null);
  requireMatch(repositories.total_count === 1 && Array.isArray(repositories.repositories) && repositories.repositories.length === 1);
  const repository = object(repositories.repositories[0]);
  requireMatch(positiveId(repository.id) === p.repository.id && repository.full_name === p.repository.fullName);
  checkOwner(repository.owner);
  const candidateBotId = positiveId(bot.id);
  requireMatch(bot.login === `${app.slug}[bot]` && bot.type === 'Bot' && candidateBotId !== p.owner.id);
  return { state: 'PUBLIC_METADATA_MATCH_ONLY' as const, appId, installationId, slug: app.slug,
    candidateBotId, repositoryId: p.repository.id, ownerId: p.owner.id,
    manualSettingsReviewRequired: true, dispatchActorObserved: false, canDispatch: false,
    canApproveEnvironment: false, canDeploy: false };
}
