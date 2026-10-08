import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { CloudFormationClient, ListStacksCommand, DescribeStacksCommand, GetTemplateCommand, ListStackResourcesCommand, DeleteStackCommand } from "@aws-sdk/client-cloudformation";
import {
  AwsSdkSharedCellCleanupAuthority,
  SHARED_CELL_CLEANUP_AUTHORITY_TABLE_ARN,
} from "./aws-sdk-shared-cell-cleanup-authority.ts";
import { AwsSdkSharedCellCleanupEvidenceAdapter, AwsSdkSharedCellCleanupDeleteStackAdapter, type SharedCellCleanupZeroTenantOwnershipReadPort } from "./aws-sdk-shared-cell-cleanup-deletion.ts";
import { canonicalJson } from "./hash.ts";
import {
  createPreparedCellTtlJanitor,
  createPreparedDedicatedCellTtlExecutorV2,
  PreparedCellTtlJanitorError,
  validatePreparedCellCleanupIntent,
  validatePreparedCellCleanupReceipt,
  validateDedicatedCellCleanupIntentV2,
  validateDedicatedCellCleanupReceiptV2,
  type PreparedCellCleanupIntent,
  type PreparedCellCleanupReceipt,
  type PreparedCellCleanupJournal,
} from "./prepared-cell-ttl-janitor.ts";
import type { DedicatedCellTtlDeletionSummary, SharedCellCleanupDeletionSummary } from "./shared-cell-cleanup-deletion.ts";

interface Client { send(command: unknown, options?: { abortSignal?: AbortSignal }): Promise<Record<string, unknown>> }
type Command = new (input: Record<string, unknown>) => unknown;
type JournalSdk = { client: Client; commands: { get: Command; put: Command } };
type CleanupSummary = SharedCellCleanupDeletionSummary | DedicatedCellTtlDeletionSummary;
interface JournalProtocol<T extends CleanupSummary> {
  schemaVersion: T["schemaVersion"];
  validateIntent(value: unknown, digest: string): Promise<Readonly<PreparedCellCleanupIntent<T>>>;
  validateReceipt(value: unknown, digest: string): Promise<Readonly<PreparedCellCleanupReceipt<T>>>;
}
function key(kind: "intent" | "receipt", digest: string) {
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new PreparedCellTtlJanitorError("CELL_TTL_PLAN_INVALID");
  return `cell-cleanup-${kind}:${digest}`;
}
function fail(code: string): never { throw new PreparedCellTtlJanitorError(code); }
function conditional(error: unknown) { return (error as { name?: unknown } | null)?.name === "ConditionalCheckFailedException"; }

/** No Update/Delete/Scan/TTL attribute and no retry of a slot write. */
class AwsSdkBoundCellCleanupJournal<T extends CleanupSummary> implements PreparedCellCleanupJournal<T> {
  private readonly client: Client;
  private readonly commands: { get: Command; put: Command };
  private readonly protocol: JournalProtocol<T>;
  constructor(input: JournalSdk, protocol: JournalProtocol<T>) {
    this.client = Object.freeze({ send: input.client.send.bind(input.client) });
    this.commands = Object.freeze({ ...input.commands });
    this.protocol = Object.freeze({ ...protocol });
  }
  async readStrong({ planSha256, signal }: Parameters<PreparedCellCleanupJournal<T>["readStrong"]>[0]) {
    const read = async (kind: "intent" | "receipt") => {
      signal.throwIfAborted();
      let response: Record<string, unknown>;
      const authorityKey = key(kind, planSha256);
      try { response = await this.client.send(new this.commands.get({
        TableName: SHARED_CELL_CLEANUP_AUTHORITY_TABLE_ARN, Key: { authority_key: authorityKey }, ConsistentRead: true,
      }), { abortSignal: signal }); } catch { signal.throwIfAborted(); return fail("CELL_TTL_JOURNAL_READ_FAILED"); }
      signal.throwIfAborted();
      if (response.Item === undefined) return null;
      const item = response.Item as Record<string, unknown>;
      if (!item || canonicalJson(Object.keys(item).sort()) !== canonicalJson(["authority_key", "record_json", "schema_version"].sort()) ||
          item.authority_key !== authorityKey || item.schema_version !== this.protocol.schemaVersion || typeof item.record_json !== "string" ||
          Buffer.byteLength(item.record_json, "utf8") > 16384) fail("CELL_TTL_JOURNAL_ITEM_INVALID");
      let decoded: unknown;
      try { decoded = JSON.parse(item.record_json as string); } catch { return fail("CELL_TTL_JOURNAL_ITEM_INVALID"); }
      if (canonicalJson(decoded) !== item.record_json) fail("CELL_TTL_JOURNAL_ITEM_INVALID");
      return kind === "intent" ? this.protocol.validateIntent(decoded, planSha256) : this.protocol.validateReceipt(decoded, planSha256);
    };
    // The intent is immutable. A concurrent receipt appearing between these
    // reads cannot confer deletion permission; only the CAS winner can delete.
    return { intent: await read("intent"), receipt: await read("receipt") };
  }
  async claimIntent({ intent, signal }: Parameters<PreparedCellCleanupJournal<T>["claimIntent"]>[0]) {
    const checked = await this.protocol.validateIntent(intent, intent.plan.deletionPlanSha256);
    signal.throwIfAborted();
    try {
      await this.client.send(new this.commands.put({
        TableName: SHARED_CELL_CLEANUP_AUTHORITY_TABLE_ARN,
        Item: { authority_key: key("intent", checked.plan.deletionPlanSha256), schema_version: this.protocol.schemaVersion, record_json: canonicalJson(checked) },
        ConditionExpression: "attribute_not_exists(#key)", ExpressionAttributeNames: { "#key": "authority_key" },
      }), { abortSignal: signal });
      signal.throwIfAborted();
      return true;
    } catch (error) {
      signal.throwIfAborted();
      if (conditional(error)) return false;
      return fail("CELL_TTL_SLOT_WRITE_UNCERTAIN_RECOVER_ONLY");
    }
  }
  async publishReceipt({ receipt, signal }: Parameters<PreparedCellCleanupJournal<T>["publishReceipt"]>[0]) {
    const checked = await this.protocol.validateReceipt(receipt, receipt.result.deletionPlanSha256);
    signal.throwIfAborted();
    try {
      await this.client.send(new this.commands.put({
        TableName: SHARED_CELL_CLEANUP_AUTHORITY_TABLE_ARN,
        Item: { authority_key: key("receipt", checked.result.deletionPlanSha256), schema_version: this.protocol.schemaVersion, record_json: canonicalJson(checked) },
        ConditionExpression: "attribute_not_exists(#key)", ExpressionAttributeNames: { "#key": "authority_key" },
      }), { abortSignal: signal });
      signal.throwIfAborted();
    } catch (error) {
      signal.throwIfAborted();
      if (!conditional(error)) fail("CELL_TTL_RECEIPT_WRITE_UNCERTAIN_RECOVER_ONLY");
    }
  }
}
export class AwsSdkPreparedCellCleanupJournal extends AwsSdkBoundCellCleanupJournal<SharedCellCleanupDeletionSummary> {
  constructor(input: JournalSdk) { super(input, { schemaVersion: 1, validateIntent: validatePreparedCellCleanupIntent, validateReceipt: validatePreparedCellCleanupReceipt }); }
}
export class AwsSdkDedicatedCellCleanupJournalV2 extends AwsSdkBoundCellCleanupJournal<DedicatedCellTtlDeletionSummary> {
  constructor(input: JournalSdk) { super(input, { schemaVersion: 2, validateIntent: validateDedicatedCellCleanupIntentV2, validateReceipt: validateDedicatedCellCleanupReceiptV2 }); }
}

