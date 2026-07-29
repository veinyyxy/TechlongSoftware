import { getDatabase } from "@/db";
import { randomId } from "@/lib/domain/ids";

export type WorkspaceProductEntitlementStatus =
  | "pending"
  | "active"
  | "suspended"
  | "ended";

export function upsertWorkspaceProductEntitlementStatement(input: {
  workspaceId: string;
  productId: string;
  currentSubscriptionId: string | null;
  appInstanceId: string | null;
  status: WorkspaceProductEntitlementStatus;
  preserveExistingServiceStatus?: boolean;
  now: number;
}) {
  return getDatabase()
    .prepare(
      `INSERT INTO workspace_product_entitlements (
        id, workspace_id, product_id, current_subscription_id,
        app_instance_id, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id, product_id) DO UPDATE SET
        current_subscription_id = excluded.current_subscription_id,
        app_instance_id = COALESCE(
          excluded.app_instance_id,
          workspace_product_entitlements.app_instance_id
        ),
        status = CASE
          WHEN excluded.status = 'ended' THEN 'ended'
          WHEN ? = 1
            AND workspace_product_entitlements.app_instance_id IS NOT NULL
            AND workspace_product_entitlements.status IN ('active', 'suspended')
            THEN workspace_product_entitlements.status
          ELSE excluded.status
        END,
        updated_at = excluded.updated_at`,
    )
    .bind(
      randomId("ent"),
      input.workspaceId,
      input.productId,
      input.currentSubscriptionId,
      input.appInstanceId,
      input.status,
      input.now,
      input.now,
      input.preserveExistingServiceStatus ? 1 : 0,
    );
}
