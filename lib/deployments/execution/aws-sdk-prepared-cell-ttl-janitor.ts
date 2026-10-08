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
  PreparedCellTtlJanitorError,
  validatePreparedCellCleanupIntent,
  validatePreparedCellCleanupReceipt,
  type PreparedCellCleanupJournal,
} from "./prepared-cell-ttl-janitor.ts";

interface Client { send(command: unknown, options?: { abortSignal?: AbortSignal }): Promise<Record<string, unknown>> }
type Command = new (input: Record<string, unknown>) => unknown;
function key(kind: "intent" | "receipt", digest: string) {
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new PreparedCellTtlJanitorError("CELL_TTL_PLAN_INVALID");
  return `cell-cleanup-${kind}:${digest}`;
}
function fail(code: string): never { throw new PreparedCellTtlJanitorError(code); }
function conditional(error: unknown) { return (error as { name?: unknown } | null)?.name === "ConditionalCheckFailedException"; }

/** No Update/Delete/Scan/TTL attribute and no retry of a slot write. */
export class AwsSdkPreparedCellCleanupJournal implements PreparedCellCleanupJournal {
  private readonly client: Client;
  private readonly commands: { get: Command; put: Command };
  constructor(input: { client: Client; commands: { get: Command; put: Command } }) {
    this.client = Object.freeze({ send: input.client.send.bind(input.client) });
    this.commands = Object.freeze({ ...input.commands });
  }
  async readStrong({ planSha256, signal }: Parameters<PreparedCellCleanupJournal["readStrong"]>[0]) {
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
          item.authority_key !== authorityKey || item.schema_version !== 1 || typeof item.record_json !== "string" ||
          Buffer.byteLength(item.record_json, "utf8") > 16384) fail("CELL_TTL_JOURNAL_ITEM_INVALID");
      let decoded: unknown;
      try { decoded = JSON.parse(item.record_json as string); } catch { return fail("CELL_TTL_JOURNAL_ITEM_INVALID"); }
      if (canonicalJson(decoded) !== item.record_json) fail("CELL_TTL_JOURNAL_ITEM_INVALID");
      return kind === "intent" ? validatePreparedCellCleanupIntent(decoded, planSha256) : validatePreparedCellCleanupReceipt(decoded, planSha256);
    };
    // The intent is immutable. A concurrent receipt appearing between these
    // reads cannot confer deletion permission; only the CAS winner can delete.
    return { intent: await read("intent"), receipt: await read("receipt") };
  }
  async claimIntent({ intent, signal }: Parameters<PreparedCellCleanupJournal["claimIntent"]>[0]) {
    const checked = await validatePreparedCellCleanupIntent(intent, intent.plan.deletionPlanSha256);
    signal.throwIfAborted();
    try {
      await this.client.send(new this.commands.put({
        TableName: SHARED_CELL_CLEANUP_AUTHORITY_TABLE_ARN,
        Item: { authority_key: key("intent", checked.plan.deletionPlanSha256), schema_version: 1, record_json: canonicalJson(checked) },
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
  async publishReceipt({ receipt, signal }: Parameters<PreparedCellCleanupJournal["publishReceipt"]>[0]) {
    const checked = await validatePreparedCellCleanupReceipt(receipt, receipt.result.deletionPlanSha256);
    signal.throwIfAborted();
    try {
      await this.client.send(new this.commands.put({
        TableName: SHARED_CELL_CLEANUP_AUTHORITY_TABLE_ARN,
        Item: { authority_key: key("receipt", checked.result.deletionPlanSha256), schema_version: 1, record_json: canonicalJson(checked) },
        ConditionExpression: "attribute_not_exists(#key)", ExpressionAttributeNames: { "#key": "authority_key" },
      }), { abortSignal: signal });
      signal.throwIfAborted();
    } catch (error) {
      signal.throwIfAborted();
      if (!conditional(error)) fail("CELL_TTL_RECEIPT_WRITE_UNCERTAIN_RECOVER_ONLY");
    }
  }
}

/** Pure SDK assembly; no credential resolution/API request or Lambda export. */
export async function createAwsSdkPreparedCellTtlJanitor(input: { zeroTenantOwnership: SharedCellCleanupZeroTenantOwnershipReadPort }) {
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
  return createPreparedCellTtlJanitor({
    evidence, deleter,
    authority: { readStrong: request => authority.observe(request) }, // no CAS exposed to this root
    journal: new AwsSdkPreparedCellCleanupJournal(sdk),
  });
}