/** Pure SDK assembly; no credential resolution/API request or Lambda export. */
async function assembleAwsSdkCleanupCapabilities(input: { zeroTenantOwnership: SharedCellCleanupZeroTenantOwnershipReadPort }) {
  if (!input || Object.keys(input).length !== 1 || typeof input.zeroTenantOwnership?.readStrongZeroTenantOwnershipSnapshot !== "function") fail("CELL_TTL_CAPABILITIES_INVALID");
  const config = { region: "ca-central-1", ignoreConfiguredEndpointUrls: true, maxAttempts: 1 };
  const credentials = defaultProvider({ clientConfig: config });
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({ ...config, credentials }), {
    marshallOptions: { removeUndefinedValues: false, convertClassInstanceToMap: false },
  });
  const sdk = { client: client as unknown as Client, commands: { get: GetCommand as unknown as Command, put: PutCommand as unknown as Command } };
  const authority = new AwsSdkSharedCellCleanupAuthority({ tableArn: SHARED_CELL_CLEANUP_AUTHORITY_TABLE_ARN }, sdk);
  const sts = new STSClient({ ...config, credentials });
  const cloudFormation = new CloudFormationClient({ ...config, credentials });
  const evidence = new AwsSdkSharedCellCleanupEvidenceAdapter("ca-central-1", {
    clients: { sts: sts as unknown as Client, cloudFormation: cloudFormation as unknown as Client },
    commands: {
      getCallerIdentity: GetCallerIdentityCommand as unknown as Command,
      listStacks: ListStacksCommand as unknown as Command,
      describeStacks: DescribeStacksCommand as unknown as Command,
      getTemplate: GetTemplateCommand as unknown as Command,
      listStackResources: ListStackResourcesCommand as unknown as Command,
    },
    zeroTenantOwnership: input.zeroTenantOwnership,
  });
  const deleter = new AwsSdkSharedCellCleanupDeleteStackAdapter({ client: cloudFormation as unknown as Client, deleteStack: DeleteStackCommand as unknown as Command });
  return { evidence, deleter, authority: { readStrong: authority.observe.bind(authority) }, journalSdk: sdk }; // no CAS exposed
}
export async function createAwsSdkPreparedCellTtlJanitor(input: { zeroTenantOwnership: SharedCellCleanupZeroTenantOwnershipReadPort }) {
  const { journalSdk, ...ports } = await assembleAwsSdkCleanupCapabilities(input);
  return createPreparedCellTtlJanitor({ ...ports, journal: new AwsSdkPreparedCellCleanupJournal(journalSdk) });
}
export async function createAwsSdkPreparedDedicatedCellTtlExecutorV2(input: { zeroTenantOwnership: SharedCellCleanupZeroTenantOwnershipReadPort }) {
  const { journalSdk, ...ports } = await assembleAwsSdkCleanupCapabilities(input);
  return createPreparedDedicatedCellTtlExecutorV2({ ...ports, journal: new AwsSdkDedicatedCellCleanupJournalV2(journalSdk) });
}
