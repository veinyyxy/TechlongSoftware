import type { TenantDatabasePort } from "./contracts.ts";

export class TenantDatabaseBoundaryDisabledError extends Error {
  readonly code = "TENANT_DATABASE_BOUNDARY_DISABLED";
  readonly retryable = false;

  constructor() {
    super(
      "Tenant database provisioning is not configured; CloudFormation apply remains blocked.",
    );
  }
}

/**
 * Safe default for the standalone worker. S3 runtime wiring must replace this
 * with a reviewed implementation that creates one database + role in the Cell,
 * restores the PG16.14 baseline and runs migrate:saas idempotently.
 */
export class DisabledTenantDatabasePort implements TenantDatabasePort {
  async ensureTenantDatabase(): Promise<Record<string, unknown>> {
    throw new TenantDatabaseBoundaryDisabledError();
  }

  async migrateTenantDatabase(): Promise<Record<string, unknown>> {
    throw new TenantDatabaseBoundaryDisabledError();
  }
}
