import type { SaaSControlPayloadCompilerPort } from "./contracts.ts";

export class SaaSControlPayloadCompilerDisabledError extends Error {
  readonly code = "SAAS_CONTROL_PAYLOAD_COMPILER_DISABLED";
  readonly retryable = false;

  constructor() {
    super(
      "Template schema and runtime SecretStore compiler are not configured; SaaS provision is blocked.",
    );
  }
}

/**
 * The real adapter must load the immutable template-version schema, call
 * compileProvisioningConfiguration, inject the one-time owner secret from a
 * SecretStore, and add instance.metadata.configuration_hash. Raw customer
 * snapshots are never valid SaaS control request bodies.
 */
export class DisabledSaaSControlPayloadCompiler
  implements SaaSControlPayloadCompilerPort
{
  async compile(): Promise<never> {
    throw new SaaSControlPayloadCompilerDisabledError();
  }
}
