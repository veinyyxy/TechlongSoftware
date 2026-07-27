import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    status: text("status", { enum: ["active", "disabled"] })
      .notNull()
      .default("active"),
    isPlatformAdmin: integer("is_platform_admin", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("users_email_unique").on(table.email),
    index("users_status_idx").on(table.status),
  ],
);

export const plans = sqliteTable(
  "plans",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    priceAmount: integer("price_amount").notNull(),
    currency: text("currency").notNull(),
    billingInterval: text("billing_interval", { enum: ["month", "year"] })
      .notNull(),
    status: text("status", { enum: ["active", "inactive"] })
      .notNull()
      .default("active"),
    features: text("features").notNull().default("[]"),
    limits: text("limits").notNull().default("{}"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("plans_name_unique").on(table.name),
    index("plans_status_idx").on(table.status),
  ],
);

export const workspaces = sqliteTable(
  "workspaces",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: text("status", { enum: ["active", "suspended", "disabled"] })
      .notNull()
      .default("active"),
    contactName: text("contact_name"),
    contactEmail: text("contact_email"),
    planId: text("plan_id").references(() => plans.id, {
      onDelete: "set null",
    }),
    subscriptionStatus: text("subscription_status", {
      enum: [
        "not_configured",
        "manual_pending",
        "pending",
        "active",
        "past_due",
        "paused",
        "canceled",
        "cancelled",
      ],
    })
      .notNull()
      .default("not_configured"),
    appInstanceStatus: text("app_instance_status", {
      enum: [
        "not_provisioned",
        "pending",
        "provisioning",
        "active",
        "running",
        "failed",
        "suspended",
        "paused",
        "disabled",
      ],
    })
      .notNull()
      .default("not_provisioned"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("workspaces_owner_id_idx").on(table.ownerId),
    index("workspaces_plan_id_idx").on(table.planId),
    index("workspaces_status_idx").on(table.status),
  ],
);

export const subscriptions = sqliteTable(
  "subscriptions",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    planId: text("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "restrict" }),
    status: text("status", {
      enum: [
        "manual_pending",
        "active",
        "past_due",
        "paused",
        "canceled",
      ],
    })
      .notNull()
      .default("manual_pending"),
    currentPeriodStart: integer("current_period_start", {
      mode: "timestamp_ms",
    }).notNull(),
    currentPeriodEnd: integer("current_period_end", {
      mode: "timestamp_ms",
    }).notNull(),
    cancelAtPeriodEnd: integer("cancel_at_period_end", { mode: "boolean" })
      .notNull()
      .default(false),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("subscriptions_workspace_unique").on(table.workspaceId),
    index("subscriptions_plan_id_idx").on(table.planId),
    index("subscriptions_status_idx").on(table.status),
  ],
);

export const paymentRecords = sqliteTable(
  "payment_records",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    subscriptionId: text("subscription_id").references(
      () => subscriptions.id,
      { onDelete: "set null" },
    ),
    amount: integer("amount").notNull(),
    currency: text("currency").notNull(),
    status: text("status", { enum: ["pending", "paid", "failed", "canceled"] })
      .notNull()
      .default("pending"),
    paidAt: integer("paid_at", { mode: "timestamp_ms" }),
    paymentMethod: text("payment_method").notNull(),
    provider: text("provider").notNull().default("manual"),
    providerPaymentId: text("provider_payment_id"),
    providerEventId: text("provider_event_id"),
    reference: text("reference"),
    note: text("note"),
    failureReason: text("failure_reason"),
    recordedByUserId: text("recorded_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("payment_records_workspace_id_idx").on(table.workspaceId),
    index("payment_records_subscription_id_idx").on(table.subscriptionId),
    index("payment_records_status_idx").on(table.status),
    uniqueIndex("payment_records_provider_payment_id_unique").on(
      table.provider,
      table.providerPaymentId,
    ),
    uniqueIndex("payment_records_provider_event_id_unique").on(
      table.provider,
      table.providerEventId,
    ),
  ],
);

