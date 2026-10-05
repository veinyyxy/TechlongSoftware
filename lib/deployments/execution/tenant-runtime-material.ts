import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import type { TenantRuntimeSecretMaterialGenerator } from "./aws-sdk-tenant-secret-provider.ts";
import type {
  TenantExternalOperationFence,
  TenantResourceFence,
  TenantSecretStorePort,
} from "./contracts.ts";
import { canonicalJson } from "./hash.ts";
import {
  assertTenantResourceFence,
  deriveTenantRuntimeSecretName,
  TenantDatabaseLifecycleError,
} from "./tenant-database.ts";
import type { TenantRuntimeSecretOwnershipEvidence } from "./tenant-aws-one-shot-adapters.ts";

export interface TenantPaymentCredentialLease {
  read(): { stripeSecretKey: string; stripeWebhookSecret: string };
  dispose(): void;
}

/** A trusted private source, not tenant input, configuration JSON or a receipt. */
export interface TenantPaymentCredentialSource {
  lease(input: {
    fence: TenantResourceFence;
    externalFence: TenantExternalOperationFence;
    signal: AbortSignal;
  }): Promise<TenantPaymentCredentialLease>;
}

export interface TenantRuntimeMaterialConfig {
  databaseEndpoint: string;
  databasePort: number;
  expectedRegion: string;
}

interface MaterialBinding {
  fence: TenantResourceFence;
  externalFence: TenantExternalOperationFence;
}

function fail(code: string, message: string): never {
  throw new TenantDatabaseLifecycleError(code, message);
}

function assertBinding(binding: MaterialBinding): void {
  const { fence, externalFence } = binding;
  assertTenantResourceFence(fence);
  assertTenantResourceFence(externalFence.resourceFence, fence);
  if (
    externalFence.schemaVersion !== 1 ||
    externalFence.intent !== "provision" ||
    externalFence.state !== "active" ||
    externalFence.ownerDeploymentId !== fence.ownerDeploymentId ||
    externalFence.provisionPredecessor !== undefined ||
    !Number.isSafeInteger(externalFence.epoch) || externalFence.epoch < 1 ||
    !/^[a-f0-9]{64}$/.test(externalFence.operationHash) ||
    externalFence.marker !==
      `tl_epoch_${fence.identity.stableIdentityHash.slice(0, 24)}` +
      `_g${fence.generation}_e${externalFence.epoch}`
  ) {
    fail("TENANT_MATERIAL_BINDING_INVALID", "Runtime material requires an exact active provision binding.");
  }
}

function ownership(binding: MaterialBinding): TenantRuntimeSecretOwnershipEvidence {
  return {
    resourceGeneration: binding.fence.generation,
    ownershipMarker: binding.fence.ownershipMarker,
    externalEpoch: binding.externalFence.epoch,
    externalMarker: binding.externalFence.marker,
    externalOperationHash: binding.externalFence.operationHash,
  };
}

/**
 * Generates only new database/HMAC/JWT keys. Stripe credentials are real test
 * credentials supplied by a separate tenant-bound private source, never
 * randomly fabricated. Async-local bindings prevent concurrent tenants from
 * borrowing one another's identity. No secret is retained on this instance.
 */
