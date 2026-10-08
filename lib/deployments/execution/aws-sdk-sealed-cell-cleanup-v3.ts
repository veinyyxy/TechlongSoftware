import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, TransactGetCommand } from "@aws-sdk/lib-dynamodb";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { CloudFormationClient, ListStacksCommand, DescribeStacksCommand, GetTemplateCommand, ListStackResourcesCommand, DeleteStackCommand } from "@aws-sdk/client-cloudformation";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { canonicalJson } from "./hash.ts";
import { SHARED_CELL_CLEANUP_AUTHORITY_TABLE_ARN as table } from "./aws-sdk-shared-cell-cleanup-authority.ts";
import { AwsSdkSharedCellCleanupEvidenceAdapter, AwsSdkSharedCellCleanupDeleteStackAdapter } from "./aws-sdk-shared-cell-cleanup-deletion.ts";
import { SEALED_CELL_AUTHORITY_KEY_V3 as authorityKey, decodeSealedCellAuthorityRecordV3, assertSealedCellAuthorityActiveV3,
  sealedV3Keys as keys, sealedV3Fail as fail, type SealedCellAuthorityRecordV3, type StrongSealedCellAuthorityReadPortV3 } from "./sealed-cell-cleanup-authority-v3.ts";
import { createPreparedSealedCellTtlExecutorV3, validateSealedCellDeleteIntentV3, validateSealedCellDeleteReceiptV3,
  type SealedCellCleanupJournalV3 } from "./prepared-sealed-cell-ttl-executor-v3.ts";
import type { CertifiedSealedCellOwnershipSourceV3 } from "./sealed-cell-cleanup-evidence-v3.ts";

interface Client { send(command: unknown, options?: { abortSignal?: AbortSignal }): Promise<Record<string, unknown>> }
type Command = new (input: Record<string, unknown>) => unknown;
interface Sdk { client: Client; commands: { get: Command; put: Command; transactGet: Command; transactWrite?: Command } }
function pinSdk(sdk: Sdk) { return Object.freeze({ client: Object.freeze({ send: sdk.client.send.bind(sdk.client) }), commands: Object.freeze({ ...sdk.commands }) }); }
function json(item: unknown, expectedKey: string, revision: boolean) {
  const r = item as Record<string, unknown>;
  if (!keys(r, revision ? ["authority_key", "schema_version", "revision", "record_json"] : ["authority_key", "schema_version", "record_json"]) ||
    r.authority_key !== expectedKey || r.schema_version !== 3 || typeof r.record_json !== "string" || Buffer.byteLength(r.record_json, "utf8") > 131072)
    fail("SEALED_V3_DDB_ITEM_INVALID");
  let decoded: unknown;
  try { decoded = JSON.parse(r.record_json); } catch { return fail("SEALED_V3_DDB_JSON_INVALID"); }
  if (canonicalJson(decoded) !== r.record_json) fail("SEALED_V3_DDB_JSON_INVALID"); return decoded;
}

/** Atomic read of new v3 authority plus its unchanged provision-v2 predecessor, not a v2 cleanup fallback. */
export class AwsSdkSealedCellAuthorityReaderV3 implements StrongSealedCellAuthorityReadPortV3 {
  private readonly sdk: ReturnType<typeof pinSdk>;
  private readonly certificateSha256: string;
  constructor(sdk: Sdk, certificateSha256: string) { this.sdk = pinSdk(sdk); this.certificateSha256 = certificateSha256; }
  async readStrong({ signal }: { signal: AbortSignal }) {
    signal.throwIfAborted(); let response: Record<string, unknown>;
    try { response = await this.sdk.client.send(new this.sdk.commands.transactGet({ TransactItems: [
      { Get: { TableName: table, Key: { authority_key: authorityKey } } },
      { Get: { TableName: table, Key: { authority_key: "cell:cell-sandbox-1" } } },
    ] }), { abortSignal: signal }); } catch { signal.throwIfAborted(); return fail("SEALED_V3_AUTHORITY_READ_FAILED"); }
    signal.throwIfAborted();
    const items = response.Responses as { Item?: unknown }[];
    if (!Array.isArray(items) || items.length !== 2 || !items[0]?.Item || !items[1]?.Item) fail("SEALED_V3_AUTHORITY_ABSENT");
    const record = await decodeSealedCellAuthorityRecordV3(json(items[0].Item, authorityKey, true), this.certificateSha256);
    const stored = items[0].Item as Record<string, unknown>, predecessor = items[1].Item as Record<string, unknown>;
    if (stored.revision !== record.revision || !keys(predecessor, ["authority_key", "schema_version", "revision", "record_json"]) ||
      predecessor.authority_key !== "cell:cell-sandbox-1" || predecessor.schema_version !== 2 || predecessor.revision !== record.candidate.predecessor.revision ||
      predecessor.record_json !== canonicalJson(record.candidate.predecessor)) fail("SEALED_V3_CURRENT_PROVISION_DRIFT");
    signal.throwIfAborted(); return record;
  }
}

