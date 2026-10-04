import { createSharedCellAuthorCompensationSourceCredentialProvider, AwsSdkSharedCellAuthorCompensationManagementReadAdapter } from "./aws-sdk-shared-cell-author-compensation-management.ts";
import { AwsSdkArnProbeFixtureReadAdapter } from "./aws-sdk-arn-compatibility-probe-fixture.ts";
import { AwsSdkArnProbeGrantReadAdapter } from "./aws-sdk-arn-compatibility-probe-grant.ts";
import { AwsSdkArnProbeWorkflowReadAdapter } from "./aws-sdk-arn-compatibility-probe-workflow.ts";

/** Source login only, one SDK attempt, read commands only. No ambient provider
 * chain, AssumeRole, Operator or IAM mutation capability is constructed here. */
export async function createArnProbeSourceReadRuntime() {
  for (const [key, value] of Object.entries(process.env)) {
    if (value && (/^AWS_ENDPOINT_URL(?:_|$)/.test(key) || ["AWS_CONFIG_FILE", "AWS_SHARED_CREDENTIALS_FILE", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_SECURITY_TOKEN", "AWS_ROLE_ARN", "AWS_ROLE_SESSION_NAME", "AWS_WEB_IDENTITY_TOKEN_FILE", "AWS_CONTAINER_CREDENTIALS_FULL_URI", "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI", "AWS_CONTAINER_AUTHORIZATION_TOKEN", "AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE"].includes(key))) throw new Error("Probe Source refuses ambient credential/config/endpoint overrides.");
  }
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") throw new Error("Probe Source requires TLS validation.");
  const [sts, cf, iam, dynamo, login, config] = await Promise.all([import("@aws-sdk/client-sts"), import("@aws-sdk/client-cloudformation"),
    import("@aws-sdk/client-iam"), import("@aws-sdk/client-dynamodb"), import("@aws-sdk/credential-provider-login"), import("@smithy/core/config")]);
  const source = createSharedCellAuthorCompensationSourceCredentialProvider({ login, config });
  const credentials = async () => {
    const value = await source();
    if (typeof value.accessKeyId !== "string" || typeof value.secretAccessKey !== "string" || typeof value.sessionToken !== "string") throw new Error("Probe Source credential shape is invalid.");
    return { accessKeyId: value.accessKeyId, secretAccessKey: value.secretAccessKey, sessionToken: value.sessionToken, expiration: value.expiration as Date };
  };
  const sdkConfig = { region: "ca-central-1", credentials, maxAttempts: 1, ignoreConfiguredEndpointUrls: true };
  const sourceSts = new sts.STSClient(sdkConfig), sourceCf = new cf.CloudFormationClient(sdkConfig),
    sourceIam = new iam.IAMClient(sdkConfig), sourceDynamo = new dynamo.DynamoDBClient(sdkConfig);
  type Command = new (input: Record<string, unknown>) => unknown;
  type Client = { send(command: never, options: { abortSignal: AbortSignal }): Promise<unknown> };
  const wrap = (client: Client) => ({ send: (command: unknown, options: { abortSignal: AbortSignal }) => client.send(command as never, options) as Promise<Record<string, unknown>> });
  const cfClient = wrap(sourceCf);
  const commands = { describeStacks: cf.DescribeStacksCommand as unknown as Command, listStackResources: cf.ListStackResourcesCommand as unknown as Command,
    getTemplate: cf.GetTemplateCommand as unknown as Command, describeChangeSet: cf.DescribeChangeSetCommand as unknown as Command,
    listChangeSets: cf.ListChangeSetsCommand as unknown as Command };
  const management = new AwsSdkSharedCellAuthorCompensationManagementReadAdapter({
    clients: { sts: wrap(sourceSts), cloudFormation: cfClient, iam: wrap(sourceIam), dynamoDb: wrap(sourceDynamo) },
    commands: { ...commands, getCallerIdentity: sts.GetCallerIdentityCommand as unknown as Command,
      getPolicy: iam.GetPolicyCommand as unknown as Command, getPolicyVersion: iam.GetPolicyVersionCommand as unknown as Command,
      listPolicyVersions: iam.ListPolicyVersionsCommand as unknown as Command, listEntitiesForPolicy: iam.ListEntitiesForPolicyCommand as unknown as Command,
      getRole: iam.GetRoleCommand as unknown as Command, listAttachedRolePolicies: iam.ListAttachedRolePoliciesCommand as unknown as Command,
      listRolePolicies: iam.ListRolePoliciesCommand as unknown as Command, getItem: dynamo.GetItemCommand as unknown as Command } });
  const fixture = new AwsSdkArnProbeFixtureReadAdapter({ client: cfClient, management, commands });
  const grant = new AwsSdkArnProbeGrantReadAdapter(fixture, cfClient, commands);
  return { reads: new AwsSdkArnProbeWorkflowReadAdapter({ client: cfClient, management, fixture, grant, commands }), credentials,
    readComparisonManagement: (plan: Parameters<typeof management.readArnProbeReadComparisonObservation>[0]["plan"], signal: AbortSignal) => management.readArnProbeReadComparisonObservation({ plan, signal }),
    destroy: () => [sourceSts, sourceCf, sourceIam, sourceDynamo].forEach((client) => client.destroy()) };
}