export class NodeTenantRuntimeSecretMaterialGenerator
  implements TenantRuntimeSecretMaterialGenerator
{
  #bindings = new AsyncLocalStorage<MaterialBinding>();
  #config: Readonly<TenantRuntimeMaterialConfig>;
  #payments: TenantPaymentCredentialSource;

  constructor(config: TenantRuntimeMaterialConfig, payments: TenantPaymentCredentialSource) {
    if (!/^[a-z]{2}-[a-z]+-\d$/.test(config.expectedRegion)) {
      fail("TENANT_MATERIAL_CONFIG_INVALID", "Runtime material region is invalid.");
    }
    const region = config.expectedRegion.replace(/-/g, "\\-");
    const hostPattern = new RegExp(
      `^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+${region}\\.rds\\.amazonaws\\.com$`,
    );
    if (
      config.databaseEndpoint.length > 253 ||
      !hostPattern.test(config.databaseEndpoint) ||
      config.databasePort !== 5432 ||
      !payments || typeof payments.lease !== "function"
    ) {
      fail("TENANT_MATERIAL_CONFIG_INVALID", "Runtime material requires an exact regional RDS endpoint and private payment source.");
    }
    this.#config = Object.freeze({ ...config });
    this.#payments = payments;
  }

  /** Binding is available only while the guarded store is ensuring this Secret. */
  bindSecretStore(store: TenantSecretStorePort): TenantSecretStorePort {
    return Object.freeze({
      inspectRuntimeSecret: store.inspectRuntimeSecret.bind(store),
      destroyRuntimeSecret: store.destroyRuntimeSecret.bind(store),
      ensureRuntimeSecret: (input: Parameters<TenantSecretStorePort["ensureRuntimeSecret"]>[0]) => {
        input.signal.throwIfAborted();
        const binding = structuredClone({ fence: input.fence, externalFence: input.externalFence });
        assertBinding(binding);
        return this.#bindings.run(binding, () => store.ensureRuntimeSecret(input));
      },
    });
  }

  async generate(input: Parameters<TenantRuntimeSecretMaterialGenerator["generate"]>[0]) {
    input.signal.throwIfAborted();
    const binding = this.#bindings.getStore();
    if (!binding) {
      fail("TENANT_MATERIAL_BINDING_MISSING", "Runtime material must be generated inside a bound Secret operation.");
    }
    assertBinding(binding);
    if (
      input.secretName !== deriveTenantRuntimeSecretName(binding.fence) ||
      canonicalJson(input.ownership) !== canonicalJson(ownership(binding))
    ) {
      fail("TENANT_MATERIAL_BINDING_MISMATCH", "Secret request does not match the current tenant generation and epoch.");
    }
    let lease: TenantPaymentCredentialLease;
    try {
      lease = await this.#payments.lease({ ...structuredClone(binding), signal: input.signal });
    } catch {
      input.signal.throwIfAborted();
      fail("TENANT_PAYMENT_SOURCE_FAILED", "Tenant payment credentials could not be acquired.");
    }
    if (!lease || typeof lease.read !== "function" || typeof lease.dispose !== "function") {
      fail("TENANT_PAYMENT_LEASE_INVALID", "Tenant payment credential lease is invalid.");
    }
    try {
      input.signal.throwIfAborted();
      const payments = lease.read();
      if (
        !payments ||
        canonicalJson(Object.keys(payments).sort()) !== canonicalJson(["stripeSecretKey", "stripeWebhookSecret"]) ||
        !/^sk_test_[A-Za-z0-9]{16,256}$/.test(payments.stripeSecretKey) ||
        !/^whsec_[A-Za-z0-9]{16,256}$/.test(payments.stripeWebhookSecret)
      ) {
        fail("TENANT_PAYMENT_CREDENTIALS_INVALID", "Sandbox deployment requires real Stripe test credentials without extra fields.");
      }
      const url = new URL(`postgresql://${this.#config.databaseEndpoint}`);
      url.port = String(this.#config.databasePort);
      url.username = binding.fence.identity.roleName;
      url.password = randomBytes(32).toString("base64url");
      url.pathname = `/${binding.fence.identity.databaseName}`;
      url.searchParams.set("sslmode", "verify-full");
      const material = {
        database_url: url.href,
        hmac_secret_key: randomBytes(32).toString("base64url"),
        jwt_secret_key: randomBytes(32).toString("base64url"),
        stripe_secret_key: payments.stripeSecretKey,
        stripe_webhook_secret: payments.stripeWebhookSecret,
      };
      input.signal.throwIfAborted();
      return material;
    } catch (error) {
      input.signal.throwIfAborted();
      if (error instanceof TenantDatabaseLifecycleError) throw error;
      fail("TENANT_MATERIAL_GENERATION_FAILED", "Tenant runtime material generation failed.");
    } finally {
      try {
        lease.dispose();
      } catch {
        // Never leak a credential source's raw exception to Worker diagnostics.
        fail("TENANT_PAYMENT_DISPOSAL_FAILED", "Tenant payment credential lease could not be disposed.");
      }
    }
  }
}