/** Separate installer capability. One atomic predecessor ConditionCheck + absent-key Put. No replace/reset/expiry retry. */
export class AwsSdkSealedCellAuthorityInstallerV3 {
  private readonly sdk: ReturnType<typeof pinSdk>;
  private readonly certificateSha256: string;
  private readonly now: () => number;
  constructor(sdk: Sdk, certificateSha256: string, now: () => number = Date.now) {
    if (typeof sdk.commands.transactWrite !== "function") fail("SEALED_V3_INSTALLER_CAPABILITY_MISSING");
    this.sdk = pinSdk(sdk); this.certificateSha256 = certificateSha256; this.now = now;
  }
  async installOnce(input: { record: SealedCellAuthorityRecordV3; approvedRecordSha256: string; signal: AbortSignal }) {
    if (!keys(input, ["record", "approvedRecordSha256", "signal"])) fail("SEALED_V3_INSTALL_INPUT_INVALID");
    const record = await decodeSealedCellAuthorityRecordV3(input.record, this.certificateSha256);
    if (record.recordSha256 !== input.approvedRecordSha256) fail("SEALED_V3_INSTALL_APPROVAL_MISMATCH");
    assertSealedCellAuthorityActiveV3(record, this.now()); input.signal.throwIfAborted();
    const p = record.candidate.predecessor;
    try {
      await this.sdk.client.send(new this.sdk.commands.transactWrite!({ ClientRequestToken: `seal-auth-${record.recordSha256.slice(0, 16)}`,
        TransactItems: [
          { ConditionCheck: { TableName: table, Key: { authority_key: "cell:cell-sandbox-1" },
            ConditionExpression: "#schema = :schema AND #revision = :revision AND #json = :json",
            ExpressionAttributeNames: { "#schema": "schema_version", "#revision": "revision", "#json": "record_json" },
            ExpressionAttributeValues: { ":schema": 2, ":revision": p.revision, ":json": canonicalJson(p) }, ReturnValuesOnConditionCheckFailure: "NONE" } },
          { Put: { TableName: table, Item: { authority_key: authorityKey, schema_version: 3, revision: record.revision, record_json: canonicalJson(record) },
            ConditionExpression: "attribute_not_exists(#key)", ExpressionAttributeNames: { "#key": "authority_key" }, ReturnValuesOnConditionCheckFailure: "NONE" } },
        ] }), { abortSignal: input.signal });
      input.signal.throwIfAborted(); return { outcome: "SUBMITTED_REQUIRES_INDEPENDENT_STRONG_READ" as const, retryAuthorized: false as const };
    } catch { return { outcome: "UNKNOWN_OR_REJECTED_INSPECT_ONLY" as const, retryAuthorized: false as const }; }
  }
}

