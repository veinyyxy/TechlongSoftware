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
        "running",
        "failed",
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
    status: text("status", { enum: ["pending", "paid", "failed"] })
      .notNull()
      .default("pending"),
    paidAt: integer("paid_at", { mode: "timestamp_ms" }),
    paymentMethod: text("payment_method").notNull(),
    reference: text("reference"),
    note: text("note"),
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
