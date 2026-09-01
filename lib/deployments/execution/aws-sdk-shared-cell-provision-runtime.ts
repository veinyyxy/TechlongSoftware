import { AwsSdkSharedCellProvisionAuthority } from "./aws-sdk-shared-cell-provision-authority.ts";
import { SHARED_CELL_CLEANUP_AUTHORITY_TABLE_ARN } from "./aws-sdk-shared-cell-cleanup-authority.ts";
import { AwsSdkSharedCellProvisionEvidenceAdapter } from "./shared-cell-provision-evidence.ts";

const region = "ca-central-1";
const profile = "techlong-sandbox-provisioner";
const mfaDeviceArn =
  "arn:aws:iam::402010193138:mfa/techlong-sandbox-dev";

interface AwsSdkClient {
  send(
    command: unknown,
    options?: { abortSignal?: AbortSignal },
  ): Promise<Record<string, unknown>>;
}

type AwsSdkClientConstructor = new (
  configuration: Record<string, unknown>,
) => AwsSdkClient;
type AwsSdkCommandConstructor = new (
  input: Record<string, unknown>,
) => unknown;
type AwsCredentialProvider = () => Promise<Record<string, unknown>>;
type MfaCodeProvider = (mfaSerial: string) => Promise<string>;

export interface AwsSdkSharedCellProvisionRuntimeInput {
  mfaCodeProvider: MfaCodeProvider;
}

export interface AwsSdkSharedCellProvisionRuntime {
  evidence: AwsSdkSharedCellProvisionEvidenceAdapter;
  authority: AwsSdkSharedCellProvisionAuthority;
}

export interface AwsSdkSharedCellProvisionRuntimeModules {
  sts: Record<string, unknown>;
  cloudFormation: Record<string, unknown>;
  dynamo: Record<string, unknown>;
  document: Record<string, unknown>;
  credentialProvider: Record<string, unknown>;
}

function constructor(
  module: Record<string, unknown>,
  name: string,
): AwsSdkClientConstructor {
  const value = module[name];
  if (typeof value !== "function") {
    throw new Error(`AWS SDK export ${name} is missing.`);
  }
  return value as AwsSdkClientConstructor;
}

function command(
  module: Record<string, unknown>,
  name: string,
): AwsSdkCommandConstructor {
  const value = module[name];
  if (typeof value !== "function") {
    throw new Error(`AWS SDK export ${name} is missing.`);
  }
  return value as AwsSdkCommandConstructor;
}

function checkedMfaCodeProvider(
  input: AwsSdkSharedCellProvisionRuntimeInput,
): MfaCodeProvider {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).length !== 1 ||
    typeof input.mfaCodeProvider !== "function"
  ) {
    throw new Error("Shared Cell provision MFA provider input is invalid.");
  }
  const source = input.mfaCodeProvider;
  return async (serial: string) => {
    if (serial !== mfaDeviceArn) {
      throw new Error("Shared Cell provision MFA device is outside the allowlist.");
    }
    const code = await source(serial);
    if (!/^[0-9]{6}$/.test(code)) {
      throw new Error("Shared Cell provision MFA code is invalid.");
    }
    return code;
  };
}

/**
 * Pure trusted-code construction seam. Production and tests both prove STS,
 * CloudFormation and DynamoDB receive one shared refreshing provider. This
 * function constructs capabilities but never calls AWS or wires Worker root;
 * injected modules are a test seam, not an adversarial same-process boundary.
 *
 * @internal
 */
export function createAwsSdkSharedCellProvisionRuntimeFromModules(
  modules: AwsSdkSharedCellProvisionRuntimeModules,
  input: AwsSdkSharedCellProvisionRuntimeInput,
): Readonly<AwsSdkSharedCellProvisionRuntime> {
  const defaultProvider = modules.credentialProvider.defaultProvider;
  if (typeof defaultProvider !== "function") {
    throw new Error("AWS SDK export defaultProvider is missing.");
  }
  const mfaCodeProvider = checkedMfaCodeProvider(input);
  const credentials = (
    defaultProvider as (
      options: Record<string, unknown>,
    ) => AwsCredentialProvider
  )({
    profile,
    mfaCodeProvider,
    clientConfig: {
      region,
      ignoreConfiguredEndpointUrls: true,
    },
  });
  if (typeof credentials !== "function") {
    throw new Error("AWS SDK default credential provider is invalid.");
  }

  const STSClient = constructor(modules.sts, "STSClient");
  const CloudFormationClient = constructor(
    modules.cloudFormation,
    "CloudFormationClient",
  );
  const DynamoDBClient = constructor(modules.dynamo, "DynamoDBClient");
  const stsClient = new STSClient({
    region,
    credentials,
    ignoreConfiguredEndpointUrls: true,
  });
  const cloudFormationClient = new CloudFormationClient({
    region,
    credentials,
    ignoreConfiguredEndpointUrls: true,
  });
  const dynamoClient = new DynamoDBClient({
    region,
    credentials,
    ignoreConfiguredEndpointUrls: true,
  });
  const documentFactory = modules.document.DynamoDBDocumentClient as
    | { from(client: unknown, options?: Record<string, unknown>): AwsSdkClient }
    | undefined;
  if (!documentFactory || typeof documentFactory.from !== "function") {
    throw new Error("AWS SDK export DynamoDBDocumentClient is missing.");
  }
  const documentClient = documentFactory.from(dynamoClient, {
    marshallOptions: {
      removeUndefinedValues: false,
      convertClassInstanceToMap: false,
    },
  });

  return Object.freeze({
    evidence: new AwsSdkSharedCellProvisionEvidenceAdapter(region, {
      clients: {
        sts: stsClient,
        cloudFormation: cloudFormationClient,
      },
      commands: {
        getCallerIdentity: command(modules.sts, "GetCallerIdentityCommand"),
        describeStacks: command(
          modules.cloudFormation,
          "DescribeStacksCommand",
        ),
        getTemplate: command(modules.cloudFormation, "GetTemplateCommand"),
        listStackResources: command(
          modules.cloudFormation,
          "ListStackResourcesCommand",
        ),
      },
    }),
    authority: new AwsSdkSharedCellProvisionAuthority(
      { tableArn: SHARED_CELL_CLEANUP_AUTHORITY_TABLE_ARN },
      {
        client: documentClient,
        commands: {
          get: command(modules.document, "GetCommand"),
          put: command(modules.document, "PutCommand"),
        },
      },
    ),
  });
}

export async function createAwsSdkSharedCellProvisionRuntime(
  input: AwsSdkSharedCellProvisionRuntimeInput,
): Promise<
  Readonly<AwsSdkSharedCellProvisionRuntime>
> {
  const stsPackage = "@aws-sdk/client-sts";
  const cloudFormationPackage = "@aws-sdk/client-cloudformation";
  const dynamoPackage = "@aws-sdk/client-dynamodb";
  const documentPackage = "@aws-sdk/lib-dynamodb";
  const credentialProviderPackage = "@aws-sdk/credential-provider-node";
  const [sts, cloudFormation, dynamo, document, credentialProvider] =
    (await Promise.all([
      import(stsPackage),
      import(cloudFormationPackage),
      import(dynamoPackage),
      import(documentPackage),
      import(credentialProviderPackage),
    ])) as Record<string, unknown>[];
  return createAwsSdkSharedCellProvisionRuntimeFromModules({
    sts,
    cloudFormation,
    dynamo,
    document,
    credentialProvider,
  }, input);
}
