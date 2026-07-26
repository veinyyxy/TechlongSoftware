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
        "pending",
        "active",
        "past_due",
        "paused",
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