function journalKey(kind: "intent" | "receipt", sha: string) {
  if (!/^[a-f0-9]{64}$/.test(sha)) fail("SEALED_V3_PLAN_SHA_INVALID"); return `sealed-cell-ttl-v3:${kind}:${sha}`;
}
export class AwsSdkSealedCellCleanupJournalV3 implements SealedCellCleanupJournalV3 {
  private readonly sdk: ReturnType<typeof pinSdk>;
  private readonly certificateSha256: string;
  constructor(sdk: Sdk, certificateSha256: string) { this.sdk = pinSdk(sdk); this.certificateSha256 = certificateSha256; }
  async readStrong({ planSha256, signal }: Parameters<SealedCellCleanupJournalV3["readStrong"]>[0]) {
    const read = async (kind: "intent" | "receipt") => {
      signal.throwIfAborted(); const key = journalKey(kind, planSha256); let r: Record<string, unknown>;
      try { r = await this.sdk.client.send(new this.sdk.commands.get({ TableName: table, Key: { authority_key: key }, ConsistentRead: true }), { abortSignal: signal }); }
      catch { signal.throwIfAborted(); return fail("SEALED_V3_JOURNAL_READ_FAILED"); }
      signal.throwIfAborted(); if (r.Item === undefined) return null;
      const decoded = json(r.Item, key, false);
      return kind === "intent" ? validateSealedCellDeleteIntentV3(decoded, planSha256, this.certificateSha256) : validateSealedCellDeleteReceiptV3(decoded, planSha256, this.certificateSha256);
    };
    return { intent: await read("intent"), receipt: await read("receipt") };
  }
  async claimIntent({ intent, signal }: Parameters<SealedCellCleanupJournalV3["claimIntent"]>[0]) {
    const checked = await validateSealedCellDeleteIntentV3(intent, intent.planSha256, this.certificateSha256); signal.throwIfAborted();
    try {
      await this.sdk.client.send(new this.sdk.commands.put({ TableName: table,
        Item: { authority_key: journalKey("intent", checked.planSha256), schema_version: 3, record_json: canonicalJson(checked) },
        ConditionExpression: "attribute_not_exists(#key)", ExpressionAttributeNames: { "#key": "authority_key" } }), { abortSignal: signal });
      signal.throwIfAborted(); return true;
    } catch (e) { signal.throwIfAborted(); if ((e as { name?: string })?.name === "ConditionalCheckFailedException") return false;
      return fail("SEALED_V3_SLOT_UNCERTAIN_RECOVER_ONLY"); }
  }
  async publishReceipt({ receipt, signal }: Parameters<SealedCellCleanupJournalV3["publishReceipt"]>[0]) {
    const checked = await validateSealedCellDeleteReceiptV3(receipt, receipt.intent.planSha256, this.certificateSha256); signal.throwIfAborted();
    try {
      await this.sdk.client.send(new this.sdk.commands.put({ TableName: table,
        Item: { authority_key: journalKey("receipt", checked.intent.planSha256), schema_version: 3, record_json: canonicalJson(checked) },
        ConditionExpression: "attribute_not_exists(#key)", ExpressionAttributeNames: { "#key": "authority_key" } }), { abortSignal: signal });
      signal.throwIfAborted();
    } catch (e) { signal.throwIfAborted(); if ((e as { name?: string })?.name !== "ConditionalCheckFailedException") fail("SEALED_V3_RECEIPT_UNCERTAIN_RECOVER_ONLY"); }
  }
}

/** SDK assembly is inert: lazy credentials, fixed region/endpoints, maxAttempts1; no issuer in the deleter. */
export async function createAwsSdkPreparedSealedCellTtlExecutorV3(input: { source: CertifiedSealedCellOwnershipSourceV3; certificateSha256: string }) {
  if (!keys(input, ["source", "certificateSha256"])) fail("SEALED_V3_CAPABILITIES_INVALID");
  const config = { region: "ca-central-1", ignoreConfiguredEndpointUrls: true, maxAttempts: 1 };
  const credentials = defaultProvider({ clientConfig: config });
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({ ...config, credentials }), { marshallOptions: { removeUndefinedValues: false, convertClassInstanceToMap: false } });
  const sdk: Sdk = { client: client as unknown as Client, commands: { get: GetCommand as unknown as Command, put: PutCommand as unknown as Command,
    transactGet: TransactGetCommand as unknown as Command } };
  const sts = new STSClient({ ...config, credentials }), cloudFormation = new CloudFormationClient({ ...config, credentials });
  const aws = new AwsSdkSharedCellCleanupEvidenceAdapter("ca-central-1", { clients: { sts: sts as unknown as Client, cloudFormation: cloudFormation as unknown as Client },
    commands: { getCallerIdentity: GetCallerIdentityCommand as unknown as Command, listStacks: ListStacksCommand as unknown as Command,
      describeStacks: DescribeStacksCommand as unknown as Command, getTemplate: GetTemplateCommand as unknown as Command, listStackResources: ListStackResourcesCommand as unknown as Command },
    zeroTenantOwnership: { async readStrongZeroTenantOwnershipSnapshot() { return fail("SEALED_V3_LEGACY_OWNERSHIP_FORBIDDEN"); } } });
  const stack = { region: aws.region, getCallerIdentity: aws.getCallerIdentity.bind(aws), listStackNamesPage: aws.listStackNamesPage.bind(aws),
    describeCellStack: aws.describeCellStack.bind(aws), getOriginalTemplate: aws.getOriginalTemplate.bind(aws), listStackResourcesPage: aws.listStackResourcesPage.bind(aws) };
  return createPreparedSealedCellTtlExecutorV3({ ...input, stack, authority: new AwsSdkSealedCellAuthorityReaderV3(sdk, input.certificateSha256),
    journal: new AwsSdkSealedCellCleanupJournalV3(sdk, input.certificateSha256),
    deleter: new AwsSdkSharedCellCleanupDeleteStackAdapter({ client: cloudFormation as unknown as Client, deleteStack: DeleteStackCommand as unknown as Command }) });
}