export const paymentCheckoutSessions = sqliteTable(
  "payment_checkout_sessions",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    planId: text("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "restrict" }),
    paymentRecordId: text("payment_record_id")
      .notNull()
      .references(() => paymentRecords.id, { onDelete: "cascade" }),
    initiatedByUserId: text("initiated_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    provider: text("provider").notNull().default("stripe"),
    providerSessionId: text("provider_session_id"),
    providerPaymentId: text("provider_payment_id"),
    checkoutUrl: text("checkout_url"),
    status: text("status", {
      enum: ["creating", "open", "completed", "failed", "canceled", "expired"],
    })
      .notNull()
      .default("creating"),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("payment_checkout_sessions_provider_session_unique").on(
      table.provider,
      table.providerSessionId,
    ),
    index("payment_checkout_sessions_workspace_id_idx").on(table.workspaceId),
    index("payment_checkout_sessions_payment_record_id_idx").on(
      table.paymentRecordId,
    ),
    index("payment_checkout_sessions_status_idx").on(table.status),
  ],
);

export const paymentWebhookEvents = sqliteTable(
  "payment_webhook_events",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    providerEventId: text("provider_event_id").notNull(),
    eventType: text("event_type").notNull(),
    checkoutSessionId: text("checkout_session_id").references(
      () => paymentCheckoutSessions.id,
      { onDelete: "set null" },
    ),
    payloadHash: text("payload_hash").notNull(),
    processingStatus: text("processing_status", {
      enum: ["pending", "processed", "ignored", "failed"],
    })
      .notNull()
      .default("pending"),
    lastError: text("last_error"),
    receivedAt: integer("received_at", { mode: "timestamp_ms" }).notNull(),
    processedAt: integer("processed_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("payment_webhook_events_provider_event_unique").on(
      table.provider,
      table.providerEventId,
    ),
    index("payment_webhook_events_checkout_session_id_idx").on(
      table.checkoutSessionId,
    ),
    index("payment_webhook_events_processing_status_idx").on(
      table.processingStatus,
    ),
  ],
);

export const products = sqliteTable(
  "products",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description").notNull().default(""),
    status: text("status", { enum: ["active", "inactive"] })
      .notNull()
      .default("active"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("products_slug_unique").on(table.slug),
    index("products_status_idx").on(table.status),
  ],
);

export const appInstances = sqliteTable(
  "app_instances",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    subscriptionId: text("subscription_id").references(
      () => subscriptions.id,
      { onDelete: "set null" },
    ),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    domain: text("domain"),
    accessUrl: text("access_url").notNull(),
    tenantKey: text("tenant_key").notNull(),
    provisioningSource: text("provisioning_source", {
      enum: ["manual", "payment_success"],
    })
      .notNull()
      .default("manual"),
    status: text("status", {
      enum: ["pending", "active", "suspended", "failed"],
    })
      .notNull()
      .default("pending"),
    provisionedAt: integer("provisioned_at", { mode: "timestamp_ms" }),
    suspendedAt: integer("suspended_at", { mode: "timestamp_ms" }),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("app_instances_slug_unique").on(table.slug),
    uniqueIndex("app_instances_tenant_key_unique").on(table.tenantKey),
    uniqueIndex("app_instances_workspace_product_unique").on(
      table.workspaceId,
      table.productId,
    ),
    index("app_instances_workspace_id_idx").on(table.workspaceId),
    index("app_instances_product_id_idx").on(table.productId),
    index("app_instances_subscription_id_idx").on(table.subscriptionId),
    index("app_instances_status_idx").on(table.status),
  ],
);

export const workspaceMembers = sqliteTable(
  "workspace_members",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "member"] })
      .notNull()
      .default("member"),
    joinedAt: integer("joined_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("workspace_members_workspace_user_unique").on(
      table.workspaceId,
      table.userId,
    ),
    index("workspace_members_user_id_idx").on(table.userId),
    index("workspace_members_workspace_id_idx").on(table.workspaceId),
  ],
);
